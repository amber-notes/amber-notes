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
