#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Selecting several notes and acting on them, like Notes: ⌘A, ⌘-click, Delete,
/// the "N Notes Selected" pane, and dragging a selection onto a folder.
@MainActor @Suite(.serialized) struct MultiSelectTests {
    /// The real note list in an offscreen window, with its selection readable.
    @MainActor final class ListHost {
        let container: ModelContainer
        let window: NSWindow
        let box = SelectionBox()

        @MainActor @Observable final class SelectionBox { var ids: Set<UUID> = [] }

        struct Wrapper: View {
            @Bindable var box: SelectionBox
            var body: some View {
                NavigationStack {
                    NoteListView(scope: .all, selection: $box.ids, onNewNote: {})
                }
            }
        }

        init() async throws {
            container = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
            Seed.ensureLibrary(container.mainContext, demo: true)
            try container.mainContext.save()
            window = KeyableWindow(contentRect: CGRect(x: -30000, y: -30000, width: 420, height: 900), styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentViewController = NSHostingController(rootView: Wrapper(box: box).modelContainer(container))
            window.makeKey()
            try? await Task.sleep(for: .seconds(0.6))
        }

        var context: ModelContext { container.mainContext }
        var live: [Note] { ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.deletedAt == nil && $0.trashedAt == nil && !context.isNested($0) } }

        /// The AppKit table behind the SwiftUI List.
        var table: NSTableView? {
            func find(_ v: NSView) -> NSTableView? {
                if let t = v as? NSTableView { return t }
                for s in v.subviews { if let t = find(s) { return t } }
                return nil
            }
            return window.contentView.flatMap(find)
        }

        func settle(_ s: Double = 0.25) async { try? await Task.sleep(for: .seconds(s)) }
        func close() { window.orderOut(nil); window.close() }
    }

    @Test func selectAllTakesEveryNote() async throws {
        let h = try await ListHost()
        defer { h.close() }
        let table = try #require(h.table)
        h.window.makeFirstResponder(table)
        table.selectAll(nil)
        await h.settle()
        #expect(h.box.ids == Set(h.live.map(\.id)))
    }

    /// Rows holding notes: section headers are the taller group rows.
    static func noteRows(_ table: NSTableView) -> [Int] {
        let heights = (0..<table.numberOfRows).map { table.rect(ofRow: $0).height }
        let header = heights.max() ?? 0
        return (0..<table.numberOfRows).filter { heights[$0] < header }
    }

    @Test func extendingTheSelectionKeepsEarlierRows() async throws {
        let h = try await ListHost()
        defer { h.close() }
        let table = try #require(h.table)
        let rows = Self.noteRows(table)
        try #require(rows.count >= 3)
        // ⌘-click adds a row; ⇧-click extends a range. Both arrive at the table as extending selections.
        table.selectRowIndexes([rows[0]], byExtendingSelection: false)
        table.selectRowIndexes([rows[2]], byExtendingSelection: true)
        await h.settle()
        #expect(h.box.ids.count == 2)
        table.selectRowIndexes(IndexSet(rows[0]...rows[2]), byExtendingSelection: true)
        await h.settle()
        #expect(h.box.ids.count == 3)
    }

    @Test func deleteKeyMovesTheSelectionToRecentlyDeleted() async throws {
        let h = try await ListHost()
        defer { h.close() }
        let table = try #require(h.table)
        let rows = Self.noteRows(table)
        try #require(rows.count >= 3)
        h.window.makeFirstResponder(table)
        table.selectRowIndexes(IndexSet(rows.prefix(3)), byExtendingSelection: false)
        await h.settle()
        let picked = h.box.ids.compactMap { h.context.note($0) }
        try #require(picked.count == 3)
        let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: h.window.windowNumber,
                                 context: nil, characters: "\u{7F}", charactersIgnoringModifiers: "\u{7F}", isARepeat: false, keyCode: 51)!
        h.window.sendEvent(e)
        await h.settle()
        #expect(picked.allSatisfy { $0.trashedAt != nil })
        // The neighbour becomes the selection, as in Notes.
        #expect(h.box.ids.count <= 1)
        // Recently Deleted is the undo: every one of them can come back.
        picked.forEach(h.context.restore)
        #expect(picked.allSatisfy { $0.trashedAt == nil })
    }

    @Test func removingSeveralTakesSubNotesAlongAndPurgesTrashedOnes() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        Seed.ensureLibrary(ctx, demo: false)
        let a = ctx.createNote(in: .all, body: "A")
        let child = ctx.createSubNote(of: a)
        a.body += "\n[Child](pane-note:\(child.id.uuidString.lowercased()))"
        let b = ctx.createNote(in: .all, body: "B")
        let gone = ctx.createNote(in: .all, body: "Gone")
        ctx.trash(gone)
        ctx.remove([a, b, gone])
        #expect(a.trashedAt != nil && b.trashedAt != nil && child.trashedAt != nil)
        #expect(gone.deletedAt != nil)
    }

    @Test func draggedSelectionCarriesEveryNoteAndOldPayloadsStillDecode() throws {
        let ids = [UUID(), UUID(), UUID()]
        let item = PaneDragItem(kind: .note, id: ids[0], others: Array(ids.dropFirst()))
        let back = try JSONDecoder().decode(PaneDragItem.self, from: JSONEncoder().encode(item))
        #expect(back.ids == ids)
        let old = try JSONDecoder().decode(PaneDragItem.self, from: Data(#"{"kind":"note","id":"\#(ids[0].uuidString)"}"#.utf8))
        #expect(old.ids == [ids[0]])
    }

    @Test func movingSeveralToAFolder() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        Seed.ensureLibrary(ctx, demo: false)
        let f = ctx.createFolder(named: "Archive", parent: nil)
        let notes = (0..<3).map { ctx.createNote(in: .all, body: "N\($0)") }
        ctx.move(notes, to: f)
        #expect(notes.allSatisfy { $0.folder?.id == f.id })
    }
}

#endif
