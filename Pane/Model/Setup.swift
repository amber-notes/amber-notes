import Foundation
import SwiftUI
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

    /// Every step is done and it hasn't been celebrated yet: "You're all set", once.
    var celebrating: Bool { current == nil && !celebrated && !dismissed }

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
        if let p = progress, p.celebrating, !showingCelebration { celebrate() }
        try? await service?.mark(step)
    }

    /// Help › Show Setup Guide: back to step 1, here and on the server. Whether an AI is connected
    /// and has edited a note are facts, so those steps tick themselves as you go.
    func reset() async {
        celebrationTask?.cancel()
        showingCelebration = false
        guard var p = progress else { return }
        p.imported = false
        p.dismissed = false
        p.celebrated = false
        withAnimation(.smooth(duration: 0.35)) { progress = p }
        try? await service?.mark("reset")
    }

    /// "You're all set" draws itself, holds a moment, then the card folds away for good and the
    /// list moves up.
    private func celebrate() {
        showingCelebration = true
        celebrationTask?.cancel()
        celebrationTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.celebration))
            guard !Task.isCancelled, let self else { return }
            withAnimation(.smooth(duration: 0.45)) {
                self.progress?.celebrated = true
                self.showingCelebration = false
            }
            await self.mark("celebrated")
        }
    }

    /// The check draws in about 0.8 s, then holds about 2.5 s.
    nonisolated(unsafe) static var celebration: Double = 3.3
}

extension Notification.Name {
    /// Notes arrived from outside: an Apple Notes import, or items shared into the app.
    static let paneNotesBrought = Notification.Name("pane.notesBrought")
    /// Help › Show Setup Guide (Settings on iPhone): the setup card back at step 1.
    static let paneShowSetupGuide = Notification.Name("pane.showSetupGuide")
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
