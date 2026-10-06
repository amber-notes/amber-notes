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
        for style in HeardFromStyle.allCases {
            let look = style == .today ? "" : "-\(style.rawValue)"
            let asking = HeardFromStore(defaults: UserDefaults(suiteName: "heardFromShots")!, arguments: ["-forceHeardFrom", "-heardFromStyle"])
            try await AppSnapshotTests.render(HeardFromView(store: asking, style: style, devPicker: false).tint(Color(PColor.paneAccent)), name: "mac-heardfrom\(look)-\(mode)", dark: dark)
            let tapped = HeardFromStore(defaults: UserDefaults(suiteName: "heardFromShots")!, arguments: ["-forceHeardFrom", "-heardFromStyle"])
            tapped.answer(.aiAssistant)
            try await AppSnapshotTests.render(HeardFromView(store: tapped, style: style, devPicker: false).tint(Color(PColor.paneAccent)), name: "mac-heardfrom\(look)-tapped-\(mode)", dark: dark)
        }
    }
}
#endif
