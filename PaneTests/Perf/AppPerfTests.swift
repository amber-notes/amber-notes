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
    /// With files in folders the list showed notes and files together by wrapping every note as a
    /// list item and sorting them all again on each update. Now the notes keep the order they're
    /// already in and only the files are merged in: same sections, a fraction of the work.
    @Test(.timeLimit(.minutes(3))) func notesAndFilesWithTwentyThousandNotes() async throws {
        let (c, notes) = try library(notes: 20_000, big: false)
        let ctx = c.mainContext
        let folder = try #require(notes.first?.folder)
        var files: [Pane.Attachment] = []
        for i in 0..<10 {
            let a = Pane.Attachment(filename: "File \(i).pdf", contentType: "com.adobe.pdf", size: 1000)
            a.folderID = folder.id
            a.modifiedAt = Date().addingTimeInterval(Double(-i * 3600 * 1900 - 1800))
            ctx.insert(a)
            files.append(a)
        }
        try ctx.save()
        let newestFirst = notes.map { ($0, $0.updatedAt) }.sorted { $0.1 > $1.1 }.map(\.0)

        let before = DateBucket.sections(newestFirst.map(ListItem.note) + files.map(ListItem.file))
        let after = DateBucket.sections(newestFirst: DateBucket.merged(notes: newestFirst, files: files))
        #expect(after.map { $0.0 } == before.map { $0.0 }, "the same sections")
        #expect(after.map { $0.1.map { $0.id } } == before.map { $0.1.map { $0.id } }, "in the same order")

        let clock = ContinuousClock()
        func median(_ f: () -> Void) -> Double {
            var t: [Double] = []
            for _ in 0..<5 { t.append(ms(clock.measure(f))) }
            return t.sorted()[2]
        }
        let wrapped = median { _ = DateBucket.sections(newestFirst.map(ListItem.note) + files.map(ListItem.file)) }
        let merged = median { _ = DateBucket.sections(newestFirst: DateBucket.merged(notes: newestFirst, files: files)) }
        print("PERF 20,000 notes + 10 files, list order: wrapped and sorted \(String(format: "%.1f", wrapped)) ms, merged \(String(format: "%.1f", merged)) ms")
        #expect(merged < wrapped, "merging the files in costs less than sorting everything again")

        // The list itself, as it updates when a note is saved.
        let (w, host) = window(NoteListView(scope: .all, selection: .constant([]), onNewNote: {}).modelContainer(c))
        defer { w.close() }
        let first = ms(clock.measure { host.layoutSubtreeIfNeeded(); w.displayIfNeeded() })
        var updates: [Double] = []
        for i in 0..<5 {
            let start = clock.now
            notes[i].body += " a"
            notes[i].touch()
            await Task.yield()
            host.layoutSubtreeIfNeeded()
            w.displayIfNeeded()
            updates.append(ms(clock.now - start))
        }
        updates.sort()
        print("PERF list of 20,000 notes + 10 files: first display \(String(format: "%.0f", first)) ms, a save shown \(String(format: "%.1f", updates[2])) ms (median)")
    }
}
#endif
