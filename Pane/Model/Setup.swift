import Foundation
import Observation
import Supabase

/// The first-run "Get set up" card: bring your notes, connect your AI, try it.
///
/// Each step is a fact the server knows, so the card reads the same on every device:
/// an import finished (marked by the app), an AI connection exists (mcp_tokens), and an AI
/// has edited a note (counted on the server). The card goes for good once you hide it or
/// once your first AI edit has been celebrated.
struct SetupProgress: Equatable, Decodable {
    var imported = false
    var connected = false
    var aiEdits = 0
    var dismissed = false
    var celebrated = false

    enum CodingKeys: String, CodingKey {
        case imported, connected, dismissed, celebrated
        case aiEdits = "ai_edits"
    }

    enum Step: Int, CaseIterable { case bring = 1, connect, tryIt }

    func isDone(_ step: Step) -> Bool {
        switch step {
        case .bring: imported
        case .connect: connected
        case .tryIt: aiEdits > 0
        }
    }

    /// The first step not done yet; nil when all three are.
    var current: Step? { Step.allCases.first { !isDone($0) } }

    /// The first AI edit arrived and hasn't been celebrated yet: say "That was your AI." once.
    var celebrating: Bool { aiEdits > 0 && !celebrated && !dismissed }

    /// Shown until hidden, or until the celebration has been seen.
    var visible: Bool { !dismissed && !celebrated }

    /// "To-do" should exist while step 3 is the one to do, so the prompt works.
    var needsToDoNote: Bool { visible && connected && aiEdits == 0 }
}

/// Where the card's facts come from (the server; tests swap it).
protocol SetupService: Sendable {
    func progress() async throws -> SetupProgress
    func mark(_ step: String) async throws
}

struct SupabaseSetup: SetupService {
    let client: SupabaseClient
    func progress() async throws -> SetupProgress {
        try await client.rpc("pane_setup_state").execute().value
    }
    func mark(_ step: String) async throws {
        try await client.rpc("pane_setup_mark", params: ["step": step]).execute()
    }
}

@MainActor
@Observable
final class SetupStore {
    private(set) var progress: SetupProgress?
    /// Shown for a moment after the first AI edit lands.
    private(set) var showingCelebration = false
    @ObservationIgnored private var service: SetupService?
    @ObservationIgnored private var account: UUID?
    @ObservationIgnored private var celebrationTask: Task<Void, Never>?

    init(service: SetupService? = nil, progress: SetupProgress? = nil) {
        self.service = service
        self.progress = progress
    }

    /// The card is only for signed-in accounts, and only once the server has answered.
    var visible: Bool { (progress?.visible ?? false) || showingCelebration }

    /// A new account (or none) resets everything.
    func attach(account: UUID?, service: SetupService?) {
        guard account != self.account else { return }
        self.account = account
        self.service = service
        progress = nil
        showingCelebration = false
        celebrationTask?.cancel()
    }

    @ObservationIgnored private var lastRefresh: Date = .distantPast

    /// Asks the server again: at most every few seconds (syncs happen often while typing), and
    /// not at all once the card is gone for good.
    func refresh(force: Bool = false) async {
        guard let service else { return }
        if let p = progress, !p.visible, !showingCelebration { return }
        guard force || Date.now.timeIntervalSince(lastRefresh) > 4 else { return }
        lastRefresh = .now
        guard let fresh = try? await service.progress() else { return }
        apply(fresh)
    }

    func apply(_ fresh: SetupProgress) {
        progress = fresh
        if fresh.celebrating && !showingCelebration { celebrate() }
    }

    func mark(_ step: String) async {
        switch step {
        case "imported": progress?.imported = true
        case "dismissed": progress?.dismissed = true
        case "celebrated": progress?.celebrated = true
        default: return
        }
        try? await service?.mark(step)
    }

    /// "That was your AI." stays a few seconds, then the card goes and doesn't come back.
    private func celebrate() {
        showingCelebration = true
        celebrationTask?.cancel()
        celebrationTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, let self else { return }
            await self.mark("celebrated")
            self.showingCelebration = false
        }
    }
}

extension Notification.Name {
    /// Notes arrived from outside: an Apple Notes import, or items shared into the app.
    static let paneNotesBrought = Notification.Name("pane.notesBrought")
}

/// A random id for this install, used only to count how many devices an account uses.
/// It isn't a device identifier and says nothing about the device.
enum InstallID {
    private static let key = "paneInstallID"

    static var value: UUID {
        if let s = UserDefaults.standard.string(forKey: key), let id = UUID(uuidString: s) { return id }
        let id = UUID()
        UserDefaults.standard.set(id.uuidString, forKey: key)
        return id
    }

    static var platform: String {
        #if os(iOS)
        "ios"
        #else
        "macos"
        #endif
    }

    /// Once per launch, after sign-in.
    static func report(_ client: SupabaseClient) async {
        _ = try? await client.rpc("pane_seen_device", params: ["device": value.uuidString.lowercased(), "platform": platform]).execute()
    }
}
