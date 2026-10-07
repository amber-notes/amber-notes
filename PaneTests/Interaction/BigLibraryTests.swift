#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Whole-app windows with extreme libraries: 5,000 notes in one folder, 500 folders,
/// folders nested 30 deep, hostile names. The window must come up and stay responsive.
@MainActor @Suite(.serialized) struct BigLibraryTests {
    private func window(_ c: ModelContainer, size: CGSize = CGSize(width: 1180, height: 760)) -> NSWindow {
        // Borderless and far off screen, never ordered front: a titled window gets pulled back
        // onto the display (AppSnapshotTests.onScreenAllowed).
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: size.width, height: size.height),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: RootView().modelContainer(c))
        w.setContentSize(size)
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        return w
    }

    private func firstDisplay(_ w: NSWindow) async -> Double {
        let t = ContinuousClock.now
        w.contentView?.layoutSubtreeIfNeeded()
        // Drawn into the window's buffer; the window itself never shows.
        w.contentView?.display()
        let d = ContinuousClock.now - t
        try? await Task.sleep(for: .milliseconds(300))
        return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    @Test(.timeLimit(.minutes(3))) func fiveThousandNotesAndFiveHundredFolders() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let big = Folder(name: "Everything")
        ctx.insert(big)
        for i in 0..<5000 {
            let n = Note(body: "Note \(i)\n\nSome text for note \(i)", folder: big)
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 60)
            ctx.insert(n)
        }
        for i in 0..<500 { ctx.insert(Folder(name: "Folder \(i)")) }
        // Nested 30 deep, and names that fight the layout.
        var parent: Folder? = nil
        for i in 0..<30 {
            let f = Folder(name: i % 3 == 0 ? String(repeating: "Very long folder name ", count: 10) : "Level \(i) \u{202E}lrt\u{202C} 👨‍👩‍👧‍👦")
            f.parent = parent
            ctx.insert(f)
            parent = f
        }
        ctx.insert(Note(body: "Z" + String(repeating: "\u{0336}\u{0337}", count: 500) + "\nzalgo", folder: big))
        ctx.insert(Note(body: String(repeating: "Long title ", count: 100) + "\nbody", folder: big))
        try ctx.save()
        let w = window(c)
        defer { w.orderOut(nil); w.close() }
        let first = await firstDisplay(w)
        print("PERF 5,000 notes + 560 folders: first display \(Int(first)) ms")
        #expect(first < 3000, "the window comes up in reasonable time")
        // Later updates stay cheap: one more note arrives.
        let t = ContinuousClock.now
        ctx.insert(Note(body: "Arrived\n\nfrom sync", folder: big))
        try ctx.save()
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        let upd = ContinuousClock.now - t
        print("PERF 5,000 notes: one note arrives \(upd)")
        #expect(upd < .seconds(1) * PerfBudget.slack)
    }

    /// While you type (or another device or an AI does), the open note is written every 0.35 s.
    /// Each write used to rebuild every row's drag and swipe setup: 250 ms a write at 1,000
    /// notes (Release). Only the changed note's row is rebuilt now.
    @Test(.timeLimit(.minutes(3))) func editsInABigListStayCheap() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let home = Folder(name: "Notes")
        ctx.insert(home)
        ctx.insert(Folder(name: "Work"))
        var notes: [Note] = []
        for i in 0..<1000 {
            let n = Note(body: "Note \(i)\n\nSome text for note \(i)", folder: home)
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 600)
            ctx.insert(n)
            notes.append(n)
        }
        try ctx.save()
        let w = window(c)
        defer { w.orderOut(nil); w.close() }
        _ = await firstDisplay(w)
        var times: [Duration] = []
        for i in 0..<9 {
            let t = ContinuousClock.now
            notes[i * 5].body = "Edited \(i)\n\nas if typed"
            notes[i * 5].updatedAt = .now
            try ctx.save()
            w.contentView?.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            times.append(ContinuousClock.now - t)
            try? await Task.sleep(for: .milliseconds(30))
        }
        let median = times.sorted()[times.count / 2]
        print("PERF 1,000 notes: one note edited \(median) (median)")
        #expect(median < .milliseconds(400) * PerfBudget.slack)
    }

    @Test(.timeLimit(.minutes(2))) func tinyAndHugeWindows() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        Seed.ensureLibrary(c.mainContext, demo: true)
        try c.mainContext.save()
        for size in [CGSize(width: 320, height: 240), CGSize(width: 7000, height: 4000), CGSize(width: 760, height: 520)] {
            let w = window(c, size: size)
            _ = await firstDisplay(w)
            #expect(w.contentView != nil)
            w.orderOut(nil); w.close()
        }
    }
}
#endif

