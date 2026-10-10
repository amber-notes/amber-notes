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
    ///
    /// A first visit can only be timed once per window, so it is timed in three windows built
    /// new, and each page is judged by the median of its three first visits (see PerfTiming): one
    /// stalled sample on a loaded runner failed this test with every other number as usual.
    @Test func switchingSettingsTabs() async throws {
        let clock = ContinuousClock()
        var firsts: [SettingsTab: [Double]] = [:]
        var again: [Double] = []
        for _ in 0..<3 {
            let view = try await AppSnapshotTests.settingsFixture()
            let (w, host) = window(view.frame(width: 520, height: 700), width: 520)
            defer { w.close() }
            host.layoutSubtreeIfNeeded(); w.displayIfNeeded()
            await PerfTiming.quietMainQueue()
            func show(_ tab: SettingsTab) -> Double {
                let start = clock.now
                view.route.tab = tab
                host.layoutSubtreeIfNeeded()
                w.displayIfNeeded()
                return ms(clock.now - start)
            }
            for tab in SettingsTab.allCases { firsts[tab, default: []].append(show(tab)) }
            for _ in 0..<4 { for tab in SettingsTab.allCases { again.append(show(tab)) } }
        }
        ProfileStore.shared.showForPreview(name: nil, photo: nil)
        again.sort()
        let first = firsts.mapValues { PerfTiming.median($0) }
        let slowestFirst = first.values.max() ?? 0
        print("PERF settings tabs: first visit " + SettingsTab.allCases.map { "\($0.rawValue) \(String(format: "%.1f", first[$0] ?? 0))" }.joined(separator: ", ")
              + " ms (medians of 3 windows; slowest single first visit \(String(format: "%.1f", firsts.values.joined().max() ?? 0)) ms); switching back, median \(String(format: "%.1f", again[again.count / 2])) ms, slowest \(String(format: "%.1f", again.last ?? 0)) ms")
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

    /// The scope of a list in a test, changed the way the sidebar changes it.
    @MainActor @Observable final class ScopeBox { var scope: Scope = .all }
    struct ScopedList: View {
        let box: ScopeBox
        var body: some View { NoteListView(scope: box.scope, selection: .constant([]), onNewNote: {}) }
    }

    /// From a folder of 25 notes back to All Notes with 2,000: the list is built new, as it is at
    /// launch. As one list whose rows changed, SwiftUI sized every row that came back, 3 to 4 s on
    /// the main thread. The switch back may cost a few first displays, not twenty of them.
    ///
    /// How it is measured: five switches each way, judged by their median. Each sample has to wait
    /// for the main queue to turn (that is when the list hears of the change), and whatever else
    /// is queued there runs in that wait and is timed with it. On a loaded runner one sample in
    /// a run was a second or more while the others were 110 to 320 ms, and judged by the worst
    /// of three the test failed at least four first attempts in two days (2026-10-09 and -10: worst samples 1,027,
    /// 1,057, 1,189 and 1,801 ms beside medians of 235, 251, 273 and 320 ms). A list that is slow
    /// to rebuild is slow every time, so the median still catches it; the limit is unchanged
    /// (see PerfTiming). The limit is five first displays; a switch back is usually about 1.4 of
    /// them, so the 3 to 4 s case (twenty) fails and a 2x slowdown (about 2.8) shows in the
    /// PERF line without failing, as before. Every sample is printed, with how long it waited,
    /// laid out and drew.
    @Test(.timeLimit(.minutes(5))) func switchingBackToAllNotesBuildsTheListNew() async throws {
        let (c, notes) = try library(notes: 2_000, big: false)
        let ctx = c.mainContext
        let small = ctx.createFolder(named: "Small")
        for n in notes.prefix(25) { n.folder = small }
        try ctx.save()
        let box = ScopeBox()
        let clock = ContinuousClock()
        // What the test before left on the main queue (a library of 20,000 notes going away) is
        // done before anything is timed.
        await PerfTiming.quietMainQueue()
        let (w, host) = window(ScopedList(box: box).modelContainer(c))
        defer { w.close() }
        struct Sample { var total = 0.0, wait = 0.0, layout = 0.0, draw = 0.0 }
        func show() async -> Sample {
            let start = clock.now
            // The list hears of the change once the main queue turns, as in the app.
            try? await Task.sleep(for: .milliseconds(2))
            let turned = clock.now
            host.layoutSubtreeIfNeeded()
            let laidOut = clock.now
            w.displayIfNeeded()
            let end = clock.now
            return Sample(total: ms(end - start), wait: ms(turned - start), layout: ms(laidOut - turned), draw: ms(end - laidOut))
        }
        let first = await show().total
        try? await Task.sleep(for: .milliseconds(300))
        func table() -> NSTableView? { FileRowClickTests.table(in: host) }
        let allNotes = try #require(table(), "the list is a table")
        #expect(allNotes.numberOfRows > 1_000)

        var toFolder: [Sample] = [], back: [Sample] = []
        for _ in 0..<5 {
            box.scope = .folder(small.id)
            toFolder.append(await show())
            try? await Task.sleep(for: .milliseconds(200))
            let inFolder = try #require(table())
            #expect(inFolder !== allNotes, "a folder is another list, not the same one with other rows")
            #expect(inFolder.numberOfRows < 100)
            box.scope = .all
            back.append(await show())
            try? await Task.sleep(for: .milliseconds(200))
            #expect((table()?.numberOfRows ?? 0) > 1_000)
        }
        func median(_ samples: [Sample]) -> Double { PerfTiming.median(samples.map(\.total)) }
        func list(_ samples: [Sample]) -> String {
            samples.map { String(format: "%.0f (wait %.0f, layout %.0f, draw %.0f)", $0.total, $0.wait, $0.layout, $0.draw) }.joined(separator: ", ")
        }
        print("PERF list of 2000 notes: first display \(String(format: "%.0f", first)) ms, to a folder of 25 \(String(format: "%.0f", median(toFolder))) ms, back to All Notes \(String(format: "%.0f", median(back))) ms (medians of 5)")
        print("PERF list of 2000 notes, each switch in order, ms: to the folder \(list(toFolder)); back \(list(back))")
        #expect(median(back) < max(first, 100) * 5, "back to All Notes costs about what showing the list first did")
        #expect(median(toFolder) < max(first, 100) * 5)
    }

    /// Milliseconds before the slack (CI multiplies by its slack of 4). Derived from CI's Debug runs
    /// on 2026-10-08 (171 to 258 and 82 to 88 ms at 2,000; 901 to 997 and 608 to 773 ms at 20,000),
    /// so that CI's limit leaves three to six times their room: they catch a list that reads the
    /// whole library again, not a slow runner. Not measured on a developer's Mac yet. Never loosened
    /// to pass a run (docs/Technical/release-gate.md, Budgets).
    static let listBudgets: [Int: (first: Double, save: Double)] = [2_000: (first: 250, save: 100), 20_000: (first: 1000, save: 600)]
}
#endif
