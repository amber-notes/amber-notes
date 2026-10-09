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

    /// The list keeps one plain entry per note, in order, and brings it up to date note by note.
    /// After every kind of change it must hold exactly what reading every note again would give:
    /// the same notes, values and order. A change it missed would leave the list showing old state.
    @Test func listEntriesFollowEveryKindOfChange() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let work = ctx.createFolder(named: "Work"), home = ctx.createFolder(named: "Home")
        var notes: [Note] = []
        for i in 0..<40 {
            let n = ctx.createNote(in: .folder(i % 2 == 0 ? work.id : home.id), body: "Note \(i)\n\ntext")
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 3600)
            notes.append(n)
        }
        try ctx.save()
        let library = LibraryNotes()
        _ = library.entries(in: ctx)

        /// What the entries must be: every note read afresh, newest first.
        func expected() throws -> [NoteEntry] {
            try ctx.fetch(FetchDescriptor<Note>()).map(NoteEntry.init).sorted { $0.date > $1.date }
        }
        func settle() async { try? await Task.sleep(for: .milliseconds(60)) }
        func check(_ what: Comment) async throws {
            await settle()
            let have = library.entries(in: ctx), want = try expected()
            #expect(have.map(\.id) == want.map(\.id), what)
            #expect(have.map(\.date) == want.map(\.date), what)
            #expect(have.map(\.pinned) == want.map(\.pinned), what)
            #expect(have.map(\.trashed) == want.map(\.trashed), what)
            #expect(have.map(\.deleted) == want.map(\.deleted), what)
            #expect(have.map(\.folderID) == want.map(\.folderID), what)
            #expect(have.map(\.parentID) == want.map(\.parentID), what)
        }
        try await check("as loaded")

        // Typing: the text and the date change, nothing is saved yet. The note moves to the top.
        notes[17].body = "Note 17\n\nedited"
        notes[17].touch()
        try await check("an unsaved edit")
        #expect(library.entries(in: ctx).first?.id == notes[17].id)
        try ctx.save()
        try await check("the edit saved")

        ctx.togglePin(notes[5])
        try await check("a pin")
        ctx.trash(notes[9])
        try await check("a note in Recently Deleted")
        ctx.restore(notes[9])
        try await check("recovered")
        ctx.move(notes[3], to: home)
        try await check("moved to another folder")
        notes[8].parentID = notes[2].id
        try await check("made a sub-note")
        ctx.purge(notes[11])
        try await check("deleted for good (a tombstone)")

        // Several at once, and twice in a row before the list catches up.
        for i in [20, 21, 22] { notes[i].touch() }
        notes[20].touch()
        try await check("several edits in one turn")

        let arrived = ctx.createNote(in: .folder(work.id), body: "Arrived\n\nfrom sync")
        try await check("a note arrives")
        #expect(library.entries(in: ctx).contains { $0.id == arrived.id })
        arrived.touch()
        try await check("the arrived note is edited (it's watched too)")

        ctx.delete(notes[30])
        try ctx.save()
        try await check("a note removed from the store")
        #expect(library.entries(in: ctx).count == 40)

        // And it tells its views: once per update, not once per note read.
        final class Count: @unchecked Sendable { var value = 0 }
        let updates = Count()
        withObservationTracking { _ = library.entries(in: ctx) } onChange: { updates.value += 1 }
        notes[1].serverVersion += 1
        notes[1].dirty = false
        await settle()
        #expect(updates.value == 0, "the sync mark isn't something the list shows")
        notes[1].touch()
        await settle()
        #expect(updates.value == 1)
    }

    /// A save of the note being typed in changes nothing the list is made of (it stays first,
    /// in its folder, on the same day), so the list isn't worked out again: its entry is new, and
    /// nobody is told. A note that moves, or any change while a search is on, is told.
    @Test func aSaveInPlaceDoesNotWorkTheListOutAgain() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let work = ctx.createFolder(named: "Work"), home = ctx.createFolder(named: "Home")
        var notes: [Note] = []
        for i in 0..<50 {
            let n = ctx.createNote(in: .folder(work.id), body: "Note \(i)\n\ntext")
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 10)
            notes.append(n)
        }
        try ctx.save()
        let library = LibraryNotes()
        final class Count: @unchecked Sendable { var value = 0 }
        /// Whether the list was told of a change (each watch tells once, the first time).
        func change(_ what: () -> Void) async -> Bool {
            let mine = Count()
            withObservationTracking { _ = library.entries(in: ctx) } onChange: { mine.value += 1 }
            what()
            try? await Task.sleep(for: .milliseconds(120))
            return mine.value > 0
        }
        _ = library.entries(in: ctx)

        let typed = await change {
            notes[0].body = "Note 0\n\nmore text"
            notes[0].touch()
        }
        #expect(!typed, "typing in the first note leaves the list as it is")
        #expect(library.entries(in: ctx).first?.date == notes[0].updatedAt, "its entry has the new date all the same")

        let moved = await change {
            notes[7].body = "Note 7\n\nmore text"
            notes[7].touch()
        }
        #expect(moved, "a note that moves to the top is a change to the list")
        #expect(library.entries(in: ctx).first?.id == notes[7].id)

        let refiled = await change { notes[7].folder = home }
        #expect(refiled, "so is the first note changing folder")
        let pinned = await change { notes[7].isPinned = true }
        #expect(pinned, "or being pinned")

        library.publishesEveryChange = true
        let searching = await change {
            notes[7].body = "Note 7\n\nother text"
            notes[7].touch()
        }
        #expect(searching, "while a search is on, any change may change what is found")
    }

    /// Many notes at once: a sync pull that changes thousands, an import that adds thousands, and
    /// an account switch that empties the library and fills it with another. After each the
    /// entries are what a fresh read of every note gives, and nothing of the old account is left.
    @Test(.timeLimit(.minutes(5))) func listEntriesFollowBulkChanges() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folder = ctx.createFolder(named: "Notes")
        var notes: [Note] = []
        for i in 0..<5000 {
            let n = Note(body: "Note \(i)\n\ntext", folder: folder)
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 60)
            ctx.insert(n)
            notes.append(n)
        }
        try ctx.save()
        let library = LibraryNotes()
        _ = library.entries(in: ctx)
        func check(_ what: Comment) async throws {
            try? await Task.sleep(for: .milliseconds(150))
            let have = library.entries(in: ctx)
            let want = try ctx.fetch(FetchDescriptor<Note>()).map(NoteEntry.init).sorted { $0.date > $1.date }
            #expect(have.count == want.count, what)
            #expect(Set(have.map(\.id)) == Set(want.map(\.id)), what)
            // Equal dates may sit in either order; everything else must match position by position.
            #expect(have.map(\.date) == want.map(\.date), what)
            let byID = Dictionary(uniqueKeysWithValues: want.map { ($0.id, $0) })
            #expect(have.allSatisfy { e in byID[e.id].map { $0.trashed == e.trashed && $0.pinned == e.pinned && $0.folderID == e.folderID && $0.deleted == e.deleted } ?? false }, what)
        }
        try await check("as loaded")

        // A sync pull: 3,000 notes get new text and dates in one go, then one save.
        let clock = ContinuousClock()
        let pull = clock.measure {
            for i in 0..<3000 {
                notes[i].body = "Note \(i)\n\nfrom the other device"
                notes[i].updatedAt = Date(timeIntervalSinceNow: -Double(i))
            }
            for i in 0..<200 { notes[4999 - i].trashedAt = .now }
        }
        try ctx.save()
        try await check("a sync pull that changed thousands")
        print("PERF 5,000 notes: 3,200 changed at once, applied in \(pull)")

        // An import: 2,000 notes added, one save.
        for i in 0..<2000 {
            let n = Note(body: "Imported \(i)\n\ntext", folder: folder)
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 7)
            ctx.insert(n)
        }
        try ctx.save()
        try await check("an import that added thousands")
        #expect(library.entries(in: ctx).count == 7000)

        // Another account signs in: this device's library is emptied (AccountLibrary) and the new
        // account's notes arrive.
        let old = Set(library.entries(in: ctx).map(\.id))
        for n in try ctx.fetch(FetchDescriptor<Note>()) { ctx.delete(n) }
        try ctx.save()
        try await check("the library emptied")
        #expect(library.entries(in: ctx).isEmpty)
        let theirs = ctx.createFolder(named: "Theirs")
        for i in 0..<50 { ctx.insert(Note(body: "Theirs \(i)\n\ntext", folder: theirs)) }
        try ctx.save()
        try await check("the other account's notes")
        #expect(library.entries(in: ctx).count == 50)
        #expect(old.isDisjoint(with: library.entries(in: ctx).map(\.id)), "nothing of the old account is left")
    }

    /// The wiki index built a slice at a time (as when a note opens at launch): it isn't there
    /// at once, a save that lands while it is built is in it at the end, and it equals an index
    /// built in one go.
    @Test func wikiIndexWarmsInSlicesAndKeepsSavesMadeMeanwhile() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let work = ctx.createFolder(named: "Work")
        var notes: [Note] = []
        for i in 0..<3000 {
            let n = Note(body: "Title \(i)\n\nSome **text** for note \(i).", folder: work)
            ctx.insert(n)
            notes.append(n)
        }
        try ctx.save()
        WikiDirectory.invalidate()
        let warming = Task { @MainActor in await WikiDirectory.warm(ctx) }
        try await Task.sleep(for: .milliseconds(3))
        #expect(!WikiDirectory.isBuilt, "3,000 titles aren't read in the first few milliseconds")
        // A rename and a new note, saved while the index is being built.
        notes[10].body = "Renamed meanwhile\n\ntext"
        notes[10].touch()
        let added = ctx.createNote(in: .folder(work.id), body: "Arrived meanwhile\n\ntext")
        try ctx.save()
        await warming.value
        // (A save that added a note has the index built again when it is next asked for.)
        let warmed = WikiDirectory.index(ctx)
        #expect(warmed.resolve("Renamed meanwhile") == notes[10].id)
        #expect(warmed.resolve("Title 10") == nil)
        #expect(warmed.resolve("Arrived meanwhile") == added.id)
        #expect(warmed.resolve("Title 2999") == notes[2999].id)
        let taken = warmed.entries.sorted { $0.id.uuidString < $1.id.uuidString }
        WikiDirectory.invalidate()
        let rebuilt = WikiDirectory.index(ctx).entries.sorted { $0.id.uuidString < $1.id.uuidString }
        #expect(taken == rebuilt)
    }

    /// Opening a note at launch in a library of 2,000 notes: the wiki index (the head of every
    /// note's text) isn't built before the window's first frame (0.2 s of the launch), and is
    /// there a moment later.
    @Test(.timeLimit(.minutes(3))) func openingANoteAtLaunchReadsNoTitlesBeforeItsFirstFrame() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        var folders = (0..<8).map { ctx.createFolder(named: "Folder \($0)") }
        for i in 8..<150 {
            let f = ctx.createFolder(named: "Folder \(i)")
            ctx.move(f, into: i < 80 ? folders[(i - 8) / 9] : folders[8 + (i - 80) % 72])
            folders.append(f)
        }
        var open: Note?
        for i in 0..<2000 {
            let n = Note(body: "Note \(i)\n\nSome text for note \(i), see [[Note \(i + 1)]] and [[Nowhere]].\n", folder: folders[i % folders.count])
            n.updatedAt = Date(timeIntervalSinceNow: -Double(i) * 3600)
            ctx.insert(n)
            if i == 1 { open = n }
        }
        try ctx.save()
        let note = try #require(open)
        WikiDirectory.invalidate()
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 1180, height: 760),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: RootView().modelContainer(c))
        w.setContentSize(CGSize(width: 1180, height: 760))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.orderOut(nil); w.close() }
        NoteOpener.shared.request = note.id
        // The first frames, with no turn of the main queue in between that isn't the window's own.
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        await Task.yield()
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        #expect(!WikiDirectory.isBuilt, "the library's titles aren't read before the note's first frame")

        for _ in 0..<100 where !WikiDirectory.isBuilt {
            w.contentView?.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            try? await Task.sleep(for: .milliseconds(50))
        }
        #expect(WikiDirectory.isBuilt, "the index is built a moment after the note shows")
        #expect(WikiDirectory.index(ctx).resolve("Note 2") != nil)
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
    /// A write should cost the same in a library ten times the size.
    @Test(.timeLimit(.minutes(8)), arguments: [2_000, 20_000]) func savingTheOpenNoteInABigLibrary(count: Int) async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folders = (0..<6).map { ctx.createFolder(named: "Folder \($0)") }
        var open: Note?
        for i in 0..<count {
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
        print("PERF \(count) notes: save of the open note → window updated, median \(String(format: "%.1f", median)) ms")
        #expect(median < (Self.typingBudgets[count] ?? 120) * PerfBudget.slack, "a save while typing with \(count) notes")
    }

    /// Milliseconds on a developer's Mac (CI multiplies by its slack).
    static let typingBudgets: [Int: Double] = [2_000: 120, 20_000: 240]
}
#endif
