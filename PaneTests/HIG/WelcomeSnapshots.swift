#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The welcome and its sign-in step at the Mac window's size, light and dark.
/// Runs only when AMBER_HIG_SHOTS is set: `AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/WelcomeSnapshots`.
@MainActor @Suite(.serialized) struct WelcomeSnapshots {
    /// As the app shows it signed out: the whole window, under a see-through title bar.
    static func shoot(_ view: some View, name: String, dark: Bool) async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let size = WelcomeFlow.size
        let window = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: size.width, height: size.height),
                              styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let host = NSHostingController(rootView: view.ignoresSafeArea().containerBackground(for: .window) { Backdrop() })
        host.sizingOptions = []
        window.contentViewController = host
        // The app fits the whole window, title bar included, to the welcome (WindowShaper).
        window.setFrame(CGRect(origin: CGPoint(x: -30000, y: -30000), size: size), display: false)
        window.orderFrontRegardless()
        try? await Task.sleep(for: .seconds(0.3))
        window.setFrame(CGRect(origin: window.frame.origin, size: size), display: true)
        try? await Task.sleep(for: .seconds(0.6))
        defer { window.orderOut(nil); window.close() }
        guard let frame = window.contentView?.superview else { return }
        let rep = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
        frame.cacheDisplay(in: frame.bounds, to: rep)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "\(name).png"))
    }

    @Test(arguments: [false, true])
    func welcome(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let backend = Backend()
        for (name, stage) in [("welcome", WelcomeFlow.Stage.welcome), ("signin", .signIn(returning: false)), ("signin-returning", .signIn(returning: true))] {
            try await Self.shoot(WelcomeFlow(backend: backend, stage: stage), name: "mac-\(name)-\(mode)", dark: dark)
        }
        try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false), focusEmail: true), name: "mac-signin-focused-\(mode)", dark: dark)
    }
}
#endif
