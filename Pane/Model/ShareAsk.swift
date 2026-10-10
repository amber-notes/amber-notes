import Foundation
import Observation
import Supabase
import SwiftUI
import TipKit

/// "Enjoying Amber Notes?": after a week of use, one ask to share the app on X or LinkedIn.
///
/// The rules:
/// - notes opened or edited on at least 7 different days, not necessarily in a row, on any of the
///   account's devices: each device tells the server its days (`pane_active_days`), and the
///   ask goes by the server's count, or this device's own when that's more (or the server can't
///   be reached). How long ago the account was made doesn't matter;
/// - once per account: the first answer, on any device, is kept on the server
///   (`pane_share_ask`) and no device asks again. Until the server has answered, it doesn't ask;
/// - only at a quiet moment: the app coming back to the front, or a note closing, and never in
///   the first minute after launch, within seconds of a keystroke, while the Get set up card or
///   a tip shows. While it's up, tips wait (`PaneTips.shareAskVisible`);
/// - any answer ends it: Share on X, Share on LinkedIn, Not now, or swiping it away. Nothing is
///   gated on it and nothing is given for it, and it never asks for a rating.
///
/// Dev: `-forceShareAsk` shows it a second after launch, whatever the rules say, and sends
/// nothing to the server; `-forceShareAsk thanks` opens straight on the thank-you.
enum ShareAsk {
    /// Different days with notes opened or edited.
    static let activeDays = 7
    /// No ask this soon after launch.
    static let launchQuiet: TimeInterval = 60
    /// No ask this soon after a keystroke.
    static let typingQuiet: TimeInterval = 10

    static let site = "https://pintonotes.com"
    static let postText = "I\u{2019}ve been using Pinto Notes: a simple notes app for iPhone and Mac that ChatGPT and Claude can actually read and edit. Free."

    enum Choice: String, Sendable { case sharedX = "shared_x", sharedLinkedIn = "shared_linkedin", starredGitHub = "starred_github", dismissed }

    /// Amber Notes on GitHub: the repository, a new issue, and how to contribute.
    static let repository = URL(string: "https://github.com/pinto-notes/pinto-notes")!
    static let newIssue = URL(string: "https://github.com/pinto-notes/pinto-notes/issues/new/choose")!
    static let contributing = URL(string: "https://github.com/pinto-notes/pinto-notes/blob/main/CONTRIBUTING.md")!

    /// What the ask says, and its sharing buttons in order (Not now always follows). Developers
    /// (accounts that ever connected a tool on their computer or with a token: Claude Code,
    /// Codex, Gemini CLI, Incredible) hear that it's open source; everyone else, as before.
    struct Content: Equatable {
        var title: String
        var line: String
        var choices: [Choice]
    }

    static func content(developer: Bool) -> Content {
        developer
            ? Content(title: "Enjoying Pinto Notes?", line: "It\u{2019}s open source.", choices: [.starredGitHub, .sharedX])
            : Content(title: "Enjoying Pinto Notes?",
                      line: "I\u{2019}m building it on my own, and word of mouth is how people find it. If it\u{2019}s been useful, a post would mean a lot.",
                      choices: [.sharedX, .sharedLinkedIn])
    }

    static func buttonTitle(_ choice: Choice) -> String {
        switch choice {
        case .sharedX: "Share on X"
        case .sharedLinkedIn: "Share on LinkedIn"
        case .starredGitHub: "Star on GitHub"
        case .dismissed: "Not now"
        }
    }

    /// The thank-you's second line, for what you did.
    static func thanks(for choice: Choice?) -> String {
        choice == .starredGitHub ? "Every star helps someone find it." : "Every post helps someone find it."
    }

    static var xURL: URL {
        URL(string: "https://x.com/intent/post?text=\(encode(postText))&url=\(encode(site))")!
    }

    static var linkedInURL: URL {
        URL(string: "https://www.linkedin.com/sharing/share-offsite/?url=\(encode(site))")!
    }

    static func url(for choice: Choice) -> URL? {
        switch choice {
        case .sharedX: xURL
        case .sharedLinkedIn: linkedInURL
        case .starredGitHub: repository
        case .dismissed: nil
        }
    }

    /// Percent-encodes everything but unreserved characters, as a query value needs.
    static func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? s
    }

    /// Whether it's time to ask. `decided` is nil until the server has said (never asked then).
    static func isDue(activeDays: Int, decided: Bool?) -> Bool {
        decided == false && activeDays >= self.activeDays
    }

    // MARK: Days of use

    static let daysKey = "shareAskDays", sentKey = "shareAskDaysSent"
    /// The day last noted, and where: a fast path for every keystroke. Held weakly, so a new
    /// UserDefaults at a freed one's address (tests) is never mistaken for it.
    @MainActor private static var lastStamp: String?
    @MainActor private static weak var lastDefaults: UserDefaults?
    @MainActor static var lastKeystroke: Date = .distantPast
    /// A new day of use was noted on this device (the store sends it to the server).
    @MainActor static var onNewDay: () -> Void = {}

    /// A note was opened or edited: today counts as a day of use. Cheap enough for every keystroke.
    @MainActor static func noteUsed(typing: Bool = false, now: Date = .now, defaults: UserDefaults = .standard,
                                    calendar: Calendar = .current) {
        if typing { lastKeystroke = now }
        let today = day(now, calendar: calendar)
        guard lastStamp != today || lastDefaults !== defaults else { return }
        lastStamp = today
        lastDefaults = defaults
        var days = defaults.stringArray(forKey: daysKey) ?? []
        guard !days.contains(today) else { return }
        days.append(today)
        // Only whether there are 7 matters; a few more keep it honest across clock changes.
        defaults.set(Array(days.suffix(30)), forKey: daysKey)
        onNewDay()
    }

    /// This device's days of use, as the server takes them: "2026-09-30", in your own time zone.
    static func localDays(defaults: UserDefaults = .standard) -> [String] {
        defaults.stringArray(forKey: daysKey) ?? []
    }

    static func day(_ d: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// What the server knows about the ask for this account.
struct ShareAskState: Equatable, Decodable, Sendable {
    var decided: Bool
    /// Different days notes were used, on all the account's devices.
    var days: Int
    /// The account ever connected a developer tool (20261001120000_open_source_ask.sql). Servers
    /// from before it don't say: then it's the ask everyone gets.
    var developer: Bool = false

    init(decided: Bool, days: Int, developer: Bool = false) {
        self.decided = decided
        self.days = days
        self.developer = developer
    }

    private enum CodingKeys: String, CodingKey { case decided, days, developer }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        decided = try c.decode(Bool.self, forKey: .decided)
        days = try c.decode(Int.self, forKey: .days)
        developer = try c.decodeIfPresent(Bool.self, forKey: .developer) ?? false
    }
}

/// Where the account's answer is kept, and where the ask is counted (the server; tests swap it).
protocol ShareAskService: Sendable {
    func state() async throws -> ShareAskState
    /// Days of use from this device ("yyyy-MM-dd"); days already known change nothing.
    func addDays(_ days: [String]) async throws
    func decide(_ choice: ShareAsk.Choice) async throws
    func count(_ event: String) async
}

struct SupabaseShareAsk: ShareAskService {
    let client: SupabaseClient
    func state() async throws -> ShareAskState {
        try await client.rpc("pane_share_ask_state").execute().value
    }
    func addDays(_ days: [String]) async throws {
        try await client.rpc("pane_active_days_add", params: ["days": days]).execute()
    }
    func decide(_ choice: ShareAsk.Choice) async throws {
        try await client.rpc("pane_share_ask_decide", params: ["choice": choice.rawValue]).execute()
    }
    func count(_ event: String) async {
        _ = try? await client.rpc("pane_tip_event", params: ["tip": "shareAsk", "event": event]).execute()
    }
}

@MainActor
@Observable
final class ShareAskStore {
    /// The ask is on screen (the thank-you included).
    var visible = false
    /// You chose to share (or star): the thank-you shows.
    private(set) var thanked = false
    /// What you chose, for the thank-you's words.
    private(set) var thankedFor: ShareAsk.Choice?
    /// The developers' ask (see `ShareAsk.content`), once the server has said.
    private(set) var developer = false

    @ObservationIgnored private var service: ShareAskService?
    @ObservationIgnored private var account: UUID?
    /// nil until known: the server hasn't answered yet.
    @ObservationIgnored private(set) var decided: Bool?
    /// The account's days of use on all its devices, once the server has said.
    @ObservationIgnored private(set) var serverDays: Int?
    @ObservationIgnored let defaults: UserDefaults
    @ObservationIgnored let launched: Date
    @ObservationIgnored let forced: Bool

    init(defaults: UserDefaults = .standard, launched: Date = .now, arguments: [String] = ProcessInfo.processInfo.arguments) {
        self.defaults = defaults
        self.launched = launched
        forced = arguments.contains("-forceShareAsk")
        if forced, let i = arguments.firstIndex(of: "-forceShareAsk"), arguments.indices.contains(i + 1), arguments[i + 1] == "thanks" {
            thanked = true
        }
        // Captures of the developers' ask.
        if forced, arguments.contains("-shareAskDeveloper") {
            developer = true
            if thanked { thankedFor = .starredGitHub }
        }
        attach(account: nil, service: nil)
    }

    private var decidedKey: String { "shareAskDecided.\(account?.uuidString.lowercased() ?? "device")" }

    /// The account (or none) the ask is for. With a server, it waits for `refresh` to know.
    func attach(account: UUID?, service: ShareAskService?) {
        self.account = account
        self.service = service
        serverDays = nil
        let here = defaults.string(forKey: decidedKey) != nil
        decided = here ? true : (service == nil ? false : nil)
        if service != nil { ShareAsk.onNewDay = { [weak self] in Task { await self?.refresh() } } }
    }

    @ObservationIgnored private var refreshing: Task<Void, Never>?
    @ObservationIgnored private var refreshAgain = false

    /// Tells the server this device's days of use it hasn't had yet, and an answer this device
    /// gave while it couldn't reach it; then asks what the account adds up to. One at a time: a
    /// new day of use starts one (onNewDay) while the app may be refreshing already, and two at
    /// once would send the same days twice and could let an older answer overwrite a newer one.
    /// A refresh asked for meanwhile runs once more after the current one, and the caller waits
    /// for that.
    func refresh() async {
        guard service != nil else { return }
        if let running = refreshing {
            refreshAgain = true
            await running.value
            return
        }
        let run = Task { [weak self] in
            guard let self else { return }
            repeat {
                self.refreshAgain = false
                await self.refreshOnce()
            } while self.refreshAgain
        }
        refreshing = run
        await run.value
        refreshing = nil
    }

    private func refreshOnce() async {
        guard let service else { return }
        let sent = Set(defaults.stringArray(forKey: ShareAsk.sentKey) ?? [])
        let local = ShareAsk.localDays(defaults: defaults)
        let unsent = local.filter { !sent.contains($0) }
        if !unsent.isEmpty, (try? await service.addDays(unsent)) != nil {
            defaults.set(Array((sent.union(unsent)).sorted().suffix(30)), forKey: ShareAsk.sentKey)
        }
        let here = defaults.string(forKey: decidedKey).flatMap(ShareAsk.Choice.init)
        guard let there = try? await service.state() else { return }
        if let here, !there.decided { try? await service.decide(here) }
        decided = there.decided || here != nil
        serverDays = there.days
        developer = there.developer
    }

    /// Days of use that count: the account's on every device, or this device's own if that's
    /// more (days it hasn't managed to send yet), or all there is without a server.
    var activeDays: Int { max(serverDays ?? 0, ShareAsk.localDays(defaults: defaults).count) }

    /// Whether the rules allow asking now, leaving out what's on screen.
    func isDue(now: Date = .now) -> Bool {
        guard now.timeIntervalSince(launched) >= ShareAsk.launchQuiet,
              now.timeIntervalSince(ShareAsk.lastKeystroke) >= ShareAsk.typingQuiet else { return false }
        return ShareAsk.isDue(activeDays: activeDays, decided: decided)
    }

    /// A quiet moment: asks, if it's time and nothing else is showing.
    func moment(setupVisible: Bool, tipShowing: Bool, now: Date = .now) {
        guard !visible, !forced, !setupVisible, !tipShowing, isDue(now: now) else { return }
        show()
    }

    /// Dev: `-forceShareAsk`.
    func showIfForced() {
        if forced, !visible { show() }
    }

    private func show() {
        visible = true
        PaneTips.shareAskVisible = true
        count("shown")
    }

    /// Your answer, for good. Sharing returns the page to open and shows the thank-you.
    @discardableResult
    func choose(_ choice: ShareAsk.Choice) -> URL? {
        if !forced {
            defaults.set(choice.rawValue, forKey: decidedKey)
            decided = true
            count(choice.rawValue)
            if let service { Task { try? await service.decide(choice) } }
        }
        guard let url = ShareAsk.url(for: choice) else {
            close()
            return nil
        }
        thankedFor = choice
        withAnimation(.smooth(duration: 0.35)) { thanked = true }
        return url
    }

    /// The sheet went: swiping it away before answering counts as Not now.
    func closed() {
        if !thanked && !forced && decided != true { choose(.dismissed) }
        close()
    }

    private func close() {
        visible = false
        PaneTips.shareAskVisible = false
    }

    /// Once per event per install, like the tips.
    private func count(_ event: String) {
        guard !forced else { return }
        let key = "tipLog.shareAsk.\(event)"
        guard !defaults.bool(forKey: key) else { return }
        defaults.set(true, forKey: key)
        sent.append(event)
        if let service { Task { await service.count(event) } }
    }

    /// Tests read what would have been counted.
    @ObservationIgnored private(set) var sent: [String] = []
}

extension Notification.Name {
    /// A note closed (you went back to the list, or opened another): a quiet moment.
    static let paneNoteClosed = Notification.Name("pane.noteClosed")
}
