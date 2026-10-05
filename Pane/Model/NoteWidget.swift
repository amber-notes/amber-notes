import Foundation
import Observation
import SwiftData
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Home-screen widgets for note pages (prototype), the app's half (WidgetShared has the rest).
///
/// A page can declare a widget: JSON made of a fixed set of blocks whose values bind to the note's
/// tables and checklists. The app works the blocks out here (the extension never sees the note)
/// and writes them for the extension. A spec:
///
///     { "small": [block, …], "medium": [...], "large": [...], "circular": [...], "rectangular": [...] }
///
/// Blocks, each `{ "type": … }`:
///     title  { text, sub? }          text   { text }           number { value, label? }
///     ring   { value, max, center?, label? }                    bar    { value, max, label? }
///     list   { checklist: true, limit? } | { items: [value] } | { table, column, last? }
///     chart  { series, kind: "bar" | "line" }                   grid   { table, columns?, days? }
///     button { label, op }           row    { blocks: [block] }
///
/// A value is text, a number, a list of values (joined), or one binding:
///     { streak: { table, column } }        days in a row it's done, back from today (or yesterday while today's open)
///     { done_today: { table, column } }    { done_days: { table, column, days } }
///     { done_count_today: { table } }      { habits: { table } }   (columns other than the date)
///     { rows: { table } }  { sum: { table, column, days?, month? } }  { latest: { table, column } }
///     { checked: {} }  { unchecked: {} }  { title: {} }
/// A series: { table, column, days, agg: "sum" | "done" } per day, or { table, column, last } per row.
/// A button op: { op: "toggle_today", table, column, value? } or { op: "toggle_checklist", text }.
enum NoteWidget {
    static let maxBlocks = 8
    static let maxButtons = 2
    static let maxSpecBytes = 8 * 1024
    static let faceNames = ["small", "medium", "large", "circular", "rectangular"]
    static let done = try! NSRegularExpression(pattern: #"^(✓|✔|x|yes|y|1|true|done)$"#, options: .caseInsensitive)

    static func isDone(_ cell: String) -> Bool {
        let t = cell.trimmingCharacters(in: .whitespaces)
        return done.firstMatch(in: t, range: NSRange(location: 0, length: (t as NSString).length)) != nil
    }

    struct SpecError: LocalizedError, Equatable {
        let message: String
        init(_ m: String) { message = m }
        var errorDescription: String? { message }
    }

    /// The spec as JSON, checked for shape (what it binds to is checked against the note when drawn).
    static func parse(_ json: String) throws -> [String: Any] {
        guard json.utf8.count <= maxSpecBytes else { throw SpecError("A widget is at most \(maxSpecBytes / 1024) KB.") }
        guard let d = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw SpecError("A widget is a JSON object.") }
        let faces = faceNames.filter { d[$0] != nil }
        guard !faces.isEmpty else { throw SpecError("Give at least one size: \(faceNames.joined(separator: ", ")).") }
        var ops: Set<String> = []
        for f in faces {
            guard let blocks = d[f] as? [Any] else { throw SpecError("\(f) is a list of blocks.") }
            guard blocks.count <= maxBlocks else { throw SpecError("\(f) has \(blocks.count) blocks; at most \(maxBlocks).") }
            for b in flatten(blocks) {
                guard let t = b["type"] as? String else { throw SpecError("Every block has a type.") }
                guard ["title", "text", "number", "ring", "bar", "list", "chart", "grid", "button", "row"].contains(t) else { throw SpecError("Unknown block type \(t).") }
                if t == "button" {
                    guard let op = b["op"] as? [String: Any], ["toggle_today", "toggle_checklist"].contains(op["op"] as? String ?? "") else {
                        throw SpecError("A button's op is toggle_today or toggle_checklist.")
                    }
                    ops.insert(key(op))
                }
            }
        }
        guard ops.count <= maxButtons else { throw SpecError("A widget has at most \(maxButtons) different buttons.") }
        return d
    }

    private static func flatten(_ blocks: [Any]) -> [[String: Any]] {
        blocks.compactMap { $0 as? [String: Any] }.flatMap { b in [b] + ((b["type"] as? String) == "row" ? flatten(b["blocks"] as? [Any] ?? []) : []) }
    }

    private static func key(_ any: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: any, options: .sortedKeys)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    }

    // MARK: Drawing

    /// The widget for a note, worked out for today and tomorrow and every set of button presses.
    static func snapshot(id: UUID, body: String, spec: [String: Any], now: Date = .now, calendar: Calendar = .current) -> WidgetSnapshot {
        let buttons = Array(Set(flatten(faceNames.flatMap { spec[$0] as? [Any] ?? [] }).filter { ($0["type"] as? String) == "button" }.compactMap { $0["op"] as? [String: Any] }.map(key))).sorted()
        let today = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today)!
        let subsets = (0..<(1 << buttons.count)).map { m in buttons.indices.filter { m & (1 << $0) != 0 } }
        func stateKey(_ s: [Int]) -> String { s.map(String.init).joined(separator: ",") }
        let days = [today, tomorrow].map { day in
            var states: [String: WidgetSnapshot.Faces] = [:]
            for s in subsets {
                // The note as it would be with these buttons pressed (each press flips its item).
                var b = body
                for i in s {
                    let op = (try? JSONSerialization.jsonObject(with: Data(buttons[i].utf8))) as? [String: Any] ?? [:]
                    if let a = action(op, body: b, today: day) { b = (try? apply(a, to: b, today: day)) ?? b }
                }
                let ctx = Context(body: b, today: day, calendar: calendar) { op in
                    let i = buttons.firstIndex(of: key(op)) ?? 0
                    let next = s.contains(i) ? s.filter { $0 != i } : (s + [i]).sorted()
                    return stateKey(next)
                }
                states[stateKey(s)] = ctx.faces(spec)
            }
            return WidgetSnapshot.Day(start: day, states: states)
        }
        return WidgetSnapshot(noteID: id, title: NoteText.title(of: body), written: now, days: days)
    }

    /// What pressing a button does to this note now: the end state it sets.
    static func action(_ op: [String: Any], body: String, today: Date) -> WidgetAction? {
        switch op["op"] as? String {
        case "toggle_today":
            guard let t = op["table"] as? Int, let col = op["column"] as? String else { return nil }
            let on = Context(body: body, today: today, calendar: .current).doneToday(table: t, column: col) ?? false
            return .setToday(table: t, column: col, value: on ? "" : (op["value"] as? String ?? "✓"))
        case "toggle_checklist":
            guard let text = op["text"] as? String else { return nil }
            let item = Context(body: body, today: today, calendar: .current).checklist.first { $0.text == text }
            return .setChecklist(text: text, checked: !(item?.checked ?? false))
        default:
            return nil
        }
    }

    /// The note with a button's edit applied, as the page's own edits are (NotePage.apply).
    static func apply(_ a: WidgetAction, to body: String, today: Date = .now) throws -> String {
        switch a {
        case .setToday(let t, let column, let value):
            let tables = NotePage.tables(in: body.components(separatedBy: "\n"))
            guard t >= 0, t < tables.count else { throw NotePage.OpError("Table \(t) doesn't exist.") }
            let table = tables[t]
            let dateCol = Context.dateColumn(table)
            let day = TypedTable.day(today)
            if let r = table.rows.firstIndex(where: { $0[dateCol].trimmingCharacters(in: .whitespaces) == day }) {
                guard let c = table.columns.firstIndex(where: { $0.name.caseInsensitiveCompare(column) == .orderedSame }) else { throw NotePage.OpError("No column \(column).") }
                if isDone(table.rows[r][c]) == isDone(value) { return body }
                return try NotePage.apply(.setCell(table: t, row: r, col: .index(c), value: value), to: body)
            }
            if !isDone(value) { return body }
            return try NotePage.apply(.appendRow(table: t, values: .byName([table.columns[dateCol].name: day, column: value])), to: body)
        case .setChecklist(let text, let checked):
            guard let item = Context(body: body, today: today, calendar: .current).checklist.first(where: { $0.text == text }) else {
                throw NotePage.OpError("No checklist item \(text).")
            }
            if item.checked == checked { return body }
            return try NotePage.apply(.toggleChecklist(line: item.line), to: body)
        }
    }

    /// One note's data, for working blocks out.
    struct Context {
        var body: String
        var today: Date
        var calendar: Calendar
        var nextState: ([String: Any]) -> String = { _ in "" }
        let tables: [NotePage.Table]
        let checklist: [(line: Int, text: String, checked: Bool)]

        init(body: String, today: Date, calendar: Calendar, nextState: @escaping ([String: Any]) -> String = { _ in "" }) {
            self.body = body
            self.today = today
            self.calendar = calendar
            self.nextState = nextState
            let lines = body.components(separatedBy: "\n")
            tables = NotePage.tables(in: lines)
            checklist = lines.enumerated().compactMap { i, line in
                guard let p = ListPrefix(line: line), let c = p.checkbox else { return nil }
                return (i + 1, (line as NSString).substring(from: p.length).trimmingCharacters(in: .whitespaces), c)
            }
        }

        /// A column named Date, else the first date-typed one, else the first.
        static func dateColumn(_ t: NotePage.Table) -> Int {
            t.columns.firstIndex { $0.name.caseInsensitiveCompare("date") == .orderedSame } ?? t.columns.firstIndex { $0.type == .date } ?? 0
        }

        func table(_ a: Any?) -> NotePage.Table? {
            guard let i = a as? Int, i >= 0, i < tables.count else { return nil }
            return tables[i]
        }

        func column(_ t: NotePage.Table, _ name: Any?) -> Int? {
            guard let n = name as? String else { return nil }
            return t.columns.firstIndex { $0.name.caseInsensitiveCompare(n) == .orderedSame }
        }

        func day(_ offset: Int) -> String { TypedTable.day(calendar.date(byAdding: .day, value: offset, to: today)!, calendar: calendar) }

        func cell(_ t: NotePage.Table, day: String, col: Int) -> String? {
            let dc = Self.dateColumn(t)
            return t.rows.last { $0[dc].trimmingCharacters(in: .whitespaces) == day }?[col]
        }

        func done(_ t: NotePage.Table, col: Int, offset: Int) -> Bool { cell(t, day: day(offset), col: col).map(isDone) ?? false }

        func doneToday(table: Int, column: String) -> Bool? {
            guard let t = self.table(table), let c = self.column(t, column) else { return nil }
            return done(t, col: c, offset: 0)
        }

        func habits(_ t: NotePage.Table) -> [Int] { t.columns.indices.filter { $0 != Self.dateColumn(t) } }

        func number(_ s: String) -> Double? {
            Double(s.replacingOccurrences(of: ",", with: ".").filter { $0.isNumber || $0 == "." || $0 == "-" })
        }

        // MARK: Values

        enum Value { case text(String), number(Double), bool(Bool) }

        func value(_ v: Any?) -> Value? {
            switch v {
            case let s as String: return .text(s)
            case let b as Bool: return .bool(b)
            case let n as NSNumber: return .number(n.doubleValue)
            case let parts as [Any]: return .text(parts.compactMap { value($0).map(text) }.joined())
            case let d as [String: Any]:
                guard let (name, arg) = d.first, d.count == 1 else { return nil }
                return binding(name, arg as? [String: Any] ?? [:])
            default: return nil
            }
        }

        func text(_ v: Value) -> String {
            switch v {
            case .text(let s): s
            case .number(let n): TypedTable.format(n)
            case .bool(let b): b ? "Done" : "Not yet"
            }
        }

        func double(_ v: Value?) -> Double? {
            switch v {
            case .number(let n): n
            case .text(let s): number(s)
            case .bool(let b): b ? 1 : 0
            case nil: nil
            }
        }

        func binding(_ name: String, _ a: [String: Any]) -> Value? {
            switch name {
            case "title": return .text(NoteText.title(of: body))
            case "checked": return .number(Double(checklist.filter(\.checked).count))
            case "unchecked": return .number(Double(checklist.filter { !$0.checked }.count))
            default: break
            }
            guard let t = table(a["table"] ?? 0) else { return nil }
            switch name {
            case "rows": return .number(Double(t.rows.count))
            case "habits": return .number(Double(habits(t).count))
            case "done_count_today": return .number(Double(habits(t).filter { done(t, col: $0, offset: 0) }.count))
            default: break
            }
            guard let c = column(t, a["column"]) else { return nil }
            switch name {
            case "streak":
                // From today when it's done, else from yesterday: today isn't over.
                var o = done(t, col: c, offset: 0) ? 0 : -1, n = 0
                while done(t, col: c, offset: o), n < 3650 { n += 1; o -= 1 }
                return .number(Double(n))
            case "done_today":
                return .bool(done(t, col: c, offset: 0))
            case "done_days":
                let days = max(1, min(a["days"] as? Int ?? 7, 366))
                return .number(Double((0..<days).filter { done(t, col: c, offset: -$0) }.count))
            case "latest":
                return t.rows.last.map { .text($0[c]) }
            case "sum":
                let dc = Self.dateColumn(t)
                let rows = t.rows.filter { r in
                    guard let d = TypedTable.date(from: r[dc].trimmingCharacters(in: .whitespaces), calendar: calendar) else { return a["days"] == nil && a["month"] == nil }
                    if let days = a["days"] as? Int, d <= calendar.date(byAdding: .day, value: -days, to: today)! || d > today { return false }
                    if (a["month"] as? Bool) == true, !calendar.isDate(d, equalTo: today, toGranularity: .month) { return false }
                    return true
                }
                return .number(rows.compactMap { number($0[c]) }.reduce(0, +))
            default:
                return nil
            }
        }

        func series(_ s: [String: Any]) -> (values: [Double], labels: [String]) {
            guard let t = table(s["table"] ?? 0), let c = column(t, s["column"]) else { return ([], []) }
            if let last = s["last"] as? Int {
                let rows = t.rows.suffix(max(1, min(last, 31)))
                return (rows.map { number($0[c]) ?? 0 }, rows.map { $0[Self.dateColumn(t)] })
            }
            let days = max(1, min(s["days"] as? Int ?? 7, 31))
            let offsets = Array((1 - days)...0)
            let dc = Self.dateColumn(t)
            let values = offsets.map { o -> Double in
                let d = day(o)
                let rows = t.rows.filter { $0[dc].trimmingCharacters(in: .whitespaces) == d }
                return (s["agg"] as? String) == "done" ? (rows.contains { isDone($0[c]) } ? 1 : 0) : rows.compactMap { number($0[c]) }.reduce(0, +)
            }
            return (values, offsets.map(letter))
        }

        func letter(_ offset: Int) -> String {
            let d = calendar.date(byAdding: .day, value: offset, to: today)!
            return calendar.veryShortWeekdaySymbols[calendar.component(.weekday, from: d) - 1]
        }

        // MARK: Blocks

        func faces(_ spec: [String: Any]) -> WidgetSnapshot.Faces {
            func face(_ name: String) -> WidgetFace? {
                (spec[name] as? [Any]).map { WidgetFace(blocks: $0.prefix(maxBlocks).compactMap(block)) }
            }
            return .init(small: face("small"), medium: face("medium"), large: face("large"), circular: face("circular"), rectangular: face("rectangular"))
        }

        func block(_ any: Any) -> WidgetBlock? {
            guard let b = any as? [String: Any] else { return nil }
            let str = { (k: String) in b[k].flatMap(value).map(text) }
            func fraction() -> Double {
                guard let v = double(value(b["value"])), let m = double(value(b["max"])), m > 0 else { return 0 }
                return min(1, max(0, v / m))
            }
            switch b["type"] as? String {
            case "title": return .title(text: str("text") ?? NoteText.title(of: body), sub: str("sub"))
            case "text": return str("text").map(WidgetBlock.text)
            case "number": return .number(value: str("value") ?? "–", label: str("label"))
            case "ring": return .ring(fraction: fraction(), center: str("center"), label: str("label"))
            case "bar": return .bar(fraction: fraction(), label: str("label"))
            case "list":
                let limit = max(1, min(b["limit"] as? Int ?? 4, 8))
                if (b["checklist"] as? Bool) == true {
                    // Open items first, as the editor sinks ticked ones.
                    return .list(checklist.sorted { !$0.checked && $1.checked }.prefix(limit).map { .init(text: $0.text, done: $0.checked) })
                }
                if let items = b["items"] as? [Any] {
                    return .list(items.prefix(limit).compactMap { value($0).map(text) }.map { .init(text: $0, done: nil) })
                }
                guard let t = table(b["table"] ?? 0), let c = column(t, b["column"]) else { return nil }
                return .list(t.rows.suffix(limit).reversed().map { .init(text: $0[c], done: nil) })
            case "chart":
                let s = series(b["series"] as? [String: Any] ?? [:])
                return .chart(line: (b["kind"] as? String) == "line", values: s.values, labels: s.labels)
            case "grid":
                guard let t = table(b["table"] ?? 0) else { return nil }
                let days = max(3, min(b["days"] as? Int ?? 7, 14))
                let cols = (b["columns"] as? [String])?.compactMap { column(t, $0) } ?? habits(t)
                let offsets = Array((1 - days)...0)
                return .grid(days: offsets.map(letter), rows: cols.prefix(6).map { c in .init(name: t.columns[c].name, done: offsets.map { done(t, col: c, offset: $0) }) }, today: days - 1)
            case "button":
                guard let op = b["op"] as? [String: Any], let a = NoteWidget.action(op, body: body, today: today) else { return nil }
                let on: Bool
                switch a {
                case .setToday(_, _, let v): on = !isDone(v)
                case .setChecklist(_, let checked): on = !checked
                }
                return .button(.init(label: str("label") ?? "Done", on: on, action: a, next: nextState(op)))
            case "row":
                return .row((b["blocks"] as? [Any] ?? []).prefix(3).compactMap(block))
            default:
                return nil
            }
        }
    }
}

/// Widget specs per note: the JSON an AI set with set_note_widget, who and when. Kept beside the
/// library in its own file, as NotePageStore keeps pages.
@MainActor
@Observable
final class NoteWidgetStore {
    struct Widget: Codable, Equatable {
        var spec: String
        var by: String
        var at: Date
    }

    static let shared = NoteWidgetStore(file: PaneApp.isUnitTestHost || ProcessInfo.processInfo.arguments.contains("-uitest") ? nil : defaultFile)

    private(set) var widgets: [UUID: Widget] = [:]
    @ObservationIgnored private let file: URL?

    init(file: URL?) {
        self.file = file
        if let file, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([UUID: Widget].self, from: data) { widgets = saved }
    }

    static var defaultFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane/note-widgets.json")
    }

    subscript(id: UUID) -> Widget? {
        get { widgets[id] }
        set {
            guard widgets[id] != newValue else { return }
            widgets[id] = newValue
            save()
            NotificationCenter.default.post(name: NoteWidgets.changed, object: nil)
        }
    }

    /// A widget from the server. One that won't open with this device's key is left as it was.
    func take(_ r: NotePageDTO) {
        guard let box = r.widget_ct else { self[r.note_id] = nil; return }
        guard let json = Wire.sealer?.open(box, context: E2EE.widget(r.note_id)) else { return }
        self[r.note_id] = Widget(spec: json, by: r.client ?? "AI", at: r.updated_at)
    }

    func forgetAll() {
        widgets = [:]
        if let file { try? FileManager.default.removeItem(at: file) }
        WidgetVault.removeAll()
        NoteWidgets.reload()
    }

    private func save() {
        guard let file, let data = try? JSONEncoder().encode(widgets) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// Keeps the extension's copies current, and applies the widget's button presses to notes.
@MainActor
enum NoteWidgets {
    static let changed = Notification.Name("pane.noteWidgetsChanged")
    /// Who the note's receipt names for an edit made from a widget.
    static let by = "Widget"

    /// Writes every widget the extension shows, removes the ones whose note is gone or locked, and
    /// asks WidgetKit to redraw when anything changed.
    static func publish(_ context: ModelContext, now: Date = .now) {
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        let byID = Dictionary(notes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var changed = false
        for (id, w) in NoteWidgetStore.shared.widgets {
            guard let note = byID[id], note.deletedAt == nil, note.trashedAt == nil, !note.isLocked, let spec = try? NoteWidget.parse(w.spec) else {
                if WidgetVault.snapshot(id) != nil { WidgetVault.remove(id); changed = true }
                continue
            }
            var s = NoteWidget.snapshot(id: id, body: note.body, spec: spec, now: now)
            if let old = WidgetVault.snapshot(id) {
                // Same as what's there (bar the time it was written): leave it, and WidgetKit's budget.
                s.written = old.written
                if old.days == s.days, old.title == s.title, old.pending.isEmpty { continue }
                s.written = now
            }
            if (try? WidgetVault.write(s, create: true)) != nil { changed = true }
        }
        for s in WidgetVault.snapshots() where NoteWidgetStore.shared[s.noteID] == nil { WidgetVault.remove(s.noteID); changed = true }
        if changed { reload() }
    }

    static func reload() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetShared.kind)
        #endif
    }

    /// Presses from the widget, applied as edits: the note syncs, keeps a version, and opening it
    /// tints the change with a receipt that offers Undo (as an AI's edit does).
    @discardableResult
    static func applyPresses(_ context: ModelContext, now: Date = .now) -> Int {
        let presses = WidgetVault.presses()
        guard !presses.isEmpty else { return 0 }
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        var applied = 0
        for (p, file) in presses {
            defer { try? FileManager.default.removeItem(at: file) }
            guard let note = notes.first(where: { $0.id == p.noteID && $0.deletedAt == nil }), !note.isLocked else { continue }
            // A press is for the day it was made; a stale one (left overnight) still lands on its own day.
            guard let after = try? NoteWidget.apply(p.action, to: note.body, today: p.at), after != note.body else { continue }
            let before = note.body, oldAt = note.aiEditedAt
            note.body = after
            note.touch()
            note.aiEditor = by
            note.aiEditedAt = max(now, (oldAt ?? .distantPast).addingTimeInterval(0.001))
            AIEdit.arrived(note, previousBody: before, previousEditAt: oldAt, quiet: false)
            applied += 1
        }
        try? context.save()
        publish(context, now: now)
        return applied
    }

    /// The running app hears the extension's presses at once (the Mac, or an iPhone in the foreground).
    static func listen(_ context: ModelContext) {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        Listener.shared.onPress = { applyPresses(context) }
        CFNotificationCenterAddObserver(center, Unmanaged.passUnretained(Listener.shared).toOpaque(), { _, _, _, _, _ in
            DispatchQueue.main.async { MainActor.assumeIsolated { Listener.shared.onPress?() } }
        }, WidgetShared.actionNotification as CFString, nil, .deliverImmediately)
        // Any saved change to a note can change what a widget shows.
        Listener.shared.context = context
        Listener.shared.saves = NotificationCenter.default.addObserver(forName: ModelContext.didSave, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Listener.shared.publishSoon() }
        }
        Listener.shared.specs = NotificationCenter.default.addObserver(forName: changed, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Listener.shared.publishSoon() }
        }
        applyPresses(context)
        publish(context)
    }

    @MainActor
    final class Listener {
        static let shared = Listener()
        var onPress: (() -> Void)?
        var context: ModelContext?
        var saves: (any NSObjectProtocol)?
        var specs: (any NSObjectProtocol)?
        private var pending: Task<Void, Never>?

        func publishSoon() {
            pending?.cancel()
            pending = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled, let context = self.context else { return }
                NoteWidgets.publish(context)
            }
        }
    }
}
