#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The notes window's chrome as the window server draws it (the sidebar's glass, the toolbar
/// over each column), windowed and in full screen, light and dark. Captured by the shell watcher
/// in `.github/workflows/snapshots.yml` (see `WarmGreySnapshots.shoot`), on GitHub's Macs only.
/// `TEST_RUNNER_AMBER_DEMO_FRAMES=/path` with a watcher running; otherwise it does nothing.
@MainActor @Suite(.serialized) struct ChromeSnapshots {
    @Test(arguments: [false, true])
    func window(dark: Bool) async throws {
        guard let dir = WarmGreySnapshots.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let mode = dark ? "dark" : "light"
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Evening tracker") {
            let root = RootView().modelContainer(c).tint(Color(PColor.paneAccent)).environment(\.controlActiveState, .key)
            let w = AIEditSnapshots.window(root, size: CGSize(width: 1180, height: 720), dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.6))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-window-\(mode)", in: dir)
            w.toggleFullScreen(nil)
            try? await Task.sleep(for: .seconds(2.5))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-fullscreen-\(mode)", in: dir)
            w.toggleFullScreen(nil)
            try? await Task.sleep(for: .seconds(2))
        }
    }

    /// The detail pane with no note open.
    @Test(arguments: [false, true])
    func empty(dark: Bool) async throws {
        guard let dir = WarmGreySnapshots.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "") {
            let root = RootView().modelContainer(c).tint(Color(PColor.paneAccent)).environment(\.controlActiveState, .key)
            let w = AIEditSnapshots.window(root, size: CGSize(width: 1180, height: 720), dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.6))
            try await WarmGreySnapshots.shoot(w, "mac-chrome-empty-\(dark ? "dark" : "light")", in: dir)
        }
    }
}
#endif
