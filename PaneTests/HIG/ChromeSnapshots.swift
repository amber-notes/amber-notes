#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The notes window's chrome as the window server draws it (the sidebar's glass, the toolbar
/// over each column), windowed and in full screen, light and dark, with the note at its top and
/// scrolled. Captured by the shell watcher in `.github/workflows/snapshots.yml` (see
/// `WarmGreySnapshots.shoot`): `AMBER_DEMO_FRAMES` is set only there, on GitHub's Macs, where the
/// window may be shown, made key and taken to full screen. Anywhere else it does nothing.
@MainActor @Suite(.serialized) struct ChromeSnapshots {
    /// A shown, key window in front, as on a desk; full screen needs an app that can be in front.
    static func frontWindow(_ view: some View, dark: Bool) -> NSWindow {
        NSApp.setActivationPolicy(.regular)
        let screen = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1280, height: 800)
        let size = CGSize(width: min(1180, screen.width), height: min(720, screen.height))
        let w = NSWindow(contentRect: CGRect(origin: .zero, size: size),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.collectionBehavior.insert(.fullScreenPrimary)
        w.contentViewController = NSHostingController(rootView: view)
        w.setContentSize(size)
        w.setFrameOrigin(CGPoint(x: screen.minX, y: screen.maxY - w.frame.height))
        NSApp.activate()
        w.makeKeyAndOrderFront(nil)
        return w
    }

    /// Scrolls the open note's text a screen down, so it runs under the toolbar.
    static func scrollNote(_ w: NSWindow) {
        func scrolls(in view: NSView) -> [NSScrollView] {
            if let scroll = view as? NSScrollView { return [scroll] }
            return view.subviews.flatMap(scrolls)
        }
        guard let content = w.contentView,
              let editor = scrolls(in: content).filter({ $0.documentView is NSTextView }).max(by: { $0.frame.width < $1.frame.width }) else { return }
        editor.contentView.scroll(to: CGPoint(x: 0, y: 260))
        editor.reflectScrolledClipView(editor.contentView)
    }

    @Test(arguments: [false, true])
    func window(dark: Bool) async throws {
        guard let dir = WarmGreySnapshots.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let mode = dark ? "dark" : "light"
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Welcome to Pinto Notes") {
            let w = Self.frontWindow(RootView().modelContainer(c).tint(Color(PColor.paneAccent)), dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.6))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-window-\(mode)", in: dir)
            Self.scrollNote(w)
            try? await Task.sleep(for: .seconds(0.6))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-window-scrolled-\(mode)", in: dir)
            w.toggleFullScreen(nil)
            for _ in 0..<40 where !w.styleMask.contains(.fullScreen) { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .seconds(1.5))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-fullscreen-\(w.styleMask.contains(.fullScreen) ? "" : "FAILED-")\(mode)", in: dir)
            Self.scrollNote(w)
            try? await Task.sleep(for: .seconds(0.6))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-fullscreen-scrolled-\(mode)", in: dir)
            w.toggleFullScreen(nil)
            for _ in 0..<40 where w.styleMask.contains(.fullScreen) { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    /// A new account: no notes, nothing open, the Get set up card in the list; windowed and in
    /// full screen (Emil's 2610071519 screenshots: a grey band over the empty detail pane, and a
    /// lighter strip over the sidebar in full screen).
    @Test(arguments: [false, true])
    func empty(dark: Bool) async throws {
        guard let dir = WarmGreySnapshots.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let mode = dark ? "dark" : "light"
        let c = try AppSnapshotTests.container()
        for n in (try? c.mainContext.fetch(FetchDescriptor<Note>())) ?? [] { c.mainContext.purge(n) }
        try? c.mainContext.save()
        try await AppSnapshotTests.withLastNote(c, "") {
            let root = RootView().modelContainer(c).environment(SetupStore(progress: SetupProgress())).tint(Color(PColor.paneAccent))
            let w = Self.frontWindow(root, dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.6))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-empty-\(mode)", in: dir)
            w.toggleFullScreen(nil)
            for _ in 0..<40 where !w.styleMask.contains(.fullScreen) { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .seconds(1.5))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-empty-fullscreen-\(w.styleMask.contains(.fullScreen) ? "" : "FAILED-")\(mode)", in: dir)
            w.toggleFullScreen(nil)
            for _ in 0..<40 where w.styleMask.contains(.fullScreen) { try? await Task.sleep(for: .milliseconds(100)) }
            try? await Task.sleep(for: .seconds(1))
        }
    }
}
#endif
