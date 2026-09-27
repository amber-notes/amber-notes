#if os(macOS)
import Foundation
import Testing
@testable import Pane

/// Opt-in: converts one real Apple Note and writes the markdown to $PANE_LIVE_OUT.
/// Runs only when PANE_LIVE_NOTE is set, so the normal suite never touches Apple Notes.
@MainActor
@Suite struct AppleNotesLiveTests {
    @Test func convertsARealNote() throws {
        let env = ProcessInfo.processInfo.environment
        guard let name = env["PANE_LIVE_NOTE"], let out = env["PANE_LIVE_OUT"] else { return }
        let note = try #require(try AppleNotesBridge.list().first { $0.name == name })
        let html = try AppleNotesBridge.body(of: note.id)
        let md = RichPaste.clean(RichTextToMarkdown.markdown(fromHTML: html))
        try md.write(toFile: out, atomically: true, encoding: .utf8)
        try html.write(toFile: out + ".html", atomically: true, encoding: .utf8)
        #expect(!md.isEmpty)
    }
}
#endif
