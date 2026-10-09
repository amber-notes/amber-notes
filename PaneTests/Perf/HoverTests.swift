#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The pointer over a row redraws that row and nothing else: not the notes window, the
/// sidebar or the list (each counts its body in debug builds).
@MainActor @Suite(.serialized) struct HoverTests {
    @Test(.timeLimit(.minutes(2))) func hoverRedrawsOnlyTheRow() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folders = (0..<4).map { ctx.createFolder(named: "Folder \($0)") }
        for i in 0..<200 { _ = ctx.createNote(in: .folder(folders[i % 4].id), body: "Note \(i)\n\ntext") }
        try ctx.save()
        UserDefaults.standard.removeObject(forKey: "lastScope")
        HoverProbe.reset()
        HoverProbe.enabled = true
        defer { HoverProbe.enabled = false; HoverProbe.reset(); RenderProbe.counts = [:] }

        // Borderless, far off every screen and never shown: nothing appears on anyone's display.
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 1180, height: 760),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: RootView().modelContainer(c))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.close() }
        func settle() async {
            for _ in 0..<3 {
                w.contentView?.layoutSubtreeIfNeeded()
                w.displayIfNeeded()
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        await settle()
        #expect((RenderProbe.counts["NoteListView"] ?? 0) > 0, "the probe counts the list")
        RenderProbe.counts = [:]

        let clock = ContinuousClock()
        var times: [Duration] = []
        for _ in 0..<5 {
            for id in ["Folder 0", "Note 199", "All Notes", "Note 198"] {
                let start = clock.now
                #expect(HoverProbe.hover(id, true), "\(id) is a hoverable row")
                w.contentView?.layoutSubtreeIfNeeded()
                w.displayIfNeeded()
                times.append(clock.now - start)
                _ = HoverProbe.hover(id, false)
                await settle()
            }
        }
        #expect(HoverProbe.rowChanges == 40, "each hover reached its row")
        #expect(RenderProbe.counts["RootView"] == nil, "the window doesn't redraw for a hover")
        #expect(RenderProbe.counts["SidebarView"] == nil, "nor does the sidebar")
        #expect(RenderProbe.counts["NoteListView"] == nil, "nor does the list")
        times.sort()
        print("PERF hover a row: median \(times[times.count / 2]), worst \(times.last!)")
    }
}
#endif
