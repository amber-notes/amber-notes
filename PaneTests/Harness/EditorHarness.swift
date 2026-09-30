#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The real Mac editor in an offscreen window, driven by calling the view
/// directly. Nothing here posts system-wide events, moves the pointer or
/// takes focus from other apps.
@MainActor
final class EditorHarness {
    let window: NSWindow
    let scroll: NSScrollView
    let view: PaneTextView
    let controller = EditorController()

    init(_ text: String, width: CGFloat = 720, height: CGFloat = 900, dark: Bool = false, focus: Bool = true) async {
        window = KeyableWindow(contentRect: NSRect(x: -30000, y: -30000, width: width, height: height),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.backgroundColor = .textBackgroundColor
        scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        // The note page's own colour, so snapshots show what you'd see in either mode.
        scroll.drawsBackground = true
        scroll.backgroundColor = .textBackgroundColor
        scroll.hasVerticalScroller = true
        view = PaneTextView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        view.configure(text: text, header: "")
        view.controller = controller
        controller.target = view
        scroll.documentView = view
        window.contentView = scroll
        view.frame.size.width = width
        // Key within this (inactive, Dock-less) app only: focus works without taking it from anyone.
        window.makeKey()
        if focus { window.makeFirstResponder(view) }
        await settle()
    }

    var text: String { view.string }
    var selection: NSRange { view.selectedRange() }

    /// Lets queued main-thread work (overlay layout, delayed sorts, SwiftUI updates) run:
    /// suspending frees the main queue, the way the app's own run loop would.
    func settle(_ seconds: Double = 0.05) async {
        try? await Task.sleep(for: .seconds(seconds))
    }

    func select(_ location: Int, _ length: Int = 0) async {
        view.setSelectedRange(NSRange(location: location, length: length))
        await settle()
    }

    /// Caret right after the first match of `s`.
    func caret(after s: String) async {
        let r = (text as NSString).range(of: s)
        precondition(r.location != NSNotFound, "no \(s)")
        await select(NSMaxRange(r))
    }

    func type(_ s: String) async {
        view.insertText(s, replacementRange: view.selectedRange())
        await settle()
    }

    func command(_ selector: Selector) async {
        view.doCommand(by: selector)
        await settle()
    }

    /// A key press delivered to the text view (arrows, Return, Delete…), as the
    /// window would deliver it, without posting anything system-wide.
    func key(_ code: UInt16, _ chars: String, _ flags: NSEvent.ModifierFlags = []) async {
        let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                 windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars,
                                 isARepeat: false, keyCode: code)!
        // The window routes it: SwiftUI key handlers first, then the first responder.
        window.sendEvent(e)
        await settle()
    }

    static let up: (UInt16, String) = (126, String(UnicodeScalar(NSUpArrowFunctionKey)!))
    static let down: (UInt16, String) = (125, String(UnicodeScalar(NSDownArrowFunctionKey)!))
    static let left: (UInt16, String) = (123, String(UnicodeScalar(NSLeftArrowFunctionKey)!))
    static let right: (UInt16, String) = (124, String(UnicodeScalar(NSRightArrowFunctionKey)!))
    static let delete: (UInt16, String) = (51, "\u{7F}")
    static let returnKey: (UInt16, String) = (36, "\r")
    static let tab: (UInt16, String) = (48, "\t")
    func press(_ k: (UInt16, String), _ flags: NSEvent.ModifierFlags = []) async { await key(k.0, k.1, flags) }

    /// Whether some grid cell (a text field inside a table) has the keyboard.
    var gridHasFocus: Bool {
        guard let r = window.firstResponder as? NSView else { return false }
        return r !== view && r.isDescendant(of: view)
    }

    /// The grid cell's text field that has the keyboard, if one has: a different one each
    /// time the keyboard moves to another cell.
    var focusedGridField: NSView? {
        guard gridHasFocus, let r = window.firstResponder as? NSView else { return nil }
        if let editor = r as? NSTextView, editor.isFieldEditor, let field = editor.delegate as? NSView { return field }
        return r
    }

    /// Waits until `done` holds, for work that lands a few run-loop turns later (focus moving
    /// between grid cells), however busy the main thread is. False if it never did.
    @discardableResult
    func until(_ seconds: Double = 5, _ done: () -> Bool) async -> Bool {
        let end = Date.now.addingTimeInterval(seconds)
        while !done() {
            if Date.now >= end { return false }
            await settle(0.01)
        }
        return true
    }

    /// A click at a point in the text view's own (flipped) coordinates.
    func click(_ p: CGPoint, count: Int = 1) async {
        let inWindow = view.convert(p, to: nil)
        func event(_ type: NSEvent.EventType) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: inWindow, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: count, pressure: type == .leftMouseDown ? 1 : 0)!
        }
        // NSTextView tracks the drag until mouse-up: queue it in this app only.
        NSApp.postEvent(event(.leftMouseUp), atStart: false)
        view.mouseDown(with: event(.leftMouseDown))
        await settle()
    }

    /// A click routed the way the window would: to whichever view is under the point
    /// (a grid cell, an embed, or the text). `p` is in text-view coordinates.
    func clickRouted(_ p: CGPoint) async {
        let inWindow = view.convert(p, to: nil)
        func event(_ type: NSEvent.EventType) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: inWindow, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)!
        }
        NSApp.postEvent(event(.leftMouseUp), atStart: false)
        window.sendEvent(event(.leftMouseDown))
        await settle()
    }

    /// The rect a character's line occupies, in view coordinates.
    func lineRect(at offset: Int) -> CGRect {
        guard let tlm = view.textLayoutManager, let tcm = tlm.textContentManager,
              let loc = tcm.location(tcm.documentRange.location, offsetBy: offset) else { return .zero }
        tlm.ensureLayout(for: tcm.documentRange)
        guard let frag = tlm.textLayoutFragment(for: loc) else { return .zero }
        return frag.layoutFragmentFrame.offsetBy(dx: view.textContainerOrigin.x, dy: view.textContainerOrigin.y)
    }

    /// Live views over the text (grids, embeds), keyed like the editor keys them.
    var overlays: [NSView] { view.subviews.filter { $0 is NSHostingView<AnyView> } }

    /// Whether a grid table is showing as the grid (not as markdown source).
    var gridCount: Int { view.core.grids.count }

    /// Draws the window's content to a PNG under .shots/qa and returns the path.
    @discardableResult
    func snapshot(_ name: String) async -> String {
        await settle(0.15)
        let target = scroll
        let rect = target.bounds
        guard let rep = target.bitmapImageRepForCachingDisplay(in: rect) else { return "" }
        target.cacheDisplay(in: rect, to: rep)
        // Never under ~/Documents: an ad-hoc test build touching it can raise a privacy prompt.
        let dir = EditorHarness.shotsDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: "\(name).png")
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        return url.path
    }

    func close() { window.orderOut(nil); window.close() }

    /// Where snapshots go: a temporary folder outside any privacy-protected location
    /// (scripts/qa-shots.sh copies them into .shots/qa).
    static var shotsDirectory: URL {
        URL(fileURLWithPath: ProcessInfo.processInfo.environment["AMBER_QA_SHOTS"] ?? NSTemporaryDirectory()).appending(path: "amber-qa", directoryHint: .isDirectory)
    }
}

/// Borderless windows can't normally be key; SwiftUI focus inside the grid needs it.
final class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
#endif
