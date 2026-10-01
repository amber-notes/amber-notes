#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// "Use this template" (ready, added) and "Use this note", light and dark, at 2x, offscreen. Runs
/// only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/NoteSourceSnapshots`.
@MainActor @Suite(.serialized) struct NoteSourceSnapshots {
    @Test(arguments: [false, true])
    func sheet(dark: Bool) async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        for name in ["template", "template-added", "copy"] {
            let model = await NoteSourceCapture.model(name, context: c.mainContext)
            try await VersionHistorySnapshots.shoot(NoteSourceSheet(model: model).modelContainer(c).background(Color(nsColor: .windowBackgroundColor)),
                                                    to: dir.appending(path: "mac-\(name)-\(dark ? "dark" : "light").png"),
                                                    size: CGSize(width: 520, height: 620), dark: dark)
        }
    }
}
#endif
