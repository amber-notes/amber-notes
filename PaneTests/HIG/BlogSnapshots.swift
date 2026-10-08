#if os(macOS)
import AppKit
import Supabase
import SwiftUI
import SwiftData
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

    /// The sheet that sets the notes password for locked notes, with its warning that a forgotten
    /// password can't be recovered. For the post about a forgotten Apple Notes password.
    @Test func notesPasswordSheet() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let size = CGSize(width: 440, height: 480)
        let view = NotesPasswordSetupSheet(onDone: {}).frame(width: size.width, height: size.height)
        try await VersionHistorySnapshots.shoot(view, to: dir.appending(path: "mac-notes-password-light.png"), size: size, dark: false)
    }

    /// Notes drawn at about a blog card's width (352 pt, so 704 px like the other card pictures), for
    /// the covers of the newer posts. The cover is cropped from these at a clean content boundary.
    @Test func notesForCards() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        let ctx = c.mainContext
        let notes = try ctx.fetch(FetchDescriptor<Note>())
        func note(_ title: String) throws -> Note { try #require(notes.first { $0.title == title }) }
        func from(_ heading: String, in text: String, until next: String? = nil) throws -> String {
            let start = try #require(text.range(of: heading)).lowerBound
            var rest = String(text[start...])
            if let next, let end = rest.range(of: next) { rest = String(rest[..<end.lowerBound]) }
            return rest.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let lisbon = try note("Lisbon").body
        let size = CGSize(width: 352, height: 440)
        let controller = EditorController()
        func shoot(_ n: Note, _ name: String, before: () -> Void = {}) async throws {
            let view = NavigationStack { NoteDetailView(note: n, controller: controller, onNewNote: {}) }.modelContainer(c)
            let w = AIEditSnapshots.window(view, size: size)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.0))
            before()
            try? await Task.sleep(for: .seconds(1.6))
            try AIEditSnapshots.snap(w, to: dir.appending(path: "\(name).png"))
        }
        try await shoot(try note("Welcome to Pinto Notes"), "card-welcome")
        try await shoot(ctx.createNote(in: .all, body: try from("## Food", in: lisbon)), "card-lisbon-food")
        try await shoot(ctx.createNote(in: .all, body: try from("## Places", in: lisbon, until: "## Food")), "card-lisbon-places")
    }

    /// The Lisbon plan just after ChatGPT added to it: the tinted lines in the note, for the card of
    /// the post on ChatGPT memory and notes.
    @Test func chatGPTEditForCard() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Lisbon") {
            let w = AIEditSnapshots.window(AIEditSnapshots.root(c), size: CGSize(width: 1000, height: 600))
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            Capture.aiEdit(c.mainContext, title: "Lisbon", scene: "lisbon", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.6))
            try AIEditSnapshots.snap(w, to: dir.appending(path: "card-lisbon-chatgpt.png"))
        }
    }

    /// The consent sheet for an app on this computer, as Gemini CLI, Codex or VS Code see it.
    @Test func consentForCommandLine() async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        let r = ConnectRequest(id: UUID(), client_name: "", redirect_host: "an app on this computer", loopback: true, wants_write: true)
        let view = ConsentSheet(client: client, requestID: r.id, initial: .asking(r), finish: { _ in }).frame(width: 420)
        let host = NSHostingView(rootView: view.background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: .aqua)
        host.frame = CGRect(origin: .zero, size: host.fittingSize)
        host.layoutSubtreeIfNeeded()
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "card-consent-local.png"))
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
