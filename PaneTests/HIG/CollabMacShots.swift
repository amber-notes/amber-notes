#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// Collaboration (prototype) on the Mac: the presence avatars in a real toolbar and the Share
/// sheet with sample people, light and dark, in off-screen windows photographed by
/// scripts/collab-mac-shots.sh with `screencapture -l`. Nothing appears on the display. Runs only
/// when AMBER_COLLAB_MAC is set.
@MainActor @Suite(.serialized) struct CollabMacShots {
    @Test func frames() async throws {
        guard let dir = ProcessInfo.processInfo.environment["AMBER_COLLAB_MAC"].map({ URL(fileURLWithPath: $0) }) else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for dark in [false, true] {
            let mode = dark ? "dark" : "light"
            let avatars = MacStoreShots.window(CollabGallery().tint(Color(PColor.paneAccent)), size: CGSize(width: 720, height: 560), dark: dark)
            let share = MacStoreShots.window(NavigationStack { ShareForm(title: "Team offsite", state: CollabGallery.share) }.tint(Color(PColor.paneAccent)),
                                             size: CGSize(width: 480, height: 440), dark: dark)
            let template = MacStoreShots.window(CollabGallery.templateSheet().tint(Color(PColor.paneAccent)), size: CGSize(width: 480, height: 470), dark: dark)
            defer { for w in [avatars, share, template] { w.orderOut(nil); w.close() } }
            try? await Task.sleep(for: .seconds(1))
            try await MacStoreShots.shoot(dir, "collab-\(mode)", [("avatars", avatars), ("share", share), ("template", template)])
        }
    }
}
#endif
