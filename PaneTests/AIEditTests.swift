import Foundation
import Testing
@testable import Pane

/// An AI's edit arriving: which lines count as changed, what "seen" means, Undo, and the
/// columns the server sends.
@MainActor @Suite struct AIEditTests {
    /// A note on its own; nothing here needs a store.
    static func note(_ body: String) -> Note { Note(body: body) }

    /// What the sync engine does with a row that carries an AI's edit.
    static func arrive(_ n: Note, body: String, by ai: String = "ChatGPT", at: Date = .now, quiet: Bool = false) {
        let old = n.body, oldAt = n.aiEditedAt
        n.body = body
        n.aiEditor = ai
        n.aiEditedAt = at
        AIEdit.arrived(n, previousBody: old, previousEditAt: oldAt, quiet: quiet)
    }

    @Test func addedAndTickedLinesCountMovedAndBlankDont() {
        let old = "Groceries\n\n- [ ] Oat milk\n- [ ] Lemons\n- [x] Eggs"
        let new = "Groceries\n\n- [ ] Saffron\n- [ ] Oat milk\n\n- [x] Eggs\n- [x] Lemons"
        // Saffron is new, Lemons was ticked; the blank line isn't a change.
        #expect(ChangeTint.changedLines(from: old, to: new) == [2, 6])
        // Reordering alone lights nothing.
        #expect(ChangeTint.changedLines(from: "A\nB\nC", to: "C\nA\nB").isEmpty)
    }

    @Test func aDuplicateLineElsewhereStaysUntinted() {
        let old = "- [ ] Oat milk\n- [ ] Lemons"
        let new = "- [ ] Oat milk\n- [ ] Lemons\n- [ ] Oat milk"
        let ranges = ChangeTint.paragraphRanges(changedFrom: old, to: new)
        #expect(ranges == [NSRange(location: 28, length: 14)])
        #expect((new as NSString).substring(with: ranges[0]) == "- [ ] Oat milk")
    }

    @Test func paragraphRangesIncludeTheirNewline() {
        let ranges = ChangeTint.paragraphRanges(changedFrom: "A\nC", to: "A\nB\nC")
        #expect(ranges == [NSRange(location: 2, length: 2)])
    }

    @Test func anAIEditIsUnseenUntilOpenedThenGivesOneReceipt() throws {
        let n = Self.note("To-do\n\n- [ ] Call the bank")
        #expect(!AIEdit.isUnseen(n))
        Self.arrive(n, body: "To-do\n\n- [ ] Call the bank\n- [ ] Call mom", by: "Claude")
        #expect(AIEdit.isUnseen(n))
        let r = try #require(AIEdit.markSeen(n))
        #expect(r.by == "Claude" && r.lines == 1 && r.summary == "Claude changed 1 line")
        #expect(r.previous == "To-do\n\n- [ ] Call the bank")
        #expect(!AIEdit.isUnseen(n))
        #expect(n.aiPrevious == nil)
        #expect(AIEdit.markSeen(n) == nil, "the receipt shows once")
    }

    @Test func twoEditsBeforeYouLookCompareWithTheTextBeforeTheFirst() throws {
        let n = Self.note("List")
        Self.arrive(n, body: "List\nOne", at: .now.addingTimeInterval(-5))
        Self.arrive(n, body: "List\nOne\nTwo")
        let r = try #require(AIEdit.markSeen(n))
        #expect(r.previous == "List" && r.lines == 2)
    }

    @Test func aRowWithTheSameAIEditIsNotNewsAgain() throws {
        let n = Self.note("List")
        let at = Date.now
        Self.arrive(n, body: "List\nOne", at: at)
        _ = AIEdit.markSeen(n)
        // You edit it on another device: the row comes back with the same AI time.
        let old = n.body
        n.body = "List\nOne\nMine"
        AIEdit.arrived(n, previousBody: old, previousEditAt: at, quiet: false)
        #expect(!AIEdit.isUnseen(n))
    }

    @Test func theFirstSyncOfALibraryTreatsOldAIEditsAsSeen() throws {
        let n = Self.note("")
        Self.arrive(n, body: "Made by an AI last week", quiet: true)
        #expect(!AIEdit.isUnseen(n))
    }

    @Test func undoPutsTheTextBackAsYourOwnEdit() throws {
        let n = Self.note("Plan\n\nFriday")
        n.dirty = false
        Self.arrive(n, body: "Plan\n\nSaturday")
        let r = try #require(AIEdit.markSeen(n))
        AIEdit.undo(r, on: n)
        #expect(n.body == "Plan\n\nFriday")
        #expect(n.dirty, "it syncs back up")
        #expect(!AIEdit.isUnseen(n), "undoing doesn't bring the marker back")
    }

    @Test func theServersColumnsAreReadButNeverSent() throws {
        let json = #"{"id":"6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55","body":"x","is_pinned":false,"created_at":"2026-09-29T10:00:00Z","updated_at":"2026-09-29T10:00:00Z","ai_editor":"ChatGPT","ai_edited_at":"2026-09-29T11:48:00Z"}"#
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        let row = try d.decode(NoteDTO.self, from: Data(json.utf8))
        #expect(row.ai_editor == "ChatGPT" && row.ai_edited_at != nil)
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        let sent = String(decoding: try e.encode(row), as: UTF8.self)
        #expect(!sent.contains("ai_editor") && !sent.contains("ai_edited_at"))
    }
}

#if os(macOS)
/// The tint in the real editor: only the changed paragraphs, and typing clears it.
@MainActor @Suite(.serialized) struct ChangeTintEditorTests {
    @Test func tintsOnlyTheChangedParagraphAndTypingClearsIt() async {
        let text = "- [ ] Oat milk\n- [ ] Lemons\n- [ ] Oat milk"
        let h = await EditorHarness(text, focus: false)
        defer { h.close() }
        let tint = h.view.core.layoutDelegate.tint
        h.view.tintChanges(from: "- [ ] Oat milk\n- [ ] Lemons")
        await h.settle(0.5)
        #expect(tint.strength(at: 0) == 0, "the first Oat milk was already there")
        #expect(tint.strength(at: 28) > 0, "the new Oat milk is tinted")
        await h.type("x")
        #expect(tint.strength(at: 28) == 0)
    }

    @Test func fadesOnItsOwn() async {
        let h = await EditorHarness("A\nB", focus: false)
        defer { h.close() }
        let tint = h.view.core.layoutDelegate.tint
        h.view.tintChanges(from: "A")
        await h.settle(0.6)
        #expect(tint.strength(at: 2) > 0)
        await h.settle(5.2)
        #expect(tint.strength(at: 2) == 0)
        #expect(tint.ranges.isEmpty)
    }
}
#endif
