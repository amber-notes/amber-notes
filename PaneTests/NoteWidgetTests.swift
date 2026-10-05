import CryptoKit
import Foundation
import Testing
@testable import Pane

/// Note page widgets (prototype): reading a spec, working its blocks out from the note, what a
/// button press does, and the sealed files the extension reads.
@MainActor @Suite(.serialized) struct NoteWidgetTests {
    static let today = TypedTable.date(from: "2026-10-05")!
    static let habits = """
    Habits

    | Date | Walk | Read |
    | --- | --- | --- |
    | 2026-10-01 | ✓ | |
    | 2026-10-02 | ✓ | ✓ |
    | 2026-10-03 | ✓ | |
    | 2026-10-04 | ✓ | ✓ |

    - [x] Buy shoes
    - [ ] Pick a book
    """
    static let walk: [String: Any] = ["op": "toggle_today", "table": 0, "column": "Walk"]

    static func spec(_ small: [[String: Any]]) throws -> [String: Any] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: ["small": small]), as: UTF8.self)
        return try NoteWidget.parse(json)
    }

    static func blocks(_ s: WidgetSnapshot, state: String = "", day: Int = 0) -> [WidgetBlock] {
        s.days[day].states[state]?.small?.blocks ?? []
    }

    // MARK: Reading a spec

    @Test func refusesUnknownBlocksTooManyButtonsAndNonObjects() {
        #expect(throws: NoteWidget.SpecError.self) { try NoteWidget.parse(#"{"small":[{"type":"webview"}]}"#) }
        #expect(throws: NoteWidget.SpecError.self) { try NoteWidget.parse("[1]") }
        #expect(throws: NoteWidget.SpecError.self) { try NoteWidget.parse(#"{"tv":[]}"#) }
        let b = { (c: String) in #"{"type":"button","label":"x","op":{"op":"toggle_today","table":0,"column":"\#(c)"}}"# }
        #expect(throws: NoteWidget.SpecError.self) { try NoteWidget.parse(#"{"small":[\#(b("A")),\#(b("B")),\#(b("C"))]}"#) }
        #expect(throws: Never.self) { try NoteWidget.parse(#"{"small":[\#(b("A"))],"medium":[\#(b("A")),\#(b("B"))]}"#) }
    }

    @Test func theDemoSpecReads() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "demo/note-pages/habit-tracker.widget.json")
        guard let json = try? String(contentsOf: url, encoding: .utf8) else { return } // the test host may not reach the checkout
        _ = try NoteWidget.parse(json)
    }

    // MARK: Values from the note

    @Test func streakCountsBackFromYesterdayWhileTodayIsOpen() throws {
        let spec = try Self.spec([
            ["type": "number", "value": ["streak": ["table": 0, "column": "Walk"]], "label": "day streak"],
            ["type": "number", "value": ["streak": ["table": 0, "column": "Read"]]],
            ["type": "text", "text": [["done_count_today": ["table": 0]], " of ", ["habits": ["table": 0]]]],
            ["type": "text", "text": [["checked": [:]], "/", ["unchecked": [:]]]],
        ])
        let s = NoteWidget.snapshot(id: UUID(), body: Self.habits, spec: spec, now: Self.today)
        #expect(Self.blocks(s) == [.number(value: "4", label: "day streak"), .number(value: "1", label: nil), .text("0 of 2"), .text("1/1")])
        // Tomorrow, with nothing logged today, the streak has broken.
        #expect(Self.blocks(s, day: 1).first == .number(value: "0", label: "day streak"))
    }

    @Test func ringGridSumAndChart() throws {
        let spend = "Money\n\n| Date | Amount |\n| --- | --- |\n| 2026-09-20 | 100 |\n| 2026-10-01 | 40 |\n| 2026-10-05 | 2,5 |\n"
        let spec = try Self.spec([
            ["type": "ring", "value": ["done_days": ["table": 0, "column": "Walk", "days": 7]], "max": 7],
            ["type": "grid", "table": 0, "days": 3],
        ])
        let s = NoteWidget.snapshot(id: UUID(), body: Self.habits, spec: spec, now: Self.today)
        let b = Self.blocks(s)
        #expect(b.first == .ring(fraction: 4.0 / 7, center: nil, label: nil))
        guard case .grid(let days, let rows, let today) = b.last else { Issue.record("no grid"); return }
        #expect(days.count == 3 && today == 2)
        #expect(rows.map(\.name) == ["Walk", "Read"])
        #expect(rows[1].done == [false, true, false])

        let money = try Self.spec([
            ["type": "number", "value": ["sum": ["table": 0, "column": "Amount", "month": true]]],
            ["type": "chart", "series": ["table": 0, "column": "Amount", "days": 5, "agg": "sum"]],
        ])
        let m = Self.blocks(NoteWidget.snapshot(id: UUID(), body: spend, spec: money, now: Self.today))
        #expect(m.first == .number(value: TypedTable.format(42.5), label: nil))
        guard case .chart(_, let values, _) = m.last else { Issue.record("no chart"); return }
        #expect(values == [40, 0, 0, 0, 2.5])
    }

    // MARK: Buttons

    @Test func everyPressIsWorkedOutAhead() throws {
        let spec = try Self.spec([
            ["type": "number", "value": ["streak": ["table": 0, "column": "Walk"]]],
            ["type": "button", "label": "Walk", "op": Self.walk],
        ])
        let s = NoteWidget.snapshot(id: UUID(), body: Self.habits, spec: spec, now: Self.today)
        #expect(Set(s.days[0].states.keys) == ["", "0"])
        guard case .button(let b) = Self.blocks(s).last else { Issue.record("no button"); return }
        #expect(!b.on && b.next == "0")
        #expect(b.action == .setToday(table: 0, column: "Walk", value: "✓"))
        // Pressed: the streak takes today, and the button undoes it.
        #expect(Self.blocks(s, state: "0").first == .number(value: "5", label: nil))
        guard case .button(let back) = Self.blocks(s, state: "0").last else { Issue.record("no button"); return }
        #expect(back.on && back.next == "" && back.action == .setToday(table: 0, column: "Walk", value: ""))
    }

    @Test func pressesSetAnEndStateSoTheyCantFlipTheWrongWay() throws {
        let ticked = try NoteWidget.apply(.setToday(table: 0, column: "Walk", value: "✓"), to: Self.habits, today: Self.today)
        #expect(ticked.contains("| 2026-10-05 | ✓ |  |"))
        // The same press again, after another device already ticked it: nothing changes.
        #expect(try NoteWidget.apply(.setToday(table: 0, column: "Walk", value: "✓"), to: ticked, today: Self.today) == ticked)
        let cleared = try NoteWidget.apply(.setToday(table: 0, column: "Walk", value: ""), to: ticked, today: Self.today)
        #expect(cleared.contains("| 2026-10-05 |  |  |"))
        // No row for today and nothing to set: no empty row is added.
        #expect(try NoteWidget.apply(.setToday(table: 0, column: "Walk", value: ""), to: Self.habits, today: Self.today) == Self.habits)

        let book = try NoteWidget.apply(.setChecklist(text: "Pick a book", checked: true), to: Self.habits)
        #expect(book.contains("- [x] Pick a book"))
        #expect(try NoteWidget.apply(.setChecklist(text: "Pick a book", checked: true), to: book) == book)
        #expect(throws: NotePage.OpError.self) { try NoteWidget.apply(.setChecklist(text: "Nope", checked: true), to: Self.habits) }
    }

    // MARK: The files the extension reads

    @Test func snapshotsAndPressesAreSealed() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "widgets-\(UUID().uuidString)")
        WidgetShared.rootOverride = dir
        WidgetVault.keyOverride = SymmetricKey(size: .bits256)
        defer { WidgetShared.rootOverride = nil; WidgetVault.keyOverride = nil; try? FileManager.default.removeItem(at: dir) }

        let id = UUID()
        let spec = try Self.spec([["type": "button", "label": "Walk", "op": Self.walk]])
        let s = NoteWidget.snapshot(id: id, body: Self.habits, spec: spec, now: Self.today)
        try WidgetVault.write(s, create: true)
        let raw = try Data(contentsOf: try #require(WidgetVault.snapshotFile(id)))
        #expect(String(decoding: raw, as: UTF8.self).contains("Walk") == false)
        #expect(WidgetVault.snapshot(id) == s)

        try WidgetVault.press(note: id, action: .setToday(table: 0, column: "Walk", value: "✓"), next: "0")
        #expect(WidgetVault.snapshot(id)?.pending == "0")
        let presses = WidgetVault.presses()
        #expect(presses.map(\.0.action) == [.setToday(table: 0, column: "Walk", value: "✓")])

        // Another key can't read them.
        WidgetVault.keyOverride = SymmetricKey(size: .bits256)
        #expect(WidgetVault.snapshot(id) == nil)
    }
}
