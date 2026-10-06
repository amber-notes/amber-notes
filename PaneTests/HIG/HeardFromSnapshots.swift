#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// "How did you hear about Amber Notes?" as the Mac sheet draws it, light and dark, before and
/// just after a tap. Runs only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/HeardFromSnapshots`.
@MainActor @Suite(.serialized) struct HeardFromSnapshots {
    @Test(arguments: [false, true])
    func sheet(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let asking = HeardFromStore(defaults: UserDefaults(suiteName: "heardFromShots")!, arguments: ["-forceHeardFrom"])
        try await AppSnapshotTests.render(HeardFromView(store: asking).tint(Color(PColor.paneAccent)), name: "mac-heardfrom-\(mode)", dark: dark)
        let tapped = HeardFromStore(defaults: UserDefaults(suiteName: "heardFromShots")!, arguments: ["-forceHeardFrom"])
        tapped.answer(.aiAssistant)
        try await AppSnapshotTests.render(HeardFromView(store: tapped).tint(Color(PColor.paneAccent)), name: "mac-heardfrom-tapped-\(mode)", dark: dark)
    }
}
#endif
