#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The warm grey look, light and dark: the app with a note open (the setup card showing and an
/// AI's tint held), the empty state, and sign-in empty and with an email typed. Windows sit far
/// off every screen and are captured by the same shell watcher as `AIEditSnapshots.demoFrames`,
/// so the sidebar's glass renders. The test writes `window-id` and `ready-<name>`, then waits
/// for the shell to write `shot-<name>`.
/// `TEST_RUNNER_AMBER_DEMO_FRAMES=/path scripts/qa-test.sh PaneTests/WarmGreySnapshots`
@MainActor @Suite(.serialized) struct WarmGreySnapshots {
    /// Captured by window id (screencapture), which needs the window on screen: CI only
    /// (AppSnapshotTests.onScreenAllowed). The sign-in shots draw offscreen and use `anyDir`.
    static var dir: URL? { AppSnapshotTests.onScreenDir("AMBER_DEMO_FRAMES") }
    static var anyDir: URL? { ProcessInfo.processInfo.environment["AMBER_DEMO_FRAMES"].map { URL(fileURLWithPath: $0) } }

    static func shoot(_ w: NSWindow, _ name: String, in dir: URL) async throws {
        try "\(w.windowNumber)".write(to: dir.appending(path: "window-id"), atomically: true, encoding: .utf8)
        try "".write(to: dir.appending(path: "ready-\(name)"), atomically: true, encoding: .utf8)
        let done = dir.appending(path: "shot-\(name)")
        for _ in 0..<200 where !FileManager.default.fileExists(atPath: done.path) { try? await Task.sleep(for: .milliseconds(50)) }
    }

    @Test(arguments: [false, true])
    func app(dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Groceries") {
            let root = RootView().modelContainer(c).environment(SetupStore(progress: SetupProgress(imported: true)))
                .tint(Color(PColor.paneAccent))
                .environment(\.controlActiveState, .key)
            let w = AIEditSnapshots.window(root, size: CGSize(width: 1180, height: 720), dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.6))
            Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.4))
            try await Self.shoot(w, "mac-app-\(dark ? "dark" : "light")", in: dir)
        }
    }

    @Test(arguments: [false, true])
    func empty(dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let c = try AppSnapshotTests.container()
        for n in (try? c.mainContext.fetch(FetchDescriptor<Note>())) ?? [] { c.mainContext.purge(n) }
        try? c.mainContext.save()
        try await AppSnapshotTests.withLastNote(c, "") {
            let root = RootView().modelContainer(c).tint(Color(PColor.paneAccent)).environment(\.controlActiveState, .key)
            let w = AIEditSnapshots.window(root, size: CGSize(width: 1180, height: 720), dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.6))
            try await Self.shoot(w, "mac-empty-\(dark ? "dark" : "light")", in: dir)
        }
    }

    @Test(arguments: [false, true])
    func signIn(dark: Bool) async throws {
        guard let dir = Self.anyDir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, email) in [("mac-signin", ""), ("mac-signin-email", "you@example.com")] {
            let view = SignInView(backend: Backend(), flow: EmailSignInFlow(email: email))
                .fixedSize()
                .tint(Color(PColor.paneAccent))
                .environment(\.controlActiveState, .key)
                .containerBackground(for: .window) { Backdrop() }
            // Borderless, far off screen, never ordered front or made key (AppSnapshotTests.shoot).
            let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 380, height: 560),
                             styleMask: [.borderless], backing: .buffered, defer: false)
            w.isReleasedWhenClosed = false
            w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            w.contentViewController = NSHostingController(rootView: view)
            defer { w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            // Drawn offscreen: a window that is never on screen can't be captured by its id.
            let content = try #require(w.contentView)
            content.layoutSubtreeIfNeeded()
            let rep = try #require(content.bitmapImageRepForCachingDisplay(in: content.bounds))
            content.cacheDisplay(in: content.bounds, to: rep)
            try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "\(name)-\(dark ? "dark" : "light").png"))
        }
    }
}
#endif
