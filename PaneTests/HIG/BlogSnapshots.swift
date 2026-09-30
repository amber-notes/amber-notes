#if os(macOS)
import AppKit
import Supabase
import SwiftUI
import Testing
@testable import Pane

/// The Connect ChatGPT and Connect Claude guides as the Mac shows them, light, at 2x, for the
/// website's blog posts. Offscreen; nothing touches the screen. Runs only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/BlogSnapshots`.
@MainActor @Suite(.serialized) struct BlogSnapshots {
    @Test func connectGuides() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        for plan in [WebConnectPlan.chatgpt, .claude] {
            let view = NavigationStack {
                Form { WebConnectGuide(plan: plan, client: client) }
                    .formStyle(.grouped)
                    .navigationTitle("Connect \(plan.ai)")
            }
            .frame(width: 560, height: 560)
            try await VersionHistorySnapshots.shoot(view, to: dir.appending(path: "mac-connect-\(plan.ai.lowercased())-light.png"),
                                                    size: CGSize(width: 560, height: 560), dark: false)
        }
    }
}
#endif
