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
            out.append(g)
            i = j
        }
        return out
    }

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

    /// Widths that fit each column's text, stretched to fill `available`.
    func columnWidths(available: CGFloat) -> [CGFloat] {
        let width = max(columns, 1)
        let font = PFont.systemFont(ofSize: EditorMetrics.body)
        var natural = (0..<width).map { c -> CGFloat in
            let longest = rows.map { c < $0.count ? ($0[c] as NSString).size(withAttributes: [.font: font]).width : 0 }.max() ?? 0
            return min(max(ceil(longest) + 24, 64), 280)
        }
        let total = natural.reduce(0, +)
        if total < available, total > 0 {
            natural = natural.map { $0 * available / total }
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

    @State private var draft: GridTable
    @State private var trend: TrendColumn?
    @FocusState private var focus: GridCell?

    init(table: GridTable, initialFocus: GridCell?, commit: @escaping (GridTable) -> Void) {
        self.table = table
        self.commit = commit
        self.initialFocus = initialFocus
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
        }
        .onChange(of: table) { _, new in if new != draft { draft = new } }
        .onAppear { if let initialFocus { DispatchQueue.main.async { focus = initialFocus } } }
        .sheet(item: $trend) { TableChartSheet(table: draft.typed, column: $0.id) }
    }

    private func content(widths: [CGFloat]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Column handle above the focused column.
            ZStack(alignment: .leading) {
                Color.clear.frame(height: GridMetrics.handle)
                if let f = focus, f.column < widths.count {
                    handle(horizontal: true) { columnMenu(f.column) }
                        .offset(x: GridMetrics.handle + widths[..<f.column].reduce(0, +) + widths[f.column] / 2 - 14)
                }
            }
            HStack(alignment: .top, spacing: 0) {
                // Row handle beside the focused row.
                ZStack(alignment: .top) {
                    Color.clear.frame(width: GridMetrics.handle)
                    if let f = focus {
                        handle(horizontal: false) { rowMenu(f.row) }
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
                        cell(r, c, cols: cols)
                            .frame(width: widths[c], height: GridMetrics.row)
                            .overlay(alignment: .trailing) {
                                if c < cols - 1 { Rectangle().fill(border).frame(width: 1) }
                            }
                            .accessibilityIdentifier("grid.\(r).\(c)")
                    }
                }
                .overlay(alignment: .bottom) {
                    if r < draft.rows.count - 1 { Rectangle().fill(border).frame(height: 1) }
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(border, lineWidth: 1))
        .onKeyPress(.tab, phases: .down) { press in
            guard let f = focus else { return .ignored }
            step(from: f, by: press.modifiers.contains(.shift) ? -1 : 1, cols: cols)
            return .handled
        }
    }

    @ViewBuilder
    private func cell(_ r: Int, _ c: Int, cols: Int) -> some View {
        let type = r == 0 ? .text : draft.type(c)
        let trailing = draft.type(c).isNumeric
        if type.isYesNo, case .choice(let options) = type {
            yesNoCell(r, c, options: options)
        } else if case .choice(let options) = type {
            choiceCell(r, c, options: options)
        } else {
            TextField("", text: cellBinding(r, c))
                .textFieldStyle(.plain)
                .font(.system(size: EditorMetrics.body))
                .monospacedDigit()
                .multilineTextAlignment(trailing ? .trailing : .leading)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: trailing ? .trailing : .leading)
                .focused($focus, equals: GridCell(row: r, column: c))
                .onSubmit { move(from: GridCell(row: r, column: c), cols: cols) }
        }
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

    private var border: Color { Color.secondary.opacity(0.45) }

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
        focus = GridCell(row: flat / cols, column: flat % cols)
    }

    /// Return moves down a row, adding one at the bottom.
    private func move(from f: GridCell, cols: Int) {
        if f.row == draft.rows.count - 1 {
            draft.rows.append(draft.blankRow)
            commit(draft)
        }
        focus = GridCell(row: f.row + 1, column: f.column)
    }

    private func handle(horizontal: Bool, @ViewBuilder menu: () -> some View) -> some View {
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
