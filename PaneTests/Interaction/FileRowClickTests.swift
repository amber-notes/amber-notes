#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// A click on a file row selects it, every time (dev 2610071608: clicks on PDF rows often did
/// nothing). Real mouse-down/up events go through the window to the List's table, in a borderless
/// window at -20000,-20000. A click in a window that isn't key only activates it (first mouse), so
/// the window is made key, which orders it in: CI only (TEST_RUNNER_PANE_SNAPSHOTS), never on a
/// developer's Mac. A note row is clicked too, as the control: if it doesn't select, the clicks
/// aren't reaching the list and the test says so instead of blaming file rows.
@MainActor @Suite(.serialized) struct FileRowClickTests {
    static var onCI: Bool { ProcessInfo.processInfo.environment["PANE_SNAPSHOTS"] == "1" }

    /// The list, holding its selection where the test can read it.
    @MainActor @Observable final class Selection { var ids: Set<UUID> = [] }

    struct Host: View {
        let scope: Scope
        let selection: Selection
        var body: some View {
            NavigationStack {
                NoteListView(scope: scope, selection: Binding(get: { selection.ids }, set: { selection.ids = $0 }), onNewNote: {})
            }
        }
    }

    /// A borderless window that can be key, so clicks select instead of activating.
    final class KeyWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { true }
    }

    static func table(in view: NSView?) -> NSTableView? {
        guard let view else { return nil }
        if let t = view as? NSTableView { return t }
        for v in view.subviews { if let t = table(in: v) { return t } }
        return nil
    }

    /// A click as the mouse makes it: down, then up (queued first, so the table's tracking loop sees it).
    static func click(_ table: NSTableView, row: Int, in w: NSWindow) {
        let r = table.rect(ofRow: row)
        let p = table.convert(NSPoint(x: r.midX, y: r.midY), to: nil)
        func event(_ type: NSEvent.EventType) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: w.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)!
        }
        NSApp.postEvent(event(.leftMouseUp), atStart: false)
        w.sendEvent(event(.leftMouseDown))
    }

    @Test func clickingTwoFileRowsAlternatelySelectsEachEveryTime() async throws {
        guard Self.onCI else { return }
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folder = ctx.createFolder(named: "To Read")
        let book = try FileStore.importData(DemoData.paperPDF(title: "Think Python", lines: 20), filename: "Think_Python.pdf", type: .pdf)
        let sample = try FileStore.importData(DemoData.paperPDF(title: "Sample", lines: 5), filename: "sample.pdf", type: .pdf)
        defer { FileStore.remove(book); FileStore.remove(sample) }
        // The control: a note, older than both files (the last row).
        let note = ctx.createNote(in: .folder(folder.id), body: "Reading plan\n\nOne a week.")
        note.updatedAt = .now.addingTimeInterval(-600)
        for (f, age) in [(book, 60.0), (sample, 120.0)] {
            f.folderID = folder.id
            f.modifiedAt = .now.addingTimeInterval(-age)
            ctx.insert(f)
        }
        try ctx.save()
        let selection = Selection()
        let w = KeyWindow(contentRect: CGRect(x: -20000, y: -20000, width: 420, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: Host(scope: .folder(folder.id), selection: selection).modelContainer(c))
        w.setContentSize(CGSize(width: 420, height: 600))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.orderOut(nil); w.close() }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        try? await Task.sleep(for: .seconds(1))
        let table = try #require(Self.table(in: w.contentView), "the List is a table")
        // Today: the newer file first, then the older one (and the section's header row).
        let rows = (0 ..< table.numberOfRows).filter { table.rect(ofRow: $0).height > 30 }
        try #require(rows.count >= 3, "two file rows and a note row (rows: \(table.numberOfRows))")
        let (first, second, noteRow) = (rows[0], rows[1], rows[2])
        // The harness first: a note row selects on a click, or the clicks aren't arriving at all.
        Self.click(table, row: noteRow, in: w)
        try? await Task.sleep(for: .milliseconds(300))
        try #require(selection.ids == [note.id], "a click on a note row selects it; otherwise the test's clicks don't reach the list (key: \(w.isKeyWindow), active: \(NSApp.isActive))")
        for round in 0 ..< 10 {
            for (row, want) in [(first, book.id), (second, sample.id)] {
                Self.click(table, row: row, in: w)
                try? await Task.sleep(for: .milliseconds(250))
                #expect(selection.ids == [want], "round \(round + 1): a click on row \(row) selects \(want == book.id ? "Think_Python.pdf" : "sample.pdf")")
            }
        }
    }
}
#endif
