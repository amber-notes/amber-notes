import Foundation
import Testing
@testable import Pane

/// Near-live sync: what arrives lands as a small edit, typing keeps flowing out, and a
/// note you're editing is never overwritten.
@MainActor
@Suite struct LiveSyncTests {
    // MARK: The edit that arrives

    @Test func onlyTheChangedMiddleIsReplaced() throws {
        let e = try #require(TextDiff.edit(from: "Groceries\n- milk\n- eggs", to: "Groceries\n- oat milk\n- eggs"))
        #expect(e.range == NSRange(location: 12, length: 0))
        #expect(e.replacement == "oat ")
        #expect(TextDiff.edit(from: "same", to: "same") == nil)
    }

    @Test func deletionsAndAppendsAreSmall() throws {
        let cut = try #require(TextDiff.edit(from: "one two three", to: "one three"))
        #expect(cut.range.length == 4 && cut.replacement.isEmpty)
        #expect(("one two three" as NSString).replacingCharacters(in: cut.range, with: "") == "one three")
        let add = try #require(TextDiff.edit(from: "abc", to: "abcdef"))
        #expect(add.range == NSRange(location: 3, length: 0) && add.replacement == "def")
    }

    @Test func emojiAreNeverSplit() throws {
        // 👍 and 👎 share their first UTF-16 unit; the edit must still cover whole characters.
        let old = "vote 👍 now", new = "vote 👎 now"
        let e = try #require(TextDiff.edit(from: old, to: new))
        let result = (old as NSString).replacingCharacters(in: e.range, with: e.replacement)
        #expect(result == new)
        #expect(e.replacement == "👎")
    }

    @Test func applyingTheEditAlwaysGivesTheNewText() {
        let samples = ["", "a", "hello world", "# Title\n\n- [ ] one\n- [x] two", "🙂🙃 x", "aaaa", "abab"]
        for old in samples {
            for new in samples {
                guard let e = TextDiff.edit(from: old, to: new) else { #expect(old == new); continue }
                #expect((old as NSString).replacingCharacters(in: e.range, with: e.replacement) == new)
            }
        }
    }

    // MARK: Your caret

    @Test func theCaretStaysWithItsText() {
        // Someone inserts "oat " before where you are: you move with your text.
        let e = TextDiff.Edit(range: NSRange(location: 12, length: 0), replacement: "oat ")
        #expect(TextDiff.map(NSRange(location: 20, length: 0), through: e) == NSRange(location: 24, length: 0))
        // Before the change: nothing moves.
        #expect(TextDiff.map(NSRange(location: 3, length: 2), through: e) == NSRange(location: 3, length: 2))
        // Inside text that was replaced: you land at the end of what arrived.
        let r = TextDiff.Edit(range: NSRange(location: 5, length: 5), replacement: "XY")
        #expect(TextDiff.map(NSRange(location: 7, length: 0), through: r) == NSRange(location: 7, length: 0))
        // A selection spanning the change grows with it.
        #expect(TextDiff.map(NSRange(location: 2, length: 10), through: r) == NSRange(location: 2, length: 7))
    }

    // MARK: Typing keeps flowing out

    @Test func continuousTypingIsWrittenAtLeastEveryMaxWait() {
        let saver = DebouncedSave()
        var writes = 0
        let start = Date.now
        // Type for a second, a key every 50 ms, without ever pausing 0.4 s. The keystrokes carry
        // their own times, so a busy test machine can't stretch the gaps between them.
        for key in 0..<20 {
            saver.schedule(base: "", now: start.addingTimeInterval(Double(key) * 0.05)) { writes += 1 }
        }
        #expect(writes >= 2, "the note reaches the model while you type, not only when you stop")
        saver.cancel()
    }

    @Test func aPauseStillWritesOnce() async throws {
        let saver = DebouncedSave()
        var writes = 0
        saver.schedule(base: "") { writes += 1 }
        try await Task.sleep(for: .milliseconds(600))
        #expect(writes == 1)
    }

    // MARK: Never overwrite what you're editing

    private func row(_ n: Note, body: String? = nil, version: Int64) -> NoteDTO {
        var r = NoteDTO(n)
        if let body { r.body = body }
        r.version = version
        return r
    }

    @Test func unsentLocalEditsWin() {
        let n = Note(body: "mine, typed just now")
        n.serverVersion = 4
        n.dirty = true
        #expect(!SyncEngine.takes(row(n, body: "theirs", version: 5), over: n))
    }

    @Test func ourOwnPushComingBackIsIgnored() {
        let n = Note(body: "hello")
        n.serverVersion = 7
        n.dirty = false  // synced: nothing of ours is waiting
        #expect(!SyncEngine.takes(row(n, version: 7), over: n))
    }

    @Test func outOfOrderEventsAreIgnored() {
        let n = Note(body: "newer")
        n.serverVersion = 9
        n.dirty = false  // synced: nothing of ours is waiting
        #expect(!SyncEngine.takes(row(n, body: "older", version: 8), over: n))
    }

    @Test func anotherDevicesEditIsTaken() {
        let n = Note(body: "hello")
        n.serverVersion = 3
        n.dirty = false  // synced: nothing of ours is waiting
        #expect(SyncEngine.takes(row(n, body: "hello from my phone", version: 4), over: n))
    }
}
