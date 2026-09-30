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

    /// The same guides, and the Connect an AI list, laid out narrow (about a blog card's width), so
    /// a card's picture shows whole lines at full size instead of a shrunken window.
    @Test func narrowForCards() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        let size = CGSize(width: 340, height: 560)
        for plan in [WebConnectPlan.chatgpt, .claude] {
            let view = Form { WebConnectGuide(plan: plan, client: client) }.formStyle(.grouped).frame(width: size.width, height: size.height)
            try await VersionHistorySnapshots.shoot(view, to: dir.appending(path: "card-connect-\(plan.ai.lowercased()).png"), size: size, dark: false)
        }
        let list = Form { ConnectAISection(client: client) }.formStyle(.grouped).frame(width: size.width, height: size.height)
        try await VersionHistorySnapshots.shoot(list, to: dir.appending(path: "card-connect-list.png"), size: size, dark: false)
    }

    /// Standup notes just after Claude Code added today's standup: the lines it wrote tinted, and
    /// "Claude Code changed … lines · Undo" at the bottom. For the work-log post.
    @Test func standupByClaudeCode() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Standup notes") {
            let w = AIEditSnapshots.window(AIEditSnapshots.root(c), size: CGSize(width: 1180, height: 760))
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            Capture.aiEdit(c.mainContext, title: "Standup notes", scene: "standup", by: "Claude Code")
            try? await Task.sleep(for: .seconds(1.6))
            try AIEditSnapshots.snap(w, to: dir.appending(path: "mac-standup-claude-code.png"))
        }
    }
}
#endif
