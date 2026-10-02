import SwiftUI

/// A markdown table, edited as a grid of cells like Apple Notes.
/// The note keeps standard markdown; every change is written straight back.
/// A `<!-- pane-table: … -->` comment above the table gives columns a type.
struct GridTable: Equatable {
    var rows: [[String]]
    var range: NSRange
    var index: Int
    /// Column types from the comment; nil for a plain table.
    var types: [TypedTable.ColumnType]? = nil

    var columns: Int { rows.map(\.count).max() ?? 0 }

    func type(_ column: Int) -> TypedTable.ColumnType {
        guard let types, column < types.count else { return .text }
        return types[column]
    }

    /// All tables in the text (code blocks excluded), typed or plain.
    static func find(in text: String) -> [GridTable] {
        let ns = text as NSString
        var lines: [NSRange] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in lines.append(r) }
        var out: [GridTable] = []
        var inCode = false
        var i = 0
        func isRow(_ k: Int) -> Bool { k < lines.count && ns.substring(with: lines[k]).trimmingCharacters(in: .whitespaces).hasPrefix("|") }
        func isDelimiter(_ k: Int) -> Bool {
            let t = ns.substring(with: lines[k]).trimmingCharacters(in: .whitespaces)
            return t.hasPrefix("|") && t.contains("-") && t.allSatisfy { "|-: \t".contains($0) }
        }
        while i < lines.count {
            let t = ns.substring(with: lines[i]).trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") || t.hasPrefix("~~~") { inCode.toggle(); i += 1; continue }
            if inCode || !isRow(i) || !(i + 1 < lines.count && isDelimiter(i + 1)) { i += 1; continue }
            var j = i
            while isRow(j) { j += 1 }
            let body = (i..<j).map { ns.substring(with: lines[$0]) }
            let above = i > 0 ? ns.substring(with: lines[i - 1]).trimmingCharacters(in: .whitespaces) : ""
            let typed = above.hasPrefix("<!--") && above.hasSuffix("-->") && above.contains(TypedTable.marker)
            let start = typed ? lines[i - 1].location : lines[i].location
            let range = NSRange(location: start, length: NSMaxRange(lines[j - 1]) - start)
            var g = from(lines: body, range: range, index: out.count)
            if typed { g.types = TypedTable.parse(comment: above, table: body.map { $0.trimmingCharacters(in: .whitespaces) })?.columns.map(\.type) }
            if g.isLive { out.append(g) }
            i = j
        }
        return out
    }

    /// The most cells a table can have and still be shown as a live grid. Bigger tables
    /// (a pasted export, say) stay styled markdown: a grid of 100,000 cells overruns
    /// SwiftUI and takes the app down. NoteStructure applies the same rule, so both
    /// number tables the same way.
    static let maxLiveCells = 5000
    var isLive: Bool { rows.count * max(columns, 1) <= Self.maxLiveCells }

    static func from(lines: [String], range: NSRange, index: Int) -> GridTable {
        let body = lines.filter { !$0.allSatisfy { "|-: \t".contains($0) } }
        var rows = body.map { TypedTable.cells($0) }
        let width = max(rows.map(\.count).max() ?? 1, 1)
        rows = rows.map { $0 + Array(repeating: "", count: width - $0.count) }
        return GridTable(rows: rows.isEmpty ? [[""]] : rows, range: range, index: index)
    }

    var markdown: String {
        let width = max(columns, 1)
        func line(_ r: [String]) -> String {
            let cells = (r + Array(repeating: "", count: width - r.count)).map {
                $0.isEmpty ? " " : $0.replacingOccurrences(of: "|", with: "\\|").replacingOccurrences(of: "\n", with: " ")
            }
            return "| " + cells.joined(separator: " | ") + " |"
        }
        var out: [String] = []
        if (0..<width).contains(where: { type($0) != .text }) {
            let header = rows.first ?? []
            let specs = (0..<width).map { c in "\(c < header.count ? header[c] : "")=\(type(c).spec)" }
            out.append("<!-- \(TypedTable.marker) " + specs.joined(separator: "; ") + " -->")
        }
        out += [line(rows.first ?? []), "|" + Array(repeating: " --- ", count: width).joined(separator: "|") + "|"]
        out += rows.dropFirst().map(line)
        return out.joined(separator: "\n")
    }

    /// A new row, with today's date in the first date column.
    var blankRow: [String] {
        let width = max(columns, 1)
        let dateColumn = (0..<width).first { type($0) == .date }
        return (0..<width).map { $0 == dateColumn ? TypedTable.day(.now) : "" }
    }

    /// The typed view the chart reads.
    var typed: TypedTable {
        let width = max(columns, 1)
        let header = rows.first ?? []
        let cols = (0..<width).map { TypedTable.Column(name: $0 < header.count ? header[$0] : "", type: type($0)) }
        return TypedTable(columns: cols, rows: rows.dropFirst().map { $0 + Array(repeating: "", count: max(0, width - $0.count)) })
    }

    /// Widths that fit each column's text, stretched to fill `available`. A table a little too
    /// wide gives up spare room around its text first (down to the cell's own insets), so a
    /// four-column log fits an iPhone instead of cutting its last column.
    func columnWidths(available: CGFloat) -> [CGFloat] {
        let width = max(columns, 1)
        let font = PFont.systemFont(ofSize: EditorMetrics.body)
        let longest = (0..<width).map { c -> CGFloat in
            ceil(rows.map { c < $0.count ? ($0[c] as NSString).size(withAttributes: [.font: font]).width : 0 }.max() ?? 0)
        }
        var natural = longest.map { min(max($0 + 24, 64), 280) }
        let total = natural.reduce(0, +)
        if total < available, total > 0 {
            natural = natural.map { $0 * available / total }
        } else if total > available {
            // The text plus the cells' 8-point insets either side.
            let tight = zip(longest, natural).map { min(max($0 + 16, 44), $1) }
            let least = tight.reduce(0, +)
            if least >= available { return tight }
            let give = (total - available) / (total - least)
            natural = zip(natural, tight).map { n, t in n - (n - t) * give }
        }
        return natural
    }
}

extension TypedTable.ColumnType {
    /// A choice whose first answer is "Yes": shown as a checkbox.
    var isYesNo: Bool {
        if case .choice(let o) = self { return o.first?.lowercased() == "yes" }
        return false
    }

    var isNumeric: Bool {
        switch self {
        case .number, .scale: true
        default: false
        }
    }

    var chartable: Bool {
        switch self {
        case .number, .scale, .choice: true
        default: false
        }
    }
}

/// Which edges of a scrolled table have more columns past them.
struct GridOverflow: Equatable {
    var leading = false
    var trailing = false

    init(leading: Bool = false, trailing: Bool = false) {
        self.leading = leading
        self.trailing = trailing
    }

    init(_ g: ScrollGeometry) {
        leading = g.contentOffset.x > 1
        trailing = g.contentOffset.x + g.containerSize.width < g.contentSize.width - 1
    }

    /// Opaque where the table shows, fading over the last `width` points of an edge with more.
    struct Fade: View {
        let overflow: GridOverflow
        static let width: CGFloat = 28

        var body: some View {
            HStack(spacing: 0) {
                if overflow.leading { LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing).frame(width: Self.width) }
                Rectangle()
                if overflow.trailing { LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: Self.width) }
            }
        }
    }
}

enum GridMetrics {
    static let row: CGFloat = 32
    static let handle: CGFloat = 16
    static func height(_ t: GridTable) -> CGFloat { handle + CGFloat(t.rows.count) * row + 2 }
}

/// Where the keyboard is inside a grid.
struct GridCell: Hashable {
    var row: Int
    var column: Int
}

/// The column types you can pick from the column menu.
private enum ColumnKind: Hashable {
    case text, number, date, yesNo, other

    init(_ t: TypedTable.ColumnType) {
        switch t {
        case .text: self = .text
        case .number, .scale: self = .number
        case .date: self = .date
        case .choice: self = t.isYesNo ? .yesNo : .other
        }
    }

    var type: TypedTable.ColumnType {
        switch self {
        case .text, .other: .text
        case .number: .number
        case .date: .date
        case .yesNo: .choice(["Yes", "No"])
        }
    }
}

private struct TrendColumn: Identifiable {
    let id: Int
}

struct TableGridView: View {
    let table: GridTable
    /// Writes the edited table back into the note.
    let commit: (GridTable) -> Void
    /// Which cell to focus when the table appears (a just-inserted table).
    var initialFocus: GridCell?
    /// Set when the caret arrows into the table from the text.
    var focusRequest: GridFocusRequest?
    /// The whole table is selected in the text (Delete next to it selects it first).
    var selected = false
    /// Arrowing out of the top (false) or bottom (true) row hands the keyboard back to the text.
    var exit: (Bool) -> Void = { _ in }

    @State private var draft: GridTable
    /// Edges with more columns past them (see GridOverflow).
    @State private var overflow = GridOverflow()
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var trend: TrendColumn?
    @FocusState private var focus: GridCell?
    /// Set when the keyboard (not a click) moves between cells: the caret goes to
    /// the end of the cell's text instead of selecting all of it.
    @State private var caretToEnd = false
    /// The one cell showing a text field; nil when the table isn't being edited.
    @State private var editing: GridCell?
    /// Where the caret goes in that cell (nil: after its text).
    @State private var caretAt: Int?
    /// A cell whose field is being created and should take focus when it appears.
    @State private var pendingFocus: GridCell?
    /// The cell the keyboard is moving to, until it has arrived.
    @State private var wanted: GridCell?
    /// The cell keys act on: the one the keyboard is moving to, while it's on its way. Mid-move
    /// `focus` still names the old cell or is briefly nil (the old field going away), and a key
    /// pressed then would repeat the last move or be dropped.
    private var current: GridCell? { wanted ?? focus }

    init(table: GridTable, initialFocus: GridCell?, focusRequest: GridFocusRequest? = nil, selected: Bool = false, exit: @escaping (Bool) -> Void = { _ in }, commit: @escaping (GridTable) -> Void) {
        self.selected = selected
        self.table = table
        self.commit = commit
        self.initialFocus = initialFocus
        self.focusRequest = focusRequest
        self.exit = exit
        _draft = State(initialValue: table)
    }

    var body: some View {
        GeometryReader { geo in
            let available = geo.size.width - GridMetrics.handle
            let widths = draft.columnWidths(available: available)
            let total = widths.reduce(0, +)
            ScrollView(.horizontal) {
                content(widths: widths)
                    .frame(width: GridMetrics.handle + total, alignment: .leading)
            }
            .scrollDisabled(total <= available + 0.5)
            .scrollIndicators(total <= available + 0.5 ? .hidden : .automatic)
            // A table wider than the note fades at the edge that has more, so a cut column
            // reads as "scroll for more", not as clipped.
            .onScrollGeometryChange(for: GridOverflow.self) { GridOverflow($0) } action: { _, new in overflow = new }
            .mask { GridOverflow.Fade(overflow: overflow) }
        }
        .onChange(of: table) { _, new in if new != draft { draft = new } }
        .onAppear {
            if let cell = initialFocus ?? focusRequest?.cell { DispatchQueue.main.async { go(cell) } }
        }
        .onChange(of: focusRequest) { _, r in if let r { DispatchQueue.main.async { go(r.cell) } } }
        .onChange(of: focus) { _, new in
            qaTrace("grid focus -> \(String(describing: new))")
            if new == nil {
                // The old cell's field going away can knock focus out before the new
                // one lands: put it back (`land` keeps asking if this is turned down too).
                // A real departure leaves `wanted` empty.
                if let w = wanted { DispatchQueue.main.async { if focus == nil, wanted == w { focus = w } } }
                // The last cell's field stays: it's plain-styled, so it reads as text.
                return
            }
            if new == wanted { wanted = nil }
            if let new, new != editing { editing = new }
            guard caretToEnd else { return }
            caretToEnd = false
            let caret = caretAt
            #if os(macOS)
            // The field selects everything as it takes focus; put a caret at the end instead.
            // The field selects all once its editor is installed, a turn or two later.
            func place(_ tries: Int) {
                DispatchQueue.main.async {
                    let windows = [NSApp.keyWindow].compactMap { $0 } + NSApp.windows
                    guard let editor = windows.lazy.compactMap({ $0.firstResponder as? NSTextView }).first(where: { $0.isFieldEditor }) else {
                        if tries > 0 { place(tries - 1) }
                        return
                    }
                    let end = (editor.string as NSString).length
                    let at = min(caret ?? end, end)
                    if editor.selectedRange() != NSRange(location: at, length: 0) {
                        editor.setSelectedRange(NSRange(location: at, length: 0))
                    }
                    if tries > 0 { place(tries - 1) }
                }
            }
            place(3)
            #endif
        }
        .sheet(item: $trend) { TableChartSheet(table: draft.typed, column: $0.id) }
    }

    private func content(widths: [CGFloat]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Column handle above the focused column.
            ZStack(alignment: .leading) {
                Color.clear.frame(height: GridMetrics.handle)
                if let f = focus, f.column < widths.count {
                    handle(horizontal: true, label: columnHandleLabel(f.column)) { columnMenu(f.column) }
                        .offset(x: GridMetrics.handle + widths[..<f.column].reduce(0, +) + widths[f.column] / 2 - 14)
                }
            }
            HStack(alignment: .top, spacing: 0) {
                // Row handle beside the focused row.
                ZStack(alignment: .top) {
                    Color.clear.frame(width: GridMetrics.handle)
                    if let f = focus {
                        handle(horizontal: false, label: rowHandleLabel(f.row)) { rowMenu(f.row) }
                            .offset(y: CGFloat(f.row) * GridMetrics.row + GridMetrics.row / 2 - 12)
                    }
                }
                grid(widths: widths)
            }
        }
    }

    private func grid(widths: [CGFloat]) -> some View {
        let cols = widths.count
        return VStack(spacing: 0) {
            ForEach(0..<draft.rows.count, id: \.self) { r in
                HStack(spacing: 0) {
                    ForEach(0..<cols, id: \.self) { c in
                        cell(r, c, cols: cols, width: widths[c])
                            .frame(width: widths[c], height: GridMetrics.row)
                            .overlay(alignment: .trailing) {
                                if c < cols - 1 { Rectangle().fill(border).frame(width: 1) }
                            }
                            .accessibilityIdentifier("grid.\(r).\(c)")
                            // VoiceOver: which column you're in, then where in the table.
                            .accessibilityLabel(cellLabel(r, c))
                    }
                }
                .overlay(alignment: .bottom) {
                    if r < draft.rows.count - 1 { Rectangle().fill(border).frame(height: 1) }
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(border, lineWidth: 1))
        // Selected as a whole (about to be deleted): tinted like selected text.
        .overlay {
            if selected {
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.accentColor.opacity(0.12))
                    .strokeBorder(Color.accentColor, lineWidth: 2)
                    .allowsHitTesting(false)
            }
        }
        .onKeyPress(.upArrow) {
            guard let f = current else { return .ignored }
            if f.row == 0 { wanted = nil; exit(false) } else { go(GridCell(row: f.row - 1, column: f.column)) }
            return .handled
        }
        .onKeyPress(.downArrow) {
            qaTrace("grid down, focus \(String(describing: focus)) wanted \(String(describing: wanted))")
            guard let f = current else { return .ignored }
            if f.row == draft.rows.count - 1 { wanted = nil; exit(true) } else { go(GridCell(row: f.row + 1, column: f.column)) }
            return .handled
        }
        .onKeyPress(.escape) {
            guard current != nil else { return .ignored }
            wanted = nil
            exit(true)
            return .handled
        }
        .onKeyPress(.tab, phases: .down) { press in
            guard let f = current else { return .ignored }
            step(from: f, by: press.modifiers.contains(.shift) ? -1 : 1, cols: cols)
            return .handled
        }
    }

    private func columnHandleLabel(_ c: Int) -> String {
        Self.columnHandleLabel(header: draft.rows.first.flatMap { c < $0.count ? $0[c] : nil } ?? "", column: c)
    }

    static func columnHandleLabel(header: String, column: Int) -> String {
        "\(header.isEmpty ? "Column \(column + 1)" : "\(header) column") options"
    }

    private func rowHandleLabel(_ r: Int) -> String {
        Self.rowHandleLabel(row: r)
    }

    static func rowHandleLabel(row: Int) -> String {
        "Row \(row + 1) options"
    }

    private func cellLabel(_ r: Int, _ c: Int) -> String {
        let header = draft.rows.first.flatMap { c < $0.count ? $0[c] : nil } ?? ""
        let value = r < draft.rows.count && c < draft.rows[r].count ? draft.rows[r][c] : ""
        let place = r == 0 ? "Header, column \(c + 1)" : "\(header.isEmpty ? "Column \(c + 1)" : header), row \(r)"
        return value.isEmpty ? "\(place), empty" : "\(value), \(place)"
    }

    @ViewBuilder
    private func cell(_ r: Int, _ c: Int, cols: Int, width: CGFloat) -> some View {
        let type = r == 0 ? .text : draft.type(c)
        let trailing = draft.type(c).isNumeric
        if type.isYesNo, case .choice(let options) = type {
            yesNoCell(r, c, options: options)
        } else if case .choice(let options) = type {
            choiceCell(r, c, options: options)
        } else if editing == GridCell(row: r, column: c) {
            TextField("", text: cellBinding(r, c))
                .textFieldStyle(.plain)
                .font(.system(size: EditorMetrics.body))
                .monospacedDigit()
                .multilineTextAlignment(trailing ? .trailing : .leading)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: trailing ? .trailing : .leading)
                .focused($focus, equals: GridCell(row: r, column: c))
                .onSubmit { move(from: GridCell(row: r, column: c), cols: cols) }
                // Focus once the field really exists (it's created for this edit).
                .onAppear {
                    qaTrace("grid field appears \(r),\(c) pending \(String(describing: pendingFocus))")
                    if pendingFocus == GridCell(row: r, column: c) {
                        pendingFocus = nil
                        focus = GridCell(row: r, column: c)
                    }
                }
        } else {
            // Only the cell being edited is a text field; the rest are plain text,
            // which keeps big tables quick to open. A click edits, caret where you clicked.
            let value = r < draft.rows.count && c < draft.rows[r].count ? draft.rows[r][c] : ""
            Text(value.isEmpty ? " " : value)
                .font(.system(size: EditorMetrics.body))
                .monospacedDigit()
                .lineLimit(1)
                .accessibilityAddTraits(.isButton)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: trailing ? .trailing : .leading)
                .contentShape(.rect)
                .onTapGesture { p in
                    begin(GridCell(row: r, column: c), at: Self.caretIndex(in: value, x: p.x, width: width, trailing: trailing))
                }
        }
    }

    /// Which character a click at `x` (in the cell) lands before.
    static func caretIndex(in value: String, x: CGFloat, width: CGFloat, trailing: Bool) -> Int {
        let font = PFont.systemFont(ofSize: EditorMetrics.body)
        let ns = value as NSString
        let full = ns.size(withAttributes: [.font: font]).width
        let start: CGFloat = trailing ? width - 8 - full : 8
        let local = x - start
        guard local > 0 else { return 0 }
        var previous: CGFloat = 0
        for i in 1...max(ns.length, 1) where i <= ns.length {
            let w = ns.substring(to: i).size(withAttributes: [.font: font]).width
            if local < (previous + w) / 2 { return i - 1 }
            previous = w
        }
        return ns.length
    }

    /// Yes is a ticked circle, like a checklist; a tap flips it.
    private func yesNoCell(_ r: Int, _ c: Int, options: [String]) -> some View {
        let value = cellBinding(r, c)
        let yes = options.first ?? "Yes"
        let no = options.count > 1 ? options[1] : "No"
        let current = value.wrappedValue
        let isYes = current.caseInsensitiveCompare(yes) == .orderedSame
        let isNo = current.isEmpty || current.caseInsensitiveCompare(no) == .orderedSame
        return Button {
            value.wrappedValue = isYes ? no : yes
        } label: {
            Group {
                if isYes || isNo {
                    Image(systemName: isYes ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: EditorMetrics.checkSize * 0.8))
                        .foregroundStyle(isYes ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                } else {
                    Text(current)
                        .font(.system(size: EditorMetrics.body))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu {
            ForEach(options, id: \.self) { o in Button(o) { value.wrappedValue = o } }
            Divider()
            Button("Clear") { value.wrappedValue = "" }
        }
        .accessibilityLabel(current.isEmpty ? "Empty" : current)
    }

    /// Any other list of answers: plain text that opens a menu.
    private func choiceCell(_ r: Int, _ c: Int, options: [String]) -> some View {
        let value = cellBinding(r, c)
        return Menu {
            ForEach(options, id: \.self) { o in Button(o) { value.wrappedValue = o } }
            Divider()
            Button("Clear") { value.wrappedValue = "" }
        } label: {
            Text(value.wrappedValue)
                .font(.system(size: EditorMetrics.body))
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }

    /// Moves the keyboard to a cell, caret after its text, like Notes.
    private func go(_ cell: GridCell) {
        begin(cell, at: nil)
    }

    /// Turns a cell into a text field and gives it the keyboard.
    private func begin(_ cell: GridCell, at caret: Int?) {
        qaTrace("grid begin \(cell) editing \(String(describing: editing)) focus \(String(describing: focus))")
        wanted = cell
        caretAt = caret
        caretToEnd = true
        if editing == cell {
            focus = cell
        } else {
            // The field is created for this cell; it takes focus as it appears.
            pendingFocus = cell
            editing = cell
        }
        land(cell)
    }

    /// Keeps asking for the keyboard for `cell` until it has arrived, for up to about two
    /// seconds. One ask isn't enough: on a busy main thread it can come before the new field
    /// is in the window, AppKit turns it down, focus stays nil and nothing asks again, so the
    /// table silently loses the keyboard and the next arrow key goes nowhere.
    private func land(_ cell: GridCell, tries: Int = 100) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
            guard wanted == cell, focus != cell else { return }
            qaTrace("grid land \(cell), focus \(String(describing: focus)), \(tries) tries left")
            focus = cell
            if tries > 0 { land(cell, tries: tries - 1) }
        }
    }

    /// Grid lines get firmer with Increase Contrast.
    private var border: Color { Color.secondary.opacity(contrast == .increased ? 0.9 : 0.45) }

    private func cellBinding(_ r: Int, _ c: Int) -> Binding<String> {
        Binding(
            get: { r < draft.rows.count && c < draft.rows[r].count ? draft.rows[r][c] : "" },
            set: { value in
                guard r < draft.rows.count else { return }
                while draft.rows[r].count <= c { draft.rows[r].append("") }
                draft.rows[r][c] = value
                commit(draft)
            })
    }

    /// Cells you type into; checkboxes and menus are skipped by Tab and Return.
    private func isText(_ r: Int, _ c: Int) -> Bool {
        if r == 0 { return true }
        if case .choice = draft.type(c) { return false }
        return true
    }

    /// Tab walks the text cells; past the last cell it adds a row.
    private func step(from f: GridCell, by delta: Int, cols: Int) {
        var flat = f.row * cols + f.column
        repeat {
            flat += delta
            if flat < 0 { return }
            if flat >= draft.rows.count * cols {
                draft.rows.append(draft.blankRow)
                commit(draft)
            }
        } while !isText(flat / cols, flat % cols) && (0..<cols).contains(where: { isText(flat / cols, $0) })
        go(GridCell(row: flat / cols, column: flat % cols))
    }

    /// Return moves down a row, adding one at the bottom.
    private func move(from f: GridCell, cols: Int) {
        if f.row == draft.rows.count - 1 {
            draft.rows.append(draft.blankRow)
            commit(draft)
        }
        go(GridCell(row: f.row + 1, column: f.column))
    }

    private func handle(horizontal: Bool, label: String, @ViewBuilder menu: () -> some View) -> some View {
        Menu { menu() } label: {
            Image(systemName: "ellipsis")
                .rotationEffect(.degrees(horizontal ? 0 : 90))
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: horizontal ? 28 : 14, height: horizontal ? 14 : 24)
                .background(.fill.secondary, in: .capsule)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func rowMenu(_ r: Int) -> some View {
        Button("Add Row Above") { edit { $0.rows.insert($0.blankRow, at: max(r, 1)) } }
        Button("Add Row Below") { edit { $0.rows.insert($0.blankRow, at: r + 1) } }
        Divider()
        Button("Delete Row", role: .destructive) { edit { if $0.rows.count > 1 { $0.rows.remove(at: r) } } }
    }

    @ViewBuilder
    private func columnMenu(_ c: Int) -> some View {
        Picker("Type", selection: kindBinding(c)) {
            Text("Text").tag(ColumnKind.text)
            Text("Number").tag(ColumnKind.number)
            Text("Date").tag(ColumnKind.date)
            Text("Yes/No").tag(ColumnKind.yesNo)
        }
        .pickerStyle(.menu)
        if draft.type(c).chartable {
            Button("Show Trend") { trend = TrendColumn(id: c) }
        }
        Divider()
        Button("Add Column Before") { edit { t in insertColumn(&t, at: c) } }
        Button("Add Column After") { edit { t in insertColumn(&t, at: c + 1) } }
        Divider()
        Button("Delete Column", role: .destructive) {
            edit { t in
                guard t.columns > 1 else { return }
                t.rows = t.rows.map { var r = $0; if c < r.count { r.remove(at: c) }; return r }
                if var types = t.types, c < types.count { types.remove(at: c); t.types = types }
            }
        }
    }

    private func insertColumn(_ t: inout GridTable, at c: Int) {
        t.rows = t.rows.map { var r = $0; r.insert("", at: min(c, r.count)); return r }
        if var types = t.types { types.insert(.text, at: min(c, types.count)); t.types = types }
    }

    /// Changing the kind keeps a more specific type (a 1–10 scale stays a scale).
    private func kindBinding(_ c: Int) -> Binding<ColumnKind> {
        Binding(
            get: { ColumnKind(draft.type(c)) },
            set: { kind in
                guard kind != ColumnKind(draft.type(c)) else { return }
                edit { t in
                    var types = t.types ?? []
                    while types.count < t.columns { types.append(.text) }
                    types[c] = kind.type
                    t.types = types
                }
            })
    }

    private func edit(_ change: (inout GridTable) -> Void) {
        change(&draft)
        commit(draft)
    }
}

/// Development traces for the QA harness; compiled out of real builds.
@inline(__always) func qaTrace(_ s: @autoclosure () -> String) {
    #if QA
    FileHandle.standardError.write(("TRACE " + s() + "\n").data(using: .utf8)!)
    #endif
}
