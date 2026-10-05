import SwiftData
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Screenshots and recordings of wiki links (`-uitest`): a vault brought in by the real
/// importer at launch, in place of the file picker, then a note opened.
///   `-uitest -importVault <folder or .zip> -openAfterImport Home`
/// On the Mac, `-wikiTour <dir>` then follows links the way a click does, makes a note a link
/// names, and types a link, with no input events. It writes `<dir>/window-id` when the window is
/// placed and `<dir>/finished` at the end.
extension Capture {
    /// Captures: the "Create note?" question for a missing note is answered yes.
    static let wikiCreate = Notification.Name("pane.captureWikiCreate")

    @MainActor static func importVaultFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let path = argument("-importVault") else { return }
        Task { @MainActor in
            let url = URL(fileURLWithPath: path)
            _ = await MarkdownImporter(context: context).run([MarkdownImporter.inspect(url)], into: .perSource)
            WikiDirectory.invalidate()
            if let title = argument("-openAfterImport"),
               let note = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).first(where: { $0.title == title && $0.deletedAt == nil }) {
                NoteOpener.shared.request = note.id
            }
            #if os(macOS)
            if let dir = argument("-wikiTour") { await wikiTour(dir: URL(fileURLWithPath: dir)) }
            #endif
        }
    }

    #if os(macOS)
    @MainActor private static func wikiTour(dir: URL) async {
        func wait(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }
        func editors(in view: NSView?) -> [PaneTextView] {
            guard let view else { return [] }
            return (view as? PaneTextView).map { [$0] } ?? view.subviews.flatMap { editors(in: $0) }
        }
        var window: NSWindow?
        for _ in 0..<100 where window == nil {
            window = NSApp.windows.first { w in editors(in: w.contentView).contains { $0.string.hasPrefix("Home") } }
            if window == nil { await wait(0.1) }
        }
        guard let w = window else {
            let seen = NSApp.windows.map { "\($0.windowNumber) \($0.frame) visible:\($0.isVisible) editors:\(editors(in: $0.contentView).map { String($0.string.prefix(20)) })" }
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? seen.joined(separator: "\n").write(to: dir.appending(path: "no-window.txt"), atomically: true, encoding: .utf8)
            return
        }
        w.setContentSize(NSSize(width: 1180, height: 720))
        if let screen = NSScreen.screens.max(by: { $0.backingScaleFactor < $1.backingScaleFactor }) {
            let f = w.frame, v = screen.visibleFrame
            w.setFrameOrigin(NSPoint(x: v.midX - f.width / 2, y: v.midY - f.height / 2))
        }
        // Frames are taken of this window alone (screencapture -l), so it stays wherever it is
        // and never takes the front from what you're doing.
        w.makeFirstResponder(nil)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? "\(w.windowNumber)".write(to: dir.appending(path: "window-id"), atomically: true, encoding: .utf8)
        // The recording starts once the window id is out.
        for _ in 0..<100 where !FileManager.default.fileExists(atPath: dir.appending(path: "recording").path) { await wait(0.1) }
        await wait(2)

        var editor: PaneTextView? { editors(in: w.contentView).first }
        /// Clicks a link by the text it shows, through the text view's own click handler.
        func follow(_ shown: String) async {
            guard let e = editor, let storage = e.textStorage else { return }
            let r = (e.string as NSString).range(of: shown)
            guard r.location != NSNotFound, let url = storage.attribute(.link, at: r.location, effectiveRange: nil) else { return }
            _ = e.textView(e, clickedOnLink: url, at: r.location)
            await wait(2.4)
        }
        /// Types like a person, a character at a time.
        func type(_ s: String) async {
            guard let e = editor else { return }
            for c in s {
                e.insertText(String(c), replacementRange: e.selectedRange())
                await wait(c == " " ? 0.09 : 0.06)
            }
        }

        await follow("Inbox")
        await follow("raised beds")
        await follow("Garden irrigation")
        await wait(0.6)
        NotificationCenter.default.post(name: wikiCreate, object: nil)
        await wait(1.6)
        if let e = editor {
            w.makeFirstResponder(e)
            e.setSelectedRange(NSRange(location: (e.string as NSString).length, length: 0))
        }
        await type("Drip line from the rain barrel to the [[kit")
        await wait(1.4)
        editor?.doCommand(by: #selector(NSResponder.moveDown(_:)))
        await wait(0.6)
        editor?.doCommand(by: #selector(NSResponder.moveUp(_:)))
        await wait(0.6)
        editor?.doCommand(by: #selector(NSResponder.insertNewline(_:)))
        await wait(0.6)
        await type(" plan.")
        await wait(1.2)
        w.makeFirstResponder(nil)
        await wait(1.2)
        await follow("Kitchen remodel")
        await wait(1)
        try? "".write(to: dir.appending(path: "finished"), atomically: true, encoding: .utf8)
    }
    #endif
}
