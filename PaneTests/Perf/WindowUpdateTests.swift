#if os(macOS)
import AppKit
import Observation
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// What the notes window works out again when something small happens: a sidebar toggle,
/// a save while you type. These used to rebuild the whole window.
@MainActor @Suite(.serialized) struct WindowUpdateTests {
    func ms(_ d: Duration) -> Double { Double(d.components.attoseconds) / 1e15 + Double(d.components.seconds) * 1000 }

    /// The split view writes its column state to the defaults on every sidebar toggle. A flag
    /// kept there must not tell its views about writes to other keys (with @AppStorage it did,
    /// and AppGate rebuilt the whole notes window on every toggle).
    @Test func defaultsFlagChangesOnlyWithItsOwnKey() async throws {
        let defaults = try #require(UserDefaults(suiteName: "WindowUpdateTests.\(UUID().uuidString)"))
        let flag = DefaultsFlag(DeviceRemoval.noticeFlag, defaults: defaults)
        // Observation calls back off the main actor's view of things; a box keeps the count.
        final class Count: @unchecked Sendable { var value = 0 }
        let count = Count()
        var changes: Int { count.value }
        func watch() { withObservationTracking { _ = flag.value } onChange: { count.value += 1 } }

        watch()
        defaults.set(Data([1, 2, 3]), forKey: "NSSplitView Subview Frames main, SidebarNavigationSplitView")
        defaults.set(true, forKey: "showInMenuBar")
        try await Task.sleep(for: .milliseconds(100))
        #expect(changes == 0, "other keys leave the flag's views alone")

        defaults.set(true, forKey: DeviceRemoval.noticeFlag)
        try await Task.sleep(for: .milliseconds(100))
        #expect(changes == 1)
        #expect(flag.value)

        watch()
        flag.value = false
        #expect(changes == 2)
        #expect(defaults.bool(forKey: DeviceRemoval.noticeFlag) == false)
    }

    /// The sidebar counts in the store. Notes made, deleted or recovered count straight away,
    /// before the library is saved.
    @Test func sidebarCountsIncludeUnsavedChanges() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let notes = (0..<5).map { ctx.createNote(in: .all, body: "Note \($0)\n\ntext") }
        let tombstone = ctx.createNote(in: .all, body: "Gone")
        tombstone.deletedAt = .now
        try ctx.save()
        #expect(SidebarView.counts(in: ctx) == (live: 5, trashed: 0))

        let made = ctx.createNote(in: .all, body: "Made\n\nnot saved")
        #expect(SidebarView.counts(in: ctx) == (live: 6, trashed: 0))
        notes[0].trashedAt = .now
        made.trashedAt = .now
        #expect(SidebarView.counts(in: ctx) == (live: 4, trashed: 2))
        made.trashedAt = nil
        #expect(SidebarView.counts(in: ctx) == (live: 5, trashed: 1))
    }

    /// The editor writes the open note every 0.35 s while you type. With 2,000 notes each write
    /// used to fetch and sort every note twice (the list and the sidebar) and rebuild both twice.
    @Test(.timeLimit(.minutes(3))) func savingTheOpenNoteInABigLibrary() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folders = (0..<6).map { ctx.createFolder(named: "Folder \($0)") }
        var open: Note?
        for i in 0..<2000 {
            let n = Note(body: "Note \(i)\n\nSome text for note \(i), with **bold** and a list:\n- one\n- two\n", folder: folders[i % folders.count])
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 3600)
            ctx.insert(n)
            if i == 1 { open = n }
        }
        try ctx.save()
        let note = try #require(open)
        let w = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: 1180, height: 760),
                         styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: RootView().modelContainer(c))
        w.setContentSize(CGSize(width: 1180, height: 760))
        w.setFrameOrigin(CGPoint(x: -30000, y: -30000))
        defer { w.orderOut(nil); w.close() }
        w.orderFrontRegardless()
        NoteOpener.shared.request = note.id
        for _ in 0..<3 {
            w.contentView?.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            try? await Task.sleep(for: .milliseconds(200))
        }
        var times: [Double] = []
        for i in 0..<9 {
            let t = ContinuousClock.now
            note.body += " \(i)"
            note.touch()
            // The change reaches the queries once the run loop turns, as it does in the app.
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(1))
            w.contentView?.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            times.append(ms(ContinuousClock.now - t))
            try? await Task.sleep(for: .milliseconds(100))
        }
        times.sort()
        let median = times[times.count / 2]
        print("PERF 2,000 notes: save of the open note → window updated, median \(String(format: "%.1f", median)) ms")
        #expect(median < 120 * PerfBudget.slack, "a save while typing stays well under a tenth of a second")
    }
}
#endif
