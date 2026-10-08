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

    static func tree(_ main: NSWindow) -> String {
        var out = ""
        func hex(_ c: CGColor?) -> String {
            guard let c, let n = NSColor(cgColor: c)?.usingColorSpace(.sRGB) else { return "-" }
            return String(format: "%02X%02X%02X/%.2f", Int(n.redComponent * 255), Int(n.greenComponent * 255), Int(n.blueComponent * 255), n.alphaComponent)
        }
        func walk(_ v: NSView, _ depth: Int, _ top: CGFloat) {
            let f = v.convert(v.bounds, to: nil)
            guard f.maxY > top - 64, depth < 40 else { return }
            var line = String(repeating: " ", count: depth) + "\(type(of: v)) [\(Int(f.minX)),\(Int(top - f.maxY)) \(Int(f.width))x\(Int(f.height))]"
            if v.isHidden { line += " hidden" }
            if v.alphaValue < 1 { line += " a\(v.alphaValue)" }
            if let l = v.layer, l.backgroundColor != nil { line += " bg \(hex(l.backgroundColor))" }
            if let e = v as? NSVisualEffectView { line += " material \(e.material.rawValue) blend \(e.blendingMode.rawValue) state \(e.state.rawValue)" }
            out += line + "\n"
            for s in v.subviews { walk(s, depth + 1, top) }
        }
        for w in NSApp.windows where w.isVisible || w === main {
            out += "WINDOW \(type(of: w))\(w === main ? " (main)" : "") frame \(w.frame) level \(w.level.rawValue) opaque \(w.isOpaque) bg \(hex(w.backgroundColor?.cgColor)) mask \(w.styleMask.rawValue) transparentTitle \(w.titlebarAppearsTransparent) sep \(w.titlebarSeparatorStyle.rawValue) layout \(w.contentLayoutRect) parent \(w.parent.map { "\(type(of: $0))" } ?? "-") children \(w.childWindows?.count ?? 0)\n"
            if let root = w.contentView?.superview ?? w.contentView { walk(root, 1, root.bounds.height) }
        }
        return out
    }

    /// Experiment: v0 as is, v1 the bar's background hidden (SwiftUI), v2 a see-through title bar
    /// with no separator (AppKit), v3 both.
    @Test(arguments: [false, true])
    func variants(dark: Bool) async throws {
        guard let dir = WarmGreySnapshots.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let mode = dark ? "dark" : "light"
        defer { ChromeExperiment.hideBar = false }
        for v in 0..<4 {
            ChromeExperiment.hideBar = v == 1 || v == 3
            let c = try AppSnapshotTests.container()
            for n in (try? c.mainContext.fetch(FetchDescriptor<Note>())) ?? [] { c.mainContext.purge(n) }
            try? c.mainContext.save()
            try await AppSnapshotTests.withLastNote(c, "") {
                let root = RootView().modelContainer(c).environment(SetupStore(progress: SetupProgress())).tint(Color(PColor.paneAccent))
                let w = Self.frontWindow(root, dark: dark)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1.2))
                if v >= 2 {
                    w.titlebarAppearsTransparent = true
                    w.titlebarSeparatorStyle = .none
                }
                try? await Task.sleep(for: .seconds(0.6))
                try await WarmGreySnapshots.shoot(w, "x-v\(v)-window-\(mode)", in: dir)
                if dark { try? Self.tree(w).write(to: dir.appending(path: "x-v\(v)-window-tree.txt"), atomically: true, encoding: .utf8) }
                w.toggleFullScreen(nil)
                for _ in 0..<40 where !w.styleMask.contains(.fullScreen) { try? await Task.sleep(for: .milliseconds(100)) }
                try? await Task.sleep(for: .seconds(2))
                try await WarmGreySnapshots.shoot(w, "x-v\(v)-full-\(w.styleMask.contains(.fullScreen) ? "" : "FAILED-")\(mode)", in: dir)
                if dark { try? Self.tree(w).write(to: dir.appending(path: "x-v\(v)-full-tree.txt"), atomically: true, encoding: .utf8) }
                w.toggleFullScreen(nil)
                for _ in 0..<40 where w.styleMask.contains(.fullScreen) { try? await Task.sleep(for: .milliseconds(100)) }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}
#endif
