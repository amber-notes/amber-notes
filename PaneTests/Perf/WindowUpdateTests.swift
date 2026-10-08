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

    /// The menu bar item's setting: on until it's turned off, and its scene is told only when it
    /// changes (redoing the menu bar item mid-layout crashed the app).
    @Test func menuBarSettingIsOnByDefaultAndChangesOnlyWithItsKey() async throws {
        let defaults = try #require(UserDefaults(suiteName: "WindowUpdateTests.\(UUID().uuidString)"))
        let shown = DefaultsFlag(MenuBarSettings.key, default: true, defaults: defaults)
        #expect(shown.value)
        final class Count: @unchecked Sendable { var value = 0 }
        let count = Count()
        withObservationTracking { _ = shown.value } onChange: { count.value += 1 }
        defaults.set("main", forKey: "lastNote")
        defaults.set(Data([1]), forKey: "lastScope")
        try await Task.sleep(for: .milliseconds(100))
        #expect(count.value == 0)
        defaults.set(false, forKey: MenuBarSettings.key)
        try await Task.sleep(for: .milliseconds(100))
        #expect(count.value == 1)
        #expect(!shown.value)
    }

    /// Every click on a folder row selects it. Folder rows that skipped their updates (an equatable
    /// view) left some clicks without effect: Recently Deleted stayed selected (dev 2610071220).
    @Test(.timeLimit(.minutes(2))) func everyFolderRowClickSelectsIt() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folders = (0..<4).map { ctx.createFolder(named: "Folder \($0)") }
        for f in folders { _ = ctx.createNote(in: .folder(f.id), body: "In \(f.name)\n\ntext") }
        try ctx.save()
        UserDefaults.standard.removeObject(forKey: "lastScope")
        // Borderless, far off every screen and never shown: nothing appears on anyone's display.
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 1180, height: 760),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: RootView().modelContainer(c))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.orderOut(nil); w.close() }
        func settle() async {
            for _ in 0..<3 {
                w.contentView?.layoutSubtreeIfNeeded()
                w.displayIfNeeded()
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        await settle()
        func find<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
            if let v = view as? T { return v }
            for s in view.subviews { if let v = find(type, in: s) { return v } }
            return nil
        }
        let split = try #require(w.contentView.flatMap { find(NSSplitView.self, in: $0) })
        let table = try #require(split.arrangedSubviews.first.flatMap { find(NSTableView.self, in: $0) })
        func remembered() -> Scope? {
            UserDefaults.standard.data(forKey: "lastScope").flatMap { try? JSONDecoder().decode(Scope.self, from: $0) }
        }
        var selected: [Scope] = []
        // Twice over every row, with Recently Deleted (the last row) in between, as Emil clicked.
        for _ in 0..<2 {
            for row in 0..<table.numberOfRows {
                table.selectRowIndexes([table.numberOfRows - 1], byExtendingSelection: false)
                await settle()
                table.selectRowIndexes([row], byExtendingSelection: false)
                await settle()
                if let s = remembered() { selected.append(s) }
            }
        }
        for f in folders {
            #expect(selected.filter { $0 == .folder(f.id) }.count == 2, "a click on \(f.name) selects it each time")
        }
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

    /// The list's notes are fetched again only when a save adds or deletes notes; edits reach the
    /// list through the notes themselves.
    @Test func listNotesFollowSavesThatAddOrDelete() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let notes = (0..<3).map { ctx.createNote(in: .all, body: "Note \($0)\n\ntext") }
        let library = LibraryNotes()
        #expect(library.notes(in: ctx).count == 3)
        final class Count: @unchecked Sendable { var value = 0 }
        let fetches = Count()
        func watch() { withObservationTracking { _ = library.notes(in: ctx) } onChange: { fetches.value += 1 } }

        watch()
        notes[0].body = "Note 0\n\nedited"
        notes[0].touch()
        try ctx.save()
        #expect(fetches.value == 0, "an edit isn't fetched for")
        let made = ctx.createNote(in: .all, body: "Arrived\n\nfrom sync")
        #expect(fetches.value == 1)
        #expect(library.notes(in: ctx).contains { $0.id == made.id })
        watch()
        ctx.delete(notes[1])
        try ctx.save()
        #expect(fetches.value == 2)
        #expect(library.notes(in: ctx).count == 3)
    }

    /// The wiki index takes a save in note by note; what it ends up with is what building it again gives.
    @Test func wikiIndexTakesSavesNoteByNote() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let work = ctx.createFolder(named: "Work")
        let plan = ctx.createNote(in: .folder(work.id), body: "Plan\n\nsee [[Budget]]")
        let budget = ctx.createNote(in: .folder(work.id), body: "Budget\n\nnumbers")
        WikiDirectory.invalidate()
        _ = WikiDirectory.index(ctx)
        let start = WikiDirectory.generation

        budget.body = "Budget\n\nmore numbers"
        budget.touch()
        try ctx.save()
        #expect(WikiDirectory.generation == start, "typing in a note changes no title")
        #expect(WikiDirectory.index(ctx).resolve("Budget") == budget.id)

        budget.body = "Budget 2027\n\nmore numbers"
        try ctx.save()
        #expect(WikiDirectory.generation > start)
        #expect(WikiDirectory.index(ctx).resolve("Budget") == nil)
        #expect(WikiDirectory.index(ctx).resolve("Budget 2027") == budget.id)

        let arrived = ctx.createNote(in: .all, body: "Budget\n\nanother")
        ctx.trash(plan)
        let taken = WikiDirectory.index(ctx).entries.sorted { $0.id.uuidString < $1.id.uuidString }
        WikiDirectory.invalidate()
        let rebuilt = WikiDirectory.index(ctx).entries.sorted { $0.id.uuidString < $1.id.uuidString }
        #expect(taken == rebuilt)
        #expect(WikiDirectory.index(ctx).resolve("Budget") == arrived.id)
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
        // Borderless, far off every screen and never shown: nothing appears on anyone's display.
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 1180, height: 760),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: RootView().modelContainer(c))
        w.setContentSize(CGSize(width: 1180, height: 760))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.orderOut(nil); w.close() }
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
