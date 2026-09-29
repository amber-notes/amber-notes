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
}
#endif
