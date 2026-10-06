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
            // Each with the heading it sits under (the nearest one above), so an app finds them by name.
            "tables": tables(in: lines).enumerated().map { i, t in
                ["index": i, "heading": heading(above: t.header, in: lines) as Any, "columns": t.columns.map { ["name": $0.name, "type": $0.type.spec] }, "rows": t.rows] as [String: Any]
            },
            "checklists": lines.enumerated().compactMap { i, line -> [String: Any]? in
                guard let p = ListPrefix(line: line), let checked = p.checkbox else { return nil }
                return ["line": i + 1, "text": (line as NSString).substring(from: p.length), "checked": checked, "heading": heading(above: i, in: lines) as Any]
            },
        ]
    }

    /// The text of the nearest markdown heading above a line, or NSNull.
    static func heading(above line: Int, in lines: [String]) -> Any {
        var i = line - 1
        while i >= 0 {
            if let r = lines[i].range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                return String(lines[i][r.upperBound...]).trimmingCharacters(in: .whitespaces)
            }
            i -= 1
        }
        return NSNull()
    }

    /// A markdown table as the page sees it, and where its rows are in the note.
    struct Table: Equatable {
        var columns: [TypedTable.Column]
        var rows: [[String]]
        /// Line index of each row, in order.
        var rowLines: [Int]
        /// The line after the last row: where a new row goes.
        var end: Int
        /// The header line, and the type comment above it, if any.
        var header: Int = 0
        var typeLine: Int? = nil
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
            var typeLine: Int?
            if above.hasPrefix("<!--"), above.contains(TypedTable.marker), let typed = TypedTable.parse(comment: above, table: [lines[i], lines[i + 1]]) {
                for c in typed.columns { types[c.name] = c.type }
                typeLine = i - 1
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
            out.append(Table(columns: header.map { .init(name: $0, type: types[$0] ?? .text) }, rows: rows, rowLines: rowLines, end: j, header: i, typeLine: typeLine))
            i = j
        }
        return out
    }

    // MARK: Edits from the page

    /// The only changes a page can ask for.
    indirect enum Op: Equatable {
        case toggleChecklist(line: Int)
        case setCell(table: Int, row: Int, col: Column, value: String)
        case appendRow(table: Int, values: Values)
        case deleteRow(table: Int, row: Int)
        case moveRow(table: Int, from: Int, to: Int)
        /// Replaces the text under a heading (up to the next heading of the same or a higher level).
        case setText(heading: String, text: String)
        /// A new open item: after the last open item of the checklist under the heading (else the
        /// note's first checklist; with none, a new list at the end).
        case addChecklistItem(text: String, underHeading: String?)
        /// A new column at the end (or after `after`), empty in every row.
        case addColumn(table: Int, name: String, type: String?, after: Column?)
        case renameColumn(table: Int, col: Column, to: String)
        /// Several ops as one edit (one change, one Undo); all or nothing.
        case batch([Op])

        enum Column: Equatable { case index(Int), name(String) }
        enum Values: Equatable { case byName([String: String]), inOrder([String]) }

        /// Reads what the page posted. Anything else is refused, not guessed at.
        init(_ message: Any) throws {
            if let list = message as? [Any] {
                guard !list.isEmpty, list.count <= 200 else { throw OpError("Send 1 to 200 ops at once.") }
                self = .batch(try list.map { m in
                    let op = try Op(m)
                    if case .batch = op { throw OpError("Ops can't nest.") }
                    return op
                })
                return
            }
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
            case "delete_row":
                self = .deleteRow(table: try int("table"), row: try int("row"))
            case "move_row":
                self = .moveRow(table: try int("table"), from: try int("from"), to: try int("to"))
            case "add_column":
                let name = try Op.text(m["name"])
                guard !name.trimmingCharacters(in: .whitespaces).isEmpty, name.count <= 80 else { throw OpError("name must be the column's name.") }
                var after: Column?
                if let a = m["after"] as? String { after = .name(a) } else if m["after"] != nil { after = .index(try int("after")) }
                self = .addColumn(table: try int("table"), name: name, type: m["type"] as? String, after: after)
            case "rename_column":
                let col: Column
                if let name = m["col"] as? String { col = .name(name) } else { col = .index(try int("col")) }
                let to = try Op.text(m["to"])
                guard !to.trimmingCharacters(in: .whitespaces).isEmpty, to.count <= 80 else { throw OpError("to must be the new name.") }
                self = .renameColumn(table: try int("table"), col: col, to: to)
            case "add_checklist_item":
                guard let t = m["text"] as? String, !t.trimmingCharacters(in: .whitespaces).isEmpty else { throw OpError("text must be the item's text.") }
                self = .addChecklistItem(text: try Op.text(t), underHeading: m["under_heading"] as? String)
            case "set_text":
                guard let h = m["heading"] as? String, !h.trimmingCharacters(in: .whitespaces).isEmpty else { throw OpError("heading must be the heading's text.") }
                guard let t = m["text"] as? String, t.count <= 20_000 else { throw OpError("text must be text, at most 20,000 characters.") }
                self = .setText(heading: h, text: t)
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
        case .batch(let ops):
            var out = body
            for (i, o) in ops.enumerated() {
                do { out = try apply(o, to: out) } catch let e as OpError { throw OpError("Op \(i + 1): \(e.message) Nothing was changed.") }
            }
            return out
        case .addColumn(let t, let name, let type, let after):
            let table = try Self.table(t, in: lines)
            guard !table.columns.contains(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) else { throw OpError("Table \(t) already has a column \(name).") }
            let at = try after.map { try column($0, of: table) + 1 } ?? table.columns.count
            func insert(_ cells: [String], _ v: String) -> [String] { var c = cells; c.insert(v, at: at); return c }
            lines[table.header] = rowLine(insert(table.columns.map(\.name), name))
            lines[table.header + 1] = "|" + Array(repeating: " --- ", count: table.columns.count + 1).joined(separator: "|") + "|"
            for (r, line) in table.rowLines.enumerated() { lines[line] = rowLine(insert(table.rows[r], "")) }
            if let tl = table.typeLine {
                var cols = table.columns
                cols.insert(.init(name: name, type: TypedTable.ColumnType.parse(type ?? "text")), at: at)
                lines[tl] = "<!-- \(TypedTable.marker) " + cols.map { "\($0.name)=\($0.type.spec)" }.joined(separator: "; ") + " -->"
            }
        case .renameColumn(let t, let col, let to):
            let table = try Self.table(t, in: lines)
            let c = try column(col, of: table)
            guard !table.columns.enumerated().contains(where: { $0.offset != c && $0.element.name.caseInsensitiveCompare(to) == .orderedSame }) else { throw OpError("Table \(t) already has a column \(to).") }
            var names = table.columns.map(\.name)
            names[c] = to
            lines[table.header] = rowLine(names)
            if let tl = table.typeLine {
                var cols = table.columns
                cols[c].name = to
                lines[tl] = "<!-- \(TypedTable.marker) " + cols.map { "\($0.name)=\($0.type.spec)" }.joined(separator: "; ") + " -->"
            }
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
        case .deleteRow(let t, let row):
            let table = try Self.table(t, in: lines)
            guard row >= 0, row < table.rows.count else { throw OpError("Table \(t) has \(table.rows.count) rows (0-\(table.rows.count - 1)).") }
            lines.remove(at: table.rowLines[row])
        case .moveRow(let t, let from, let to):
            let table = try Self.table(t, in: lines)
            let n = table.rows.count
            guard from >= 0, from < n, to >= 0, to < n else { throw OpError("Table \(t) has \(n) rows (0-\(n - 1)).") }
            guard from != to else { return body }
            let line = lines.remove(at: table.rowLines[from])
            lines.insert(line, at: table.rowLines[to])
        case .addChecklistItem(let text, let under):
            func level(_ l: String) -> Int? {
                let hashes = l.prefix { $0 == "#" }.count
                return (1...6).contains(hashes) && l.dropFirst(hashes).first == " " ? hashes : nil
            }
            var from = 0, to = lines.count
            if let under {
                let want = under.trimmingCharacters(in: .whitespaces).lowercased()
                guard let at = lines.firstIndex(where: { l in level(l) != nil && l.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces).lowercased() == want }) else {
                    throw OpError("No heading \(under).")
                }
                let lv = level(lines[at])!
                from = at + 1
                to = from
                while to < lines.count, (level(lines[to]).map { $0 > lv } ?? true) { to += 1 }
            }
            let item = "- [ ] " + text
            var checks = (from..<to).filter { ListPrefix(line: lines[$0])?.checkbox != nil }
            // One checklist: the run of checklist lines starting at the first.
            if let first = checks.first {
                var end = first
                while end + 1 < to, ListPrefix(line: lines[end + 1])?.checkbox != nil { end += 1 }
                checks = checks.filter { $0 <= end }
            }
            if let lastOpen = checks.last(where: { ListPrefix(line: lines[$0])?.checkbox == false }) {
                let indent = ListPrefix(line: lines[lastOpen])?.indent ?? ""
                lines.insert(indent + item, at: lastOpen + 1)
            } else if let first = checks.first {
                // Only ticked items: the new one goes above them, as open items do.
                lines.insert((ListPrefix(line: lines[first])?.indent ?? "") + item, at: first)
            } else {
                var at = to
                while at > from, lines[at - 1].trimmingCharacters(in: .whitespaces).isEmpty { at -= 1 }
                lines.insert(item, at: at)
                if at > 0, !lines[at - 1].trimmingCharacters(in: .whitespaces).isEmpty, ListPrefix(line: lines[at - 1]) == nil { lines.insert("", at: at) }
            }
        case .setText(let heading, let text):
            let want = heading.trimmingCharacters(in: .whitespaces).lowercased()
            func level(_ l: String) -> Int? {
                let hashes = l.prefix { $0 == "#" }.count
                return (1...6).contains(hashes) && l.dropFirst(hashes).first == " " ? hashes : nil
            }
            guard let at = lines.firstIndex(where: { l in level(l).map { _ in l.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces).lowercased() == want } ?? false }),
                  let lv = level(lines[at]) else { throw OpError("No heading \(heading).") }
            var end = at + 1
            while end < lines.count, (level(lines[end]).map { $0 > lv } ?? true) { end += 1 }
            // The section's text, then one blank line before the next heading.
            var section = text.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n")
            while section.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { section.removeLast() }
            if end < lines.count { section.append("") }
            lines.replaceSubrange((at + 1)..<end, with: section)
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

/// The pages this device has, per note: the HTML, who made it and when, and the pages before it.
/// Kept beside the library in its own file, like AIEditStore, so the SwiftData model doesn't change.
///
/// No page is ever dropped here: a page that's replaced or removed goes to the note's history (the
/// last 10), and bringing one back puts the current one into history in its place.
@MainActor
@Observable
final class NotePageStore {
    struct Page: Codable, Equatable {
        var html: String
        var by: String
        var at: Date
    }

    static let keep = 10
    static let shared = NotePageStore(file: PaneApp.isUnitTestHost || ProcessInfo.processInfo.arguments.contains("-uitest") ? nil : defaultFile)

    private(set) var pages: [UUID: Page] = [:]
    /// Earlier pages per note, oldest first.
    private(set) var history: [UUID: [Page]] = [:]
    /// Pages changed on this device (Remove App, Previous App, a fallback) and when, to push.
    private(set) var unpushed: [UUID: Date] = [:]
    @ObservationIgnored private let file: URL?

    /// Versions that didn't open on this device (a script error, nothing drawn, too slow), by their
    /// text's hash: never shown again unless you ask (Undo on "Reverted…").
    private(set) var broken: [UUID: Set<String>] = [:]
    /// An AI's newer version that failed its checks, kept on the server as a draft (it never comes
    /// here): who, and what failed. Shown in App Info.
    struct Draft: Equatable { var by: String; var problems: String }
    private(set) var drafts: [UUID: Draft] = [:]

    func setDraft(_ id: UUID, problems: String?, by: String?) {
        drafts[id] = problems.map { Draft(by: by ?? "Your AI", problems: $0) }
    }

    /// A version you asked for after it was reverted: shown even though it failed.
    private(set) var forced: [UUID: String] = [:]

    private struct Saved: Codable { var pages: [UUID: Page]; var history: [UUID: [Page]]; var unpushed: [UUID: Date]?; var broken: [UUID: Set<String>]? }

    init(file: URL?) {
        self.file = file
        if let file, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            pages = saved.pages
            history = saved.history
            broken = saved.broken ?? [:]
            unpushed = saved.unpushed ?? [:]
        }
        for (id, p) in pages { NoteWidgets.update(id, html: p.html) }
    }

    static var defaultFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane/note-pages.json")
    }

    /// Setting a different page (or none) keeps the one it replaces in history.
    subscript(id: UUID) -> Page? {
        get { pages[id] }
        set {
            let old = pages[id]
            guard old != newValue else { return }
            if let old, old.html != newValue?.html { remember(old, for: id); forced[id] = nil }
            pages[id] = newValue
            NoteWidgets.update(id, html: newValue?.html)
            save()
        }
    }

    /// The version to run: the newest one that passed its checks (a project the tooling tested; a
    /// one-file app has none and counts as passing) and hasn't failed to open here. A newer version
    /// that failed is kept, in its place in history, and goes live once a passing one follows it.
    /// With none that qualifies, the newest.
    func live(_ id: UUID) -> Page? {
        guard let now = pages[id] else { return nil }
        let candidates = [now] + (history[id] ?? []).reversed()
        if let f = forced[id], let page = candidates.first(where: { Self.hash($0.html) == f }) { return page }
        return candidates.first { Self.passes($0.html) && !(broken[id]?.contains(Self.hash($0.html)) ?? false) } ?? now
    }

    /// The tooling's verdict, in the project: "checks": { "passed": false, ... } holds a version back.
    static func passes(_ stored: String) -> Bool {
        guard NotePageProject.isProject(stored),
              let o = try? JSONSerialization.jsonObject(with: Data(stored.utf8)) as? [String: Any],
              let checks = o["checks"] as? [String: Any] else { return true }
        return checks["passed"] as? Bool ?? true
    }

    /// Why a version was held back, from its checks.
    static func checkProblems(_ stored: String) -> [String] {
        guard let o = try? JSONSerialization.jsonObject(with: Data(stored.utf8)) as? [String: Any],
              let checks = o["checks"] as? [String: Any] else { return [] }
        return (checks["errors"] as? [String]) ?? []
    }

    static func hash(_ text: String) -> String { E2EE.sha256Hex(text) }

    /// It didn't open here: the next one back runs instead.
    func markBroken(_ id: UUID, _ page: Page) {
        broken[id, default: []].insert(Self.hash(page.html))
        if forced[id] == Self.hash(page.html) { forced[id] = nil }
        save()
    }

    /// Undo on "Reverted…": run this version anyway.
    func force(_ id: UUID, _ page: Page) {
        forced[id] = Self.hash(page.html)
        broken[id]?.remove(Self.hash(page.html))
        save()
    }

    /// The page before this one, if any.
    func previous(_ id: UUID) -> Page? { history[id]?.last }

    /// A change made here (Remove App): kept and pushed to the other devices.
    func setHere(_ id: UUID, _ page: Page?) {
        self[id] = page
        unpushed[id] = .now
        save()
        SyncSignal.changed()
    }

    /// Pushed: the server has this device's page.
    func pushed(_ id: UUID, at: Date) {
        if unpushed[id] == at { unpushed[id] = nil }
        save()
    }

    /// Brings the last earlier page back; the current one takes its place in history. Pushed to the
    /// other devices like any change here.
    @discardableResult
    func restorePrevious(_ id: UUID) -> Page? {
        guard var h = history[id], let back = h.popLast() else { return nil }
        if let now = pages[id] { h.append(now) }
        history[id] = h.suffix(Self.keep).map { $0 }
        pages[id] = back
        NoteWidgets.update(id, html: back.html)
        unpushed[id] = .now
        save()
        SyncSignal.changed()
        return back
    }

    private func remember(_ page: Page, for id: UUID) {
        var h = history[id] ?? []
        h.removeAll { $0.html == page.html }
        h.append(page)
        history[id] = Array(h.suffix(Self.keep))
    }

    /// A page from the server. One that won't open with this device's key is left as it was.
    func take(_ r: NotePageDTO) {
        // A change here that the server hasn't seen yet wins over an older one from it.
        if let mine = unpushed[r.note_id] {
            if mine > r.updated_at { return }
            unpushed[r.note_id] = nil
        }
        guard let box = r.page_ct else { self[r.note_id] = nil; return }
        guard let html = Wire.sealer?.open(box, context: E2EE.page(r.note_id)) else { return }
        self[r.note_id] = Page(html: html, by: r.client ?? "AI", at: r.updated_at)
    }

    func forgetAll() {
        pages = [:]
        history = [:]
        unpushed = [:]
        if let file { try? FileManager.default.removeItem(at: file) }
    }

    private func save() {
        guard let file, let data = try? JSONEncoder().encode(Saved(pages: pages, history: history, unpushed: unpushed, broken: broken)) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
