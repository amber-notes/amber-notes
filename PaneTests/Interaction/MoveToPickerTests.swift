#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// "Move to…": the folders in the sidebar's order with a search field. The order and the search
/// are checked as values; a click and Return go through a real window on CI, and the picker is
/// drawn light and dark for the test results (CI's "snapshots" artifact).
@MainActor @Suite(.serialized) struct MoveToPickerTests {
    /// Work > (Clients > Acme, Plans), Home, Travel; the note is in Plans.
    static func library() throws -> (ModelContainer, [String: Folder]) {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        var by: [String: Folder] = [:]
        for name in ["Work", "Home", "Travel", "Clients", "Plans", "Acme"] { by[name] = ctx.createFolder(named: name) }
        ctx.move(by["Clients"]!, into: by["Work"])
        ctx.move(by["Plans"]!, into: by["Work"])
        ctx.move(by["Acme"]!, into: by["Clients"])
        try ctx.save()
        return (c, by)
    }

    @Test func theFoldersAreListedAsTheSidebarHasThem() throws {
        let (c, by) = try Self.library()
        let rows = MoveToPicker.rows(c.mainContext.allFolders())
        #expect(Set(rows.map(\.name)) == ["Work", "Home", "Travel", "Clients", "Plans", "Acme"])
        let names = rows.map(\.name)
        // Each folder right under its parent, a level in.
        let work = try #require(names.firstIndex(of: "Work")), clients = try #require(names.firstIndex(of: "Clients")), acme = try #require(names.firstIndex(of: "Acme"))
        #expect(work < clients && clients < acme && acme == clients + 1)
        #expect(rows[work].depth == 0 && rows[clients].depth == 1 && rows[acme].depth == 2)
        #expect(rows[acme].path == "Work / Clients")
        // The top level in the sidebar's order.
        let top = rows.filter { $0.depth == 0 }.map(\.name)
        #expect(top == [by["Work"]!, by["Home"]!, by["Travel"]!].sorted { $0.sortIndex < $1.sortIndex }.map(\.name))
    }

    @Test func aSearchListsMatchingFoldersFlatWithWhereTheyAre() throws {
        let (c, _) = try Self.library()
        let found = MoveToPicker.rows(c.mainContext.allFolders(), matching: " pl ")
        #expect(found.map(\.name) == ["Plans"])
        #expect(found.first?.depth == 0 && found.first?.path == "Work")
        #expect(MoveToPicker.rows(c.mainContext.allFolders(), matching: "zzz").isEmpty)
        #expect(MoveToPicker.rows(c.mainContext.allFolders(), matching: "a").map(\.name).sorted() == ["Acme", "Plans", "Travel"])
    }

    /// The number of folders doesn't change what the toolbar's menu holds: listing them costs
    /// nothing until the picker is on screen.
    @Test func manyFoldersAreListedOnlyWhenThePickerShows() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        for i in 0..<150 { _ = c.mainContext.createFolder(named: "Folder \(i)") }
        let before = MoveToPicker.listed
        let rows = MoveToPicker.rows(c.mainContext.allFolders())
        #expect(rows.count == 150)
        #expect(MoveToPicker.listed == before + 1)
    }

    /// The notes window with a note open and 150 folders: the toolbar's ••• menu is there, and
    /// no folder has been listed for Move to (it was a menu item per folder, built with the
    /// toolbar before the window's first frame).
    @Test func theToolbarListsNoFoldersUntilThePickerOpens() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folders = (0..<150).map { ctx.createFolder(named: "Folder \($0)") }
        let note = ctx.createNote(in: .folder(folders[3].id), body: "A note\n\nSome text.")
        try ctx.save()
        let before = MoveToPicker.listed
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 1180, height: 760), styleMask: [.borderless], backing: .buffered, defer: false)
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
        #expect(MoveToPicker.listed == before, "no folder is listed for Move to before its picker opens")
    }

    struct Host: View {
        let current: UUID?
        let moved: (Folder) -> Void
        // A popover gives the picker its ground; here the window's does.
        var body: some View { MoveToPicker(current: current, move: moved).background(Color(nsColor: .windowBackgroundColor)) }
    }

    static func window(_ c: ModelContainer, current: UUID?, dark: Bool = false, moved: @escaping (Folder) -> Void) -> NSWindow {
        let w = FileRowClickTests.KeyWindow(contentRect: CGRect(x: -20000, y: -20000, width: 280, height: 400), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.contentViewController = NSHostingController(rootView: Host(current: current, moved: moved).modelContainer(c))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        return w
    }

    @Test func aClickMovesAndTheCurrentFolderIsNotAChoice() async throws {
        guard FileRowClickTests.onCI else { return }
        let (c, by) = try Self.library()
        var moved: [String] = []
        let w = Self.window(c, current: by["Plans"]!.id) { moved.append($0.name) }
        defer { w.orderOut(nil); w.close() }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        try? await Task.sleep(for: .milliseconds(600))
        let rows = MoveToPicker.rows(c.mainContext.allFolders())
        let content = try #require(w.contentView)
        func click(_ name: String) throws {
            let i = try #require(rows.firstIndex { $0.name == name })
            // Rows start under the search field and its line, 6 pt in; AppKit's y runs up.
            let fromTop = MoveToPicker.Metrics.search + 1 + 6 + (CGFloat(i) + 0.5) * MoveToPicker.Metrics.row
            let p = content.convert(NSPoint(x: content.bounds.midX, y: content.isFlipped ? fromTop : content.bounds.height - fromTop), to: nil)
            func event(_ type: NSEvent.EventType) -> NSEvent {
                NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: w.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)!
            }
            NSApp.postEvent(event(.leftMouseUp), atStart: false)
            w.sendEvent(event(.leftMouseDown))
        }
        try click("Plans")
        try? await Task.sleep(for: .milliseconds(300))
        #expect(moved.isEmpty, "the folder the note is in is not a choice")
        try click("Acme")
        try? await Task.sleep(for: .milliseconds(300))
        #expect(moved == ["Acme"], "a click on a folder moves there")
    }

    /// A key press as the keyboard makes it: down then up, to the app when the window is key (so
    /// key equivalents get their turn first, as they do from a real keyboard).
    static func press(_ characters: String, code: UInt16, flags: NSEvent.ModifierFlags = [], in w: NSWindow) {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: w.windowNumber,
                                     context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!
            if w.isKeyWindow { NSApp.sendEvent(e) } else { w.sendEvent(e) }
        }
    }

    enum Key: Equatable {
        case down, up, enter
        case text(String)
    }

    /// The picker in a key window with the note in Plans; the keys go in one at a time, as typed.
    /// What comes back is where the note went.
    static func typing(_ keys: [Key]) async throws -> [String] {
        let (c, by) = try Self.library()
        var moved: [String] = []
        let w = Self.window(c, current: by["Plans"]!.id) { moved.append($0.name) }
        defer { w.orderOut(nil); w.close() }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        try? await Task.sleep(for: .milliseconds(600))
        // The control: the search field has the keyboard, as it does when the popover opens.
        try #require(w.firstResponder is NSText, "the search field isn't focused (first responder: \(String(describing: w.firstResponder)), key window: \(w.isKeyWindow)), so keys can't reach the picker")
        for key in keys {
            switch key {
            case .down: press("\u{F701}", code: 125, flags: [.numericPad, .function], in: w)
            case .up: press("\u{F700}", code: 126, flags: [.numericPad, .function], in: w)
            case .enter: press("\r", code: 36, in: w)
            case .text(let text): for ch in text { press(String(ch), code: 0, in: w) }
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return moved
    }

    /// Return moves to the row that is highlighted, wherever the arrows left it. It used to move
    /// to the row that was highlighted when the picker opened (or the search's first result):
    /// the note went to a folder nobody chose.
    @Test func returnMovesToTheRowTheArrowsHighlighted() async throws {
        guard FileRowClickTests.onCI else { return }
        let (c, by) = try Self.library()
        // Work, Clients, Acme, Home, Travel: Plans, where the note is, is not a choice.
        let choices = MoveToPicker.rows(c.mainContext.allFolders()).filter { $0.id != by["Plans"]!.id }.map(\.name)
        try #require(choices.count == 5)
        #expect(try await Self.typing([.enter]) == [choices[0]], "Return with no arrows moves to the first folder")
        #expect(try await Self.typing([.down, .down, .up, .enter]) == [choices[1]], "down, down, up, Return")
        #expect(try await Self.typing([.down, .down, .down, .enter]) == [choices[3]], "three down goes past the folder the note is in")
        #expect(try await Self.typing([.down, .down, .down, .down, .down, .down, .enter]) == [choices[4]], "down stops at the last folder")
        #expect(try await Self.typing([.down, .up, .up, .up, .enter]) == [choices[0]], "up stops at the first folder")
    }

    @Test func returnAfterASearchMovesToTheRowTheArrowsHighlighted() async throws {
        guard FileRowClickTests.onCI else { return }
        let (c, by) = try Self.library()
        // "a" finds Acme, Plans and Travel; Plans, where the note is, is not a choice.
        let found = MoveToPicker.rows(c.mainContext.allFolders(), matching: "a").filter { $0.id != by["Plans"]!.id }.map(\.name)
        try #require(found.count == 2)
        #expect(try await Self.typing([.text("a"), .enter]) == [found[0]], "Return after a search moves to its first result")
        #expect(try await Self.typing([.text("a"), .down, .enter]) == [found[1]], "a search, down, Return: past the folder the note is in")
        #expect(try await Self.typing([.down, .down, .down, .text("a"), .enter]) == [found[0]], "the highlighted folder left the list: the first result")
        #expect(try await Self.typing([.text("zzz"), .down, .enter]) == [], "no result, nothing moves")
    }

    @Test(arguments: [false, true]) func thePickerLightAndDark(dark: Bool) async throws {
        guard FileRowClickTests.onCI else { return }
        let (c, by) = try Self.library()
        let w = Self.window(c, current: by["Plans"]!.id, dark: dark) { _ in }
        defer { w.orderOut(nil); w.close() }
        w.orderFrontRegardless()
        try? await Task.sleep(for: .seconds(1))
        let v = try #require(w.contentView)
        v.layoutSubtreeIfNeeded()
        let rep = try #require(v.bitmapImageRepForCachingDisplay(in: v.bounds))
        v.cacheDisplay(in: v.bounds, to: rep)
        Testing.Attachment.record(try #require(rep.representation(using: .png, properties: [:])), named: "move-to-picker-\(dark ? "dark" : "light").png")
    }
}
#endif
