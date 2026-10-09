#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The note list is built new for another folder (ListIdentity), and stays the same list through
/// a search. Neither may lose the selection, the search field's focus or the arrow keys, and a
/// selection of several notes stays when one note changes. Real mouse and key events through the window, as in
/// FileRowClickTests; CI only.
@MainActor @Suite(.serialized) struct ListRebuildTests {
    @MainActor @Observable final class State {
        var scope: Scope = .all
        var ids: Set<UUID> = []
    }

    struct Host: View {
        let state: State
        var body: some View {
            NavigationStack {
                NoteListView(scope: state.scope, selection: Binding(get: { state.ids }, set: { state.ids = $0 }), onNewNote: {})
            }
        }
    }

    @MainActor struct Rig {
        let container: ModelContainer
        let state = State()
        let window: NSWindow
        let notes: [Note]
        let folder: Folder

        var table: NSTableView? { FileRowClickTests.table(in: window.contentView) }
        /// The note rows are the tall ones; headers are shorter.
        func noteRows(_ t: NSTableView) -> [Int] {
            let heights = (0 ..< t.numberOfRows).map { t.rect(ofRow: $0).height }
            let tallest = heights.max() ?? 0
            return (0 ..< t.numberOfRows).filter { heights[$0] > tallest - 2 }
        }
        func close() { window.orderOut(nil); window.close() }
        func settle(_ s: Double = 0.4) async {
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            try? await Task.sleep(for: .seconds(s))
        }

        func click(row: Int, in t: NSTableView, modifiers: NSEvent.ModifierFlags = []) {
            let r = t.rect(ofRow: row)
            let p = t.convert(NSPoint(x: r.midX, y: r.midY), to: nil)
            func event(_ type: NSEvent.EventType) -> NSEvent {
                NSEvent.mouseEvent(with: type, location: p, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)!
            }
            NSApp.postEvent(event(.leftMouseUp), atStart: false)
            window.sendEvent(event(.leftMouseDown))
        }

        func key(_ characters: String, code: UInt16, modifiers: NSEvent.ModifierFlags = []) {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime,
                                            windowNumber: window.windowNumber, context: nil, characters: characters,
                                            charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                    window.sendEvent(e)
                }
            }
        }
    }

    /// Twelve notes an hour apart: eight in "Work" (titles "Plan 0"… and "Budget 0"…), four in "Home".
    static func rig() async throws -> Rig {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let work = ctx.createFolder(named: "Work"), home = ctx.createFolder(named: "Home")
        var notes: [Note] = []
        for i in 0..<12 {
            let n = ctx.createNote(in: .folder(i < 8 ? work.id : home.id), body: "\(i % 2 == 0 ? "Plan" : "Budget") \(i)\n\nSome text.")
            n.updatedAt = .now.addingTimeInterval(-Double(i + 1) * 60)
            notes.append(n)
        }
        try ctx.save()
        let w = FileRowClickTests.KeyWindow(contentRect: CGRect(x: -20000, y: -20000, width: 420, height: 900), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        let rig = Rig(container: c, window: w, notes: notes, folder: home)
        w.contentViewController = NSHostingController(rootView: Host(state: rig.state).modelContainer(c))
        w.setContentSize(CGSize(width: 420, height: 900))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        await rig.settle(1)
        return rig
    }

    static func searchField(in view: NSView?) -> NSSearchField? {
        guard let view else { return nil }
        if let f = view as? NSSearchField { return f }
        for v in view.subviews { if let f = searchField(in: v) { return f } }
        return nil
    }

    static func focusIsIn(_ field: NSSearchField, of w: NSWindow) -> Bool {
        guard let editor = w.firstResponder as? NSText else { return w.firstResponder === field }
        return editor.delegate === field
    }

    @Test func searchingKeepsTheSelectionAndTheFieldsFocus() async throws {
        guard FileRowClickTests.onCI else { return }
        let rig = try await Self.rig()
        defer { rig.close() }
        let all = try #require(rig.table, "the List is a table")
        try #require(rig.noteRows(all).count == 12)
        rig.click(row: rig.noteRows(all)[3], in: all)
        await rig.settle()
        #expect(rig.state.ids == [rig.notes[3].id], "a click selects Budget 3")

        let field = try #require(Self.searchField(in: rig.window.contentView?.superview), "the search field is in the window")
        #expect(rig.window.makeFirstResponder(field))
        for (letter, code) in [("B", UInt16(11)), ("u", 32), ("d", 2)] {
            rig.key(letter, code: code)
            await rig.settle()
            #expect(Self.focusIsIn(field, of: rig.window), "after typing \(letter) the search field still has the keys")
            #expect(rig.state.ids == [rig.notes[3].id], "and Budget 3 is still selected")
        }
        #expect(field.stringValue == "Bud")
        let found = try #require(rig.table)
        #expect(rig.noteRows(found).count == 6, "the six Budget notes")
        #expect(found.selectedRowIndexes.count == 1, "with Budget 3 marked in it")

        // Cleared: everything is back, the selection and the focus as they were.
        rig.key("a", code: 0, modifiers: .command)
        rig.key("\u{7F}", code: 51)
        await rig.settle()
        #expect(field.stringValue.isEmpty)
        #expect(Self.focusIsIn(field, of: rig.window))
        #expect(rig.state.ids == [rig.notes[3].id])
        let back = try #require(rig.table)
        #expect(rig.noteRows(back).count == 12)
        #expect(back.selectedRowIndexes.count == 1)
    }

    @Test func arrowKeysWorkRightAfterAFolderSwitch() async throws {
        guard FileRowClickTests.onCI else { return }
        let rig = try await Self.rig()
        defer { rig.close() }
        let all = try #require(rig.table)
        rig.click(row: rig.noteRows(all)[0], in: all)
        await rig.settle()
        #expect(rig.state.ids == [rig.notes[0].id])

        rig.state.scope = .folder(rig.folder.id)
        await rig.settle(0.6)
        let home = try #require(rig.table)
        #expect(home !== all, "a folder is a new list")
        try #require(rig.noteRows(home).count == 4, "Home's four notes")
        rig.click(row: rig.noteRows(home)[1], in: home)
        await rig.settle()
        #expect(rig.state.ids == [rig.notes[9].id], "a click in the new list selects")
        rig.key("\u{F701}", code: 125)
        await rig.settle()
        #expect(rig.state.ids == [rig.notes[10].id], "the down arrow moves to the next note")
        rig.key("\u{F700}", code: 126)
        rig.key("\u{F700}", code: 126)
        await rig.settle()
        #expect(rig.state.ids == [rig.notes[8].id], "and the up arrow back up")

        rig.state.scope = .all
        await rig.settle(0.6)
        let again = try #require(rig.table)
        #expect(rig.noteRows(again).count == 12)
        #expect(rig.state.ids == [rig.notes[8].id], "back in All Notes the note is still selected")
        #expect(again.selectedRowIndexes.count == 1)
    }

    @Test func aChangeToOneNoteLeavesASelectionOfSeveralAlone() async throws {
        guard FileRowClickTests.onCI else { return }
        let rig = try await Self.rig()
        defer { rig.close() }
        let table = try #require(rig.table)
        rig.click(row: rig.noteRows(table)[4], in: table)
        await rig.settle()
        rig.click(row: rig.noteRows(table)[6], in: table, modifiers: .shift)
        await rig.settle()
        let chosen = Set(rig.notes[4...6].map(\.id))
        #expect(rig.state.ids == chosen, "three notes selected with a shift-click")

        // Sync changes another note, and brings one new note: neither is a new list.
        let ctx = rig.container.mainContext
        rig.notes[10].body = "Plan 10\n\nChanged on the phone."
        rig.notes[10].updatedAt = .now.addingTimeInterval(-30)
        _ = ctx.createNote(in: .folder(rig.folder.id), body: "From the phone\n\ntext")
        try ctx.save()
        await rig.settle(0.8)
        #expect(rig.table === table, "the same list")
        #expect(rig.state.ids == chosen, "with the same three notes selected")
        #expect(table.selectedRowIndexes.count == 3)
    }
}
#endif
