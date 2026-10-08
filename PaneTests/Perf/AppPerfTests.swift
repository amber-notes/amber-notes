#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The list with many notes, and switching notes in the detail pane.
@MainActor @Suite(.serialized) struct AppPerfTests {
    func ms(_ d: Duration) -> Double { Double(d.components.attoseconds) / 1e15 + Double(d.components.seconds) * 1000 }

    func library(notes count: Int, big: Bool = true) throws -> (ModelContainer, [Note]) {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folder = Folder(name: "Notes")
        ctx.insert(folder)
        var notes: [Note] = []
        for i in 0..<count {
            let n = Note(body: "Note \(i)\n\nSome text for note \(i), with **bold** and a list:\n- one\n- two\n", folder: folder)
            n.updatedAt = Date().addingTimeInterval(Double(-i * 3600))
            ctx.insert(n)
            notes.append(n)
        }
        if big {
            let n = Note(body: PerfFixtures.longNote(), folder: folder)
            ctx.insert(n)
            notes.append(n)
        }
        try ctx.save()
        return (c, notes)
    }

    func window(_ view: some View, width: CGFloat = 340) -> (NSWindow, NSHostingView<AnyView>) {
        let w = KeyableWindow(contentRect: NSRect(x: -30000, y: -30000, width: width, height: 900), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        let host = NSHostingView(rootView: AnyView(view))
        w.contentView = host
        return (w, host)
    }

    @Test func listWithAThousandNotes() async throws {
        let (c, notes) = try library(notes: 1000)
        let clock = ContinuousClock()
        let (w, host) = window(NoteListView(scope: .all, selection: .constant([]), onNewNote: {}).modelContainer(c))
        defer { w.close() }
        let first = ms(clock.measure { host.layoutSubtreeIfNeeded(); w.displayIfNeeded() })
        print("PERF list 1000 notes: first display \(String(format: "%.1f", first)) ms")
        // What a keystroke in the open note costs the list.
        var times: [Double] = []
        for _ in 0..<15 {
            let start = clock.now
            notes[0].body += "a"
            notes[0].touch()
            await Task.yield()
            host.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            times.append(ms(clock.now - start))
        }
        times.sort()
        print("PERF list 1000 notes: body change → list updated, median \(String(format: "%.2f", times[times.count / 2])) ms")
    }

    @Test func switchingNotes() async throws {
        let (c, notes) = try library(notes: 50)
        let controller = EditorController()
        func detail(_ n: Note) -> some View {
            NavigationStack { NoteDetailView(note: n, controller: controller, onNewNote: {}) }
                .modelContainer(c)
                .frame(width: 760, height: 900)
        }
        let (w, host) = window(detail(notes[1]), width: 760)
        defer { w.close() }
        host.layoutSubtreeIfNeeded(); w.displayIfNeeded()
        let clock = ContinuousClock()
        var normal: [Double] = []
        for i in 2..<22 {
            let start = clock.now
            host.rootView = AnyView(detail(notes[i]))
            host.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            normal.append(ms(clock.now - start))
        }
        normal.sort()
        let start = clock.now
        host.rootView = AnyView(detail(notes.last!))
        host.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        let big = ms(clock.now - start)
        print("PERF switch to a normal note: median \(String(format: "%.1f", normal[normal.count / 2])) ms; to the 5000-line note: \(String(format: "%.1f", big)) ms")
    }

    /// Settings: a click on a tab shows its page at once, the first visit included. Storage's
    /// numbers come from the server off the main thread; drawing the page only formats them.
    @Test func switchingSettingsTabs() async throws {
        let view = try await AppSnapshotTests.settingsFixture()
        let (w, host) = window(view.frame(width: 520, height: 700), width: 520)
        defer { w.close(); ProfileStore.shared.showForPreview(name: nil, photo: nil) }
        host.layoutSubtreeIfNeeded(); w.displayIfNeeded()
        let clock = ContinuousClock()
        func show(_ tab: SettingsTab) -> Double {
            let start = clock.now
            view.route.tab = tab
            host.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            return ms(clock.now - start)
        }
        var first: [SettingsTab: Double] = [:]
        for tab in SettingsTab.allCases { first[tab] = show(tab) }
        var again: [Double] = []
        for _ in 0..<4 { for tab in SettingsTab.allCases { again.append(show(tab)) } }
        again.sort()
        let slowestFirst = first.values.max() ?? 0
        print("PERF settings tabs: first visit " + SettingsTab.allCases.map { "\($0.rawValue) \(String(format: "%.1f", first[$0] ?? 0))" }.joined(separator: ", ")
              + " ms; switching back, median \(String(format: "%.1f", again[again.count / 2])) ms, slowest \(String(format: "%.1f", again.last ?? 0)) ms")
        // A frame is 16 ms; a first visit builds the page, so it gets a little more.
        #expect(again[again.count / 2] < 16 * PerfBudget.slack, "switching to a page already shown")
        #expect(slowestFirst < 50 * PerfBudget.slack, "the first visit to a page")
    }
}
#endif

#if os(macOS)
extension AppPerfTests {
    /// For profiling by hand: keeps the list updating so a sampler can see why.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["AMBER_PROFILE"] != nil)) func listUpdateLoop() async throws {
        let (c, notes) = try library(notes: 1000)
        let (w, host) = window(NoteListView(scope: .all, selection: .constant([]), onNewNote: {}).modelContainer(c))
        defer { w.close() }
        host.layoutSubtreeIfNeeded(); w.displayIfNeeded()
        for _ in 0..<300 {
            notes[0].body += "a"
            notes[0].touch()
            await Task.yield()
            host.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
        }
    }
}
#endif

#if os(macOS)
extension AppPerfTests {
    /// With files in folders the list shows notes and files together. The files are merged into the
    /// notes' own order instead of every note being wrapped and sorted again: the sections and
    /// their order must be exactly what sorting everything gives.
    @Test func notesAndFilesKeepTheSameSectionsAndOrder() throws {
        let (c, notes) = try library(notes: 2_000, big: false)
        let ctx = c.mainContext
        let folder = try #require(notes.first?.folder)
        notes[40].isPinned = true
        notes[900].isPinned = true
        var files: [Pane.Attachment] = []
        for i in 0..<10 {
            let a = Pane.Attachment(filename: "File \(i).pdf", contentType: "com.adobe.pdf", size: 1000)
            a.folderID = folder.id
            a.modifiedAt = Date().addingTimeInterval(Double(-i * 3600 * 190 - 1800))
            ctx.insert(a)
            files.append(a)
        }
        try ctx.save()
        let newestFirst = notes.map { ($0, $0.updatedAt) }.sorted { $0.1 > $1.1 }.map(\.0)
        let before = DateBucket.sections(newestFirst.map(ListItem.note) + files.map(ListItem.file))
        let after = DateBucket.sections(newestFirst: ListEntry.merged(notes: newestFirst.map(NoteEntry.init), files: files))
        #expect(after.map { $0.0 } == before.map { $0.0 }, "the same sections")
        #expect(after.map { $0.1.map { $0.id } } == before.map { $0.1.map { $0.id } }, "in the same order")
        #expect(after.first?.0 == "Pinned" && after.first?.1.count == 2)
    }
}
#endif

#if os(macOS)
extension AppPerfTests {
    /// The list at 2,000 and 20,000 notes: how long it takes to show first, and how long a save of
    /// one note takes to show. A save should cost what changed, not the size of the library.
    @Test(.timeLimit(.minutes(8)), arguments: [2_000, 20_000]) func listShowsASaveAtScale(count: Int) async throws {
        let (c, notes) = try library(notes: count, big: false)
        // Ten files in the folder too, as real libraries have: the list then shows notes and files together.
        if let folder = notes.first?.folder {
            for i in 0..<10 {
                let a = Pane.Attachment(filename: "File \(i).pdf", contentType: "com.adobe.pdf", size: 1000)
                a.folderID = folder.id
                a.modifiedAt = Date().addingTimeInterval(Double(-i * 3600 * 190 - 1800))
                c.mainContext.insert(a)
            }
            try c.mainContext.save()
        }
        let clock = ContinuousClock()
        let (w, host) = window(NoteListView(scope: .all, selection: .constant([]), onNewNote: {}).modelContainer(c))
        defer { w.close() }
        let first = ms(clock.measure { host.layoutSubtreeIfNeeded(); w.displayIfNeeded() })
        try? await Task.sleep(for: .milliseconds(300))
        var saves: [Double] = []
        for i in 0..<9 {
            let start = clock.now
            notes[i * 7 + 3].body += " a"
            notes[i * 7 + 3].touch()
            // The list hears of the change once the main queue turns, as in the app.
            try? await Task.sleep(for: .milliseconds(2))
            host.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            saves.append(ms(clock.now - start))
            try? await Task.sleep(for: .milliseconds(50))
        }
        saves.sort()
        let save = saves[saves.count / 2]
        print("PERF list of \(count) notes: first display \(String(format: "%.0f", first)) ms, a save shown \(String(format: "%.1f", save)) ms (median)")
        let budget = Self.listBudgets[count] ?? (first: 4000, save: 1000)
        #expect(first < budget.first * PerfBudget.slack, "first display of \(count) notes")
        #expect(save < budget.save * PerfBudget.slack, "a save shown with \(count) notes")
    }

    /// Milliseconds on a developer's Mac (CI multiplies by its slack).
    static let listBudgets: [Int: (first: Double, save: Double)] = [2_000: (first: 400, save: 100), 20_000: (first: 2000, save: 400)]
}
#endif
