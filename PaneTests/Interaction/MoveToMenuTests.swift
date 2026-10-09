#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// "Move to" lists its folders when a menu opens, not when the menu is built. This opens a real
/// menu (a tracking session, as a click starts one) and reads it while it is open: the folders
/// must be there for the person looking at it. CI only: a menu shows on screen.
@MainActor @Suite(.serialized) struct MoveToMenuTests {
    /// Runs a block a moment into the menu's tracking session, where only timers and
    /// performs in the common modes run.
    final class WhileOpen: NSObject {
        var block: (() -> Void)?
        @objc func run() { block?(); block = nil }
    }

    static func popUp(in view: NSView?) -> NSPopUpButton? {
        guard let view else { return nil }
        if let p = view as? NSPopUpButton { return p }
        for v in view.subviews { if let p = popUp(in: v) { return p } }
        return nil
    }

    static func classes(in view: NSView?, depth: Int = 0) -> [String] {
        guard let view, depth < 12 else { return [] }
        return ["\(type(of: view))"] + view.subviews.flatMap { classes(in: $0, depth: depth + 1) }
    }

    @Test func theFoldersAreThereWhileTheMenuIsOpen() async throws {
        guard FileRowClickTests.onCI else { return }
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folders = (0..<150).map { ctx.createFolder(named: "Folder \($0)") }
        try ctx.save()
        let menu = Menu("More") {
            Button("Pin Note") {}
            MoveToMenu(folders: { folders }, current: folders[3].id) { _ in }
        }
        let w = FileRowClickTests.KeyWindow(contentRect: CGRect(x: -20000, y: -20000, width: 300, height: 120), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.contentViewController = NSHostingController(rootView: menu.padding(20).frame(width: 300, height: 120))
        w.setContentSize(CGSize(width: 300, height: 120))
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        defer { w.orderOut(nil); w.close() }
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        w.contentView?.layoutSubtreeIfNeeded()
        w.displayIfNeeded()
        try? await Task.sleep(for: .milliseconds(500))
        let button = try #require(Self.popUp(in: w.contentView), "the Menu is a pop-up button (views: \(Self.classes(in: w.contentView).joined(separator: " ")))")
        func moveTo() -> NSMenuItem? { button.menu?.items.first { $0.title == "Move to" } }
        #expect((moveTo()?.submenu?.items.count ?? 0) == 0, "no folder is listed before the menu opens")

        var whileOpen = -1
        var disabledWhileOpen = -1
        let probe = WhileOpen()
        probe.block = {
            whileOpen = moveTo()?.submenu?.items.count ?? -1
            disabledWhileOpen = moveTo()?.submenu?.items.filter { !$0.isEnabled }.count ?? -1
            button.menu?.cancelTracking()
        }
        probe.perform(#selector(WhileOpen.run), with: nil, afterDelay: 1.5, inModes: [.common])
        // Opens the menu and returns when it closes.
        button.performClick(nil)
        #expect(whileOpen == 150, "every folder is in Move to while the menu is open (items: \(button.menu?.items.map(\.title) ?? []))")
        #expect(disabledWhileOpen == 1, "the folder the note is in is off")
        try? await Task.sleep(for: .milliseconds(1500))
        w.contentView?.layoutSubtreeIfNeeded()
        #expect(!MenuTracking.shared.open)
        #expect((moveTo()?.submenu?.items.count ?? 0) == 0, "and they go again once it has closed")
    }
}
#endif
