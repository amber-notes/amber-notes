#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// "Enjoying Amber Notes?" as the Mac shows it: a real sheet on a notes window that sits far off
/// every screen, captured by `screencapture -l` from the shell so the sheet's material renders.
/// The test writes `window-<name>` (the sheet's window number) and waits for the shell to write
/// `shot-<name>`. Nothing appears on the display and nothing takes focus.
///   `TEST_RUNNER_AMBER_SHARE_ASK_SHOTS=/path xcodebuild … test -only-testing:PaneTests/ShareAskSnapshots`
@MainActor @Suite(.serialized) struct ShareAskSnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_SHARE_ASK_SHOTS"].map { URL(fileURLWithPath: $0) } }

    @Test func sheets() async throws {
        guard let dir = Self.dir else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let c = try AppSnapshotTests.container()
        ShareAskSheet.drawsAsKey = true
        defer { ShareAskSheet.drawsAsKey = false }
        for dark in [false, true] {
            for (thanks, developer) in [(false, false), (true, false), (false, true), (true, true)] {
                let name = "mac-\(developer ? "dev-" : "")\(thanks ? "thanks" : "ask")-\(dark ? "dark" : "light")"
                let store = ShareAskStore(arguments: ["-forceShareAsk"] + (thanks ? ["thanks"] : []) + (developer ? ["-shareAskDeveloper"] : []))
                let root = RootView().modelContainer(c).environment(SetupStore())
                    .shareAskSheet(store)
                    .tint(Color(PColor.paneAccent))
                let w = AIEditSnapshots.window(root, size: CGSize(width: 1180, height: 760), dark: dark)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1))
                store.showIfForced()
                try? await Task.sleep(for: .seconds(1.5))
                let sheet = try #require(w.attachedSheet)
                sheet.appearance = w.appearance
                try "\(sheet.windowNumber)".write(to: dir.appending(path: "window-\(name)"), atomically: true, encoding: .utf8)
                let done = dir.appending(path: "shot-\(name)")
                for _ in 0..<200 where !FileManager.default.fileExists(atPath: done.path) { try? await Task.sleep(for: .milliseconds(50)) }
                store.visible = false
                try? await Task.sleep(for: .seconds(0.5))
            }
        }
    }
}
#endif
