#if os(macOS)
import AppKit
import Testing
@testable import Pane

@MainActor @Suite(.serialized) struct SaveTests {
    @Test func typingIsWrittenOncePausedAndFlushable() async {
        let saver = DebouncedSave()
        var writes: [String] = []
        var body = "Note"
        for s in ["Note a", "Note ab", "Note abc"] {
            saver.schedule(base: body) { if body == saver.base { writes.append(s); body = s } }
        }
        #expect(writes.isEmpty, "nothing written mid-typing")
        try? await Task.sleep(for: .seconds(DebouncedSave.delay + 0.2))
        #expect(writes == ["Note abc"], "one write, the latest text")
        saver.schedule(base: body) { if body == saver.base { writes.append("Note abcd"); body = "Note abcd" } }
        DebouncedSave.flushAll()
        #expect(writes.last == "Note abcd", "flushAll writes at once")
    }

    @Test func aChangeFromElsewhereWins() async {
        let saver = DebouncedSave()
        var body = "Note"
        saver.schedule(base: body) { if body == saver.base { body = "Note typed" } }
        body = "Note from sync" // sync or an AI rewrote it meanwhile
        saver.flush()
        #expect(body == "Note from sync")
    }

    @Test func staleNoteTextNeverOverwritesTheEditor() async {
        let h = await EditorHarness("Title\n\nHello")
        defer { h.close() }
        var reported: [String] = []
        h.view.core.onChange = { reported.append($0) }
        await h.caret(after: "Hello")
        await h.type(" world")
        // The note still has the text from before (saved once typing pauses);
        // SwiftUI hands it back to the editor, which must keep what's typed.
        h.view.syncExternal("Title\n\nHello")
        #expect(h.text == "Title\n\nHello world")
        // A real outside change does come through.
        h.view.syncExternal("Title\n\nHello from the phone")
        #expect(h.text == "Title\n\nHello from the phone")
    }

    /// A dead key (´ then e, as on a Swedish keyboard) or an input method holds marked text.
    /// An edit from another device arriving just then used to be skipped and forgotten, and
    /// the next save wrote the old text back over it.
    @Test func anEditArrivingMidCompositionIsKeptAndSoIsTheComposition() async {
        let h = await EditorHarness("Title\n\nCafe\n\nMilk")
        defer { h.close() }
        var reported: [String] = []
        h.view.core.onChange = { reported.append($0) }
        await h.caret(after: "Caf")
        h.view.setMarkedText("´", selectedRange: NSRange(location: 1, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        #expect(h.view.hasMarkedText())
        h.view.syncExternal("Title\n\nCafe\n\nOat milk")
        // Updates keep coming while composing; they must not be lost either.
        h.view.syncExternal("Title\n\nCafe\n\nOat milk")
        h.view.insertText("é", replacementRange: NSRange(location: NSNotFound, length: 0))
        await h.settle()
        #expect(h.text == "Title\n\nCafée\n\nOat milk", "both the composed letter and the other device's edit")
        #expect(reported.last == h.text, "what's saved includes the other device's edit")
    }

    @Test func mergeKeepsBothSidesUnlessTheyTouchTheSameLine() {
        #expect(TextDiff.merge(base: "A\nB\nC", mine: "A!\nB\nC", theirs: "A\nB\nC\nD") == "A!\nB\nC\nD")
        #expect(TextDiff.merge(base: "A\nB\nC", mine: "A\nB\nC\nD", theirs: "X\nB\nC") == "X\nB\nC\nD")
        #expect(TextDiff.merge(base: "A\nB", mine: "A\nBee", theirs: "A\nBuzz") == nil, "same line: no guessing")
        #expect(TextDiff.merge(base: "same", mine: "same", theirs: "new") == "new")
        #expect(TextDiff.merge(base: "same", mine: "mine", theirs: "same") == "mine")
        #expect(TextDiff.merge(base: "👍\nx", mine: "👍\nxy", theirs: "👎\nx") == "👎\nxy")
    }
}
#endif
