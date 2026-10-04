import Foundation
import Observation

/// Note pages (prototype): an optional view an AI writes over a note. The note's markdown stays
/// the data; a page is one self-contained HTML document that shows it, rendered in a sandbox with
/// no network (NotePageView). The page gets the note as data and can change it only through a few
/// edits, which the app applies to the markdown like any other edit. Deleting a page loses nothing.
///
/// What a page sees, as `window.amber.note`:
///
///     { title, markdown, today: "yyyy-mm-dd",
///       tables: [{ index, columns: [{ name, type }], rows: [[cell]] }],
///       checklists: [{ line, text, checked }] }
enum NotePage {
    /// The note as the page gets it. `today` is this device's calendar day.
    static func data(of body: String, today: Date = .now) -> [String: Any] {
        let lines = body.components(separatedBy: "\n")
        return [
            "title": NoteText.title(of: body),
            "markdown": body,
            "today": TypedTable.day(today),
            "tables": tables(in: lines).enumerated().map { i, t in
                ["index": i, "columns": t.columns.map { ["name": $0.name, "type": $0.type.spec] }, "rows": t.rows] as [String: Any]
            },
            "checklists": lines.enumerated().compactMap { i, line -> [String: Any]? in
                guard let p = ListPrefix(line: line), let checked = p.checkbox else { return nil }
                return ["line": i + 1, "text": (line as NSString).substring(from: p.length), "checked": checked]
            },
        ]
    }

    /// A markdown table as the page sees it, and where its rows are in the note.
    struct Table: Equatable {
        var columns: [TypedTable.Column]
        var rows: [[String]]
        /// Line index of each row, in order.
        var rowLines: [Int]
        /// The line after the last row: where a new row goes.
        var end: Int
    }

    /// Every table in the note, in order: a header line, a separator line and its rows, with an
    /// optional `<!-- pane-table: … -->` line above giving column types.
    static func tables(in lines: [String]) -> [Table] {
        var out: [Table] = []
        var i = 0
        func isRow(_ l: String) -> Bool { l.trimmingCharacters(in: .whitespaces).hasPrefix("|") }
        func isSeparator(_ l: String) -> Bool {
            let t = l.trimmingCharacters(in: .whitespaces)
            return t.hasPrefix("|") && t.contains("-") && t.allSatisfy { "|-: ".contains($0) }
        }
        while i < lines.count {
            guard isRow(lines[i]), i + 1 < lines.count, isSeparator(lines[i + 1]) else { i += 1; continue }
            var types: [String: TypedTable.ColumnType] = [:]
            let above = i > 0 ? lines[i - 1].trimmingCharacters(in: .whitespaces) : ""
            if above.hasPrefix("<!--"), above.contains(TypedTable.marker), let typed = TypedTable.parse(comment: above, table: [lines[i], lines[i + 1]]) {
                for c in typed.columns { types[c.name] = c.type }
            }
            let header = TypedTable.cells(lines[i])
            var rows: [[String]] = [], rowLines: [Int] = []
            var j = i + 2
            while j < lines.count, isRow(lines[j]) {
                var c = TypedTable.cells(lines[j])
                if c.count < header.count { c += Array(repeating: "", count: header.count - c.count) }
                rows.append(Array(c.prefix(header.count)))
                rowLines.append(j)
                j += 1
            }
            out.append(Table(columns: header.map { .init(name: $0, type: types[$0] ?? .text) }, rows: rows, rowLines: rowLines, end: j))
            i = j
        }
        return out
    }

    // MARK: Edits from the page

    /// The only changes a page can ask for.
    enum Op: Equatable {
        case toggleChecklist(line: Int)
        case setCell(table: Int, row: Int, col: Column, value: String)
        case appendRow(table: Int, values: Values)

        enum Column: Equatable { case index(Int), name(String) }
        enum Values: Equatable { case byName([String: String]), inOrder([String]) }

        /// Reads what the page posted. Anything else is refused, not guessed at.
        init(_ message: Any) throws {
            guard let m = message as? [String: Any], let op = m["op"] as? String else { throw OpError("Send { op, … }.") }
            func int(_ k: String) throws -> Int {
                if let n = m[k] as? Int { return n }
                if let d = m[k] as? Double, d == d.rounded() { return Int(d) }
                throw OpError("\(k) must be a whole number.")
            }
            switch op {
            case "toggle_checklist":
                self = .toggleChecklist(line: try int("line"))
            case "set_cell":
                let col: Column
                if let name = m["col"] as? String { col = .name(name) } else { col = .index(try int("col")) }
                self = .setCell(table: try int("table"), row: try int("row"), col: col, value: try Op.text(m["value"]))
            case "append_row":
                if let d = m["values"] as? [String: Any] {
                    self = .appendRow(table: try int("table"), values: .byName(try d.mapValues(Op.text)))
                } else if let a = m["values"] as? [Any] {
                    self = .appendRow(table: try int("table"), values: .inOrder(try a.map(Op.text)))
                } else {
                    throw OpError("values must be an object or a list.")
                }
            default:
                throw OpError("Unknown op \(op).")
            }
        }

        /// A cell's text: one line, a number or a bool written out, at most 500 characters.
        static func text(_ v: Any?) throws -> String {
            let s: String
            switch v {
            case let x as String: s = x
            case let x as Bool: s = x ? "Yes" : "No"
            case let x as Int: s = String(x)
            case let x as Double: s = x == x.rounded() && abs(x) < 1e15 ? String(Int(x)) : String(x)
            case nil, is NSNull: s = ""
            default: throw OpError("Cell values are text.")
            }
            guard s.count <= 500 else { throw OpError("A cell holds at most 500 characters.") }
            return s.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        }
    }

    struct OpError: LocalizedError, Equatable {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }

    /// The note after the page's edit. Only the lines the edit is about change.
    static func apply(_ op: Op, to body: String) throws -> String {
        var lines = body.components(separatedBy: "\n")
        switch op {
        case .toggleChecklist(let line):
            guard line >= 1, line <= lines.count, ListPrefix(line: lines[line - 1])?.checkbox != nil else {
                throw OpError("Line \(line) isn't a checklist item.")
            }
            // As a tap on the checkbox in the editor: flip it, then ticked items sink.
            let start = lines[..<(line - 1)].reduce(0) { $0 + ($1 as NSString).length + 1 }
            guard let flip = ListEditing.toggleCheckbox(in: body, lineStart: start) else { throw OpError("Line \(line) isn't a checklist item.") }
            let flipped = (body as NSString).replacingCharacters(in: flip.range, with: flip.replacement)
            guard let sort = ListEditing.sortChecklist(in: flipped, around: start, caret: -1) else { return flipped }
            return (flipped as NSString).replacingCharacters(in: sort.range, with: sort.replacement)
        case .setCell(let t, let row, let col, let value):
            let table = try Self.table(t, in: lines)
            guard row >= 0, row < table.rows.count else { throw OpError("Table \(t) has \(table.rows.count) rows (0-\(table.rows.count - 1)).") }
            let c = try column(col, of: table)
            var cells = table.rows[row]
            cells[c] = value
            lines[table.rowLines[row]] = rowLine(cells)
        case .appendRow(let t, let values):
            let table = try Self.table(t, in: lines)
            var cells = Array(repeating: "", count: table.columns.count)
            switch values {
            case .inOrder(let v):
                guard v.count <= cells.count else { throw OpError("Table \(t) has \(cells.count) columns.") }
                for (i, x) in v.enumerated() { cells[i] = x }
            case .byName(let d):
                for (name, x) in d { cells[try column(.name(name), of: table)] = x }
            }
            lines.insert(rowLine(cells), at: table.end)
        }
        return lines.joined(separator: "\n")
    }

    private static func table(_ i: Int, in lines: [String]) throws -> Table {
        let all = tables(in: lines)
        guard i >= 0, i < all.count else { throw OpError(all.isEmpty ? "This note has no table." : "Table \(i) doesn't exist (0-\(all.count - 1)).") }
        return all[i]
    }

    private static func column(_ c: Op.Column, of t: Table) throws -> Int {
        switch c {
        case .index(let i):
            guard i >= 0, i < t.columns.count else { throw OpError("Column \(i) doesn't exist (0-\(t.columns.count - 1)).") }
            return i
        case .name(let n):
            guard let i = t.columns.firstIndex(where: { $0.name.caseInsensitiveCompare(n) == .orderedSame }) else {
                throw OpError("No column \(n). Columns: \(t.columns.map(\.name).joined(separator: ", ")).")
            }
            return i
        }
    }

    private static func rowLine(_ cells: [String]) -> String {
        "| " + cells.map { $0.replacingOccurrences(of: "|", with: "\\|") }.joined(separator: " | ") + " |"
    }
}

/// The pages this device has, per note: the HTML, who made it and when. Kept beside the library
/// in its own file, like AIEditStore, so the SwiftData model doesn't change.
@MainActor
@Observable
final class NotePageStore {
    struct Page: Codable, Equatable {
        var html: String
        var by: String
        var at: Date
    }

    static let shared = NotePageStore(file: PaneApp.isUnitTestHost || ProcessInfo.processInfo.arguments.contains("-uitest") ? nil : defaultFile)

    private(set) var pages: [UUID: Page] = [:]
    @ObservationIgnored private let file: URL?

    init(file: URL?) {
        self.file = file
        if let file, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([UUID: Page].self, from: data) {
            pages = saved
        }
    }

    static var defaultFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane/note-pages.json")
    }

    subscript(id: UUID) -> Page? {
        get { pages[id] }
        set {
            guard pages[id] != newValue else { return }
            pages[id] = newValue
            save()
        }
    }

    /// A page from the server. One that won't open with this device's key is left as it was.
    func take(_ r: NotePageDTO) {
        guard let box = r.page_ct else { self[r.note_id] = nil; return }
        guard let html = Wire.sealer?.open(box, context: E2EE.page(r.note_id)) else { return }
        self[r.note_id] = Page(html: html, by: r.client ?? "AI", at: r.updated_at)
    }

    func forgetAll() {
        pages = [:]
        if let file { try? FileManager.default.removeItem(at: file) }
    }

    private func save() {
        guard let file, let data = try? JSONEncoder().encode(pages) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
