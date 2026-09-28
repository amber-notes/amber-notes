import SwiftUI

/// A plain markdown table, edited as a grid of cells like Apple Notes.
/// The note keeps standard markdown; every change is written straight back.
struct GridTable: Equatable {
    var rows: [[String]]
    var range: NSRange
    var index: Int

    var columns: Int { rows.map(\.count).max() ?? 0 }

    /// Plain markdown tables in the text (typed trackers and code blocks excluded).
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
            let typed = i > 0 && ns.substring(with: lines[i - 1]).contains(TypedTable.marker)
            var j = i
            while isRow(j) { j += 1 }
            if !typed {
                let range = NSRange(location: lines[i].location, length: NSMaxRange(lines[j - 1]) - lines[i].location)
                out.append(from(lines: (i..<j).map { ns.substring(with: lines[$0]) }, range: range, index: out.count))
            }
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
        var out = [line(rows.first ?? []), "|" + Array(repeating: " --- ", count: width).joined(separator: "|") + "|"]
        out += rows.dropFirst().map(line)
        return out.joined(separator: "\n")
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

struct TableGridView: View {
    let table: GridTable
    /// Writes the edited table back into the note.
    let commit: (GridTable) -> Void
    /// Which cell to focus when the table appears (a just-inserted table).
    var initialFocus: GridCell?

    @State private var draft: GridTable
    @FocusState private var focus: GridCell?

    init(table: GridTable, initialFocus: GridCell?, commit: @escaping (GridTable) -> Void) {
        self.table = table
        self.commit = commit
        self.initialFocus = initialFocus
        _draft = State(initialValue: table)
    }

    var body: some View {
        GeometryReader { geo in
            let cols = max(draft.columns, 1)
            let width = geo.size.width - GridMetrics.handle
            let colWidth = max(width / CGFloat(cols), 90)
            VStack(alignment: .leading, spacing: 0) {
                // Column handle above the focused column.
                ZStack(alignment: .leading) {
                    Color.clear.frame(height: GridMetrics.handle)
                    if let f = focus {
                        handle(horizontal: true) { columnMenu(f.column) }
                            .offset(x: GridMetrics.handle + CGFloat(f.column) * colWidth + colWidth / 2 - 14)
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
                    grid(cols: cols, colWidth: colWidth)
                }
            }
        }
        .onChange(of: table) { _, new in if new != draft { draft = new } }
        .onAppear { if let initialFocus { DispatchQueue.main.async { focus = initialFocus } } }
    }

    private func grid(cols: Int, colWidth: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<draft.rows.count, id: \.self) { r in
                HStack(spacing: 0) {
                    ForEach(0..<cols, id: \.self) { c in
                        TextField("", text: cellBinding(r, c))
                            .textFieldStyle(.plain)
                            .font(.system(size: EditorMetrics.body))
                            .padding(.horizontal, 8)
                            .frame(width: colWidth, height: GridMetrics.row, alignment: .leading)
                            .focused($focus, equals: GridCell(row: r, column: c))
                            .onSubmit { move(from: GridCell(row: r, column: c), by: cols) }
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
            if press.modifiers.contains(.shift) { step(from: f, by: -1, cols: cols) } else { step(from: f, by: 1, cols: cols) }
            return .handled
        }
    }

    private var border: Color { Color.secondary.opacity(0.45) }

    private func cellBinding(_ r: Int, _ c: Int) -> Binding<String> {
        Binding(
            get: { c < draft.rows[r].count ? draft.rows[r][c] : "" },
            set: { value in
                while draft.rows[r].count <= c { draft.rows[r].append("") }
                draft.rows[r][c] = value
                commit(draft)
            })
    }

    /// Tab walks cells; past the last cell it adds a row.
    private func step(from f: GridCell, by delta: Int, cols: Int) {
        var flat = f.row * cols + f.column + delta
        if flat >= draft.rows.count * cols {
            draft.rows.append(Array(repeating: "", count: cols))
            commit(draft)
        }
        flat = max(0, flat)
        focus = GridCell(row: flat / cols, column: flat % cols)
    }

    /// Return moves down a row, adding one at the bottom.
    private func move(from f: GridCell, by cols: Int) {
        if f.row == draft.rows.count - 1 {
            draft.rows.append(Array(repeating: "", count: cols))
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
        Button("Add Row Above") { edit { $0.rows.insert(Array(repeating: "", count: $0.columns), at: r) } }
        Button("Add Row Below") { edit { $0.rows.insert(Array(repeating: "", count: $0.columns), at: r + 1) } }
        Divider()
        Button("Delete Row", role: .destructive) { edit { if $0.rows.count > 1 { $0.rows.remove(at: r) } } }
    }

    @ViewBuilder
    private func columnMenu(_ c: Int) -> some View {
        Button("Add Column Before") { edit { t in t.rows = t.rows.map { var r = $0; r.insert("", at: min(c, r.count)); return r } } }
        Button("Add Column After") { edit { t in t.rows = t.rows.map { var r = $0; r.insert("", at: min(c + 1, r.count)); return r } } }
        Divider()
        Button("Delete Column", role: .destructive) {
            edit { t in if t.columns > 1 { t.rows = t.rows.map { var r = $0; if c < r.count { r.remove(at: c) }; return r } } }
        }
    }

    private func edit(_ change: (inout GridTable) -> Void) {
        change(&draft)
        commit(draft)
    }
}
