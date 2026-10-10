#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// A click on a note row selects that note, also right after the list has reordered itself: the
/// list keeps its notes as ordered entries (LibraryNotes) and moves one when its note changes.
/// Real mouse-down/up events through the window, as in FileRowClickTests; CI only.
@MainActor @Suite(.serialized) struct NoteRowClickTests {
    @Test func clicksSelectTheRightNoteBeforeAndAfterTheListReorders() async throws {
        guard FileRowClickTests.onCI else { return }
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folder = ctx.createFolder(named: "Notes")
        var notes: [Note] = []
        for i in 0..<6 {
            let n = ctx.createNote(in: .folder(folder.id), body: "Note \(i)\n\nSome text.")
            n.updatedAt = .now.addingTimeInterval(-Double(i + 1) * 60)
            notes.append(n)
        }
        try ctx.save()
        let selection = FileRowClickTests.Selection()
        let w = FileRowClickTests.KeyWindow(contentRect: CGRect(x: -20000, y: -20000, width: 420, height: 700), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: FileRowClickTests.Host(scope: .folder(folder.id), selection: selection).modelContainer(c))
        w.setContentSize(CGSize(width: 420, height: 700))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.orderOut(nil); w.close() }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        try? await Task.sleep(for: .seconds(1))
        let table = try #require(FileRowClickTests.table(in: w.contentView), "the List is a table")
        func noteRows() -> [Int] { (0 ..< table.numberOfRows).filter { table.rect(ofRow: $0).height > 30 } }
        try #require(noteRows().count == 6, "six note rows (rows: \(table.numberOfRows))")

        // As loaded: newest first, so row i is note i.
        for i in [0, 3, 5, 1] {
            FileRowClickTests.click(table, row: noteRows()[i], in: w)
            try? await Task.sleep(for: .milliseconds(250))
            #expect(selection.ids == [notes[i].id], "a click on row \(i) selects Note \(i)")
        }

        // Note 4 is edited (not saved yet): it moves to the top, and the rows below shift down.
        notes[4].body = "Note 4\n\nEdited."
        notes[4].touch()
        try? await Task.sleep(for: .milliseconds(500))
        let order = [4, 0, 1, 2, 3, 5]
        for round in 0..<3 {
            for (row, i) in order.enumerated() {
                FileRowClickTests.click(table, row: noteRows()[row], in: w)
                try? await Task.sleep(for: .milliseconds(250))
                #expect(selection.ids == [notes[i].id], "round \(round + 1), after the reorder: a click on row \(row) selects Note \(i)")
            }
        }

        // A note is moved to Recently Deleted: its row goes, the others still select.
        ctx.trash(notes[0])
        try? await Task.sleep(for: .milliseconds(500))
        try #require(noteRows().count == 5, "five rows once Note 0 is deleted")
        for (row, i) in [4, 1, 2, 3, 5].enumerated() {
            FileRowClickTests.click(table, row: noteRows()[row], in: w)
            try? await Task.sleep(for: .milliseconds(250))
            #expect(selection.ids == [notes[i].id], "after a delete: a click on row \(row) selects Note \(i)")
        }
    }
}
#endif
