import Foundation
import Observation
import Supabase
import SwiftUI
import TipKit

/// "Enjoying Amber Notes?": after a week of use, one ask to share the app on X or LinkedIn.
///
/// The rules:
/// - at least 7 days since the account was made (or, with no account, since this device first
///   ran this version), and notes opened or edited on at least 3 different days (this device);
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
    static let days = 7
    static let activeDays = 3
    /// No ask this soon after launch.
    static let launchQuiet: TimeInterval = 60
    /// No ask this soon after a keystroke.
    static let typingQuiet: TimeInterval = 10

    static let site = "https://ambernotes.app"
    static let postText = "I\u{2019}ve been using Amber Notes: a simple notes app for iPhone and Mac that ChatGPT and Claude can actually read and edit. Free."

    enum Choice: String, Sendable { case sharedX = "shared_x", sharedLinkedIn = "shared_linkedin", dismissed }

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
        case .dismissed: nil
        }
    }

    /// Percent-encodes everything but unreserved characters, as a query value needs.
    static func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? s
    }

    /// Whether it's time to ask. `decided` is nil until the server has said (never asked then).
    static func isDue(firstUse: Date?, activeDays: Int, decided: Bool?, now: Date = .now) -> Bool {
        guard decided == false, let firstUse else { return false }
        return now.timeIntervalSince(firstUse) >= Double(days) * 86400 && activeDays >= self.activeDays
    }

    // MARK: Days of use (this device)

    static let daysKey = "shareAskDays", firstUseKey = "shareAskFirstUse"
    @MainActor private static var lastStamp: String?
    @MainActor static var lastKeystroke: Date = .distantPast

    /// A note was opened or edited: today counts as a day of use. Cheap enough for every keystroke.
    @MainActor static func noteUsed(typing: Bool = false, now: Date = .now, defaults: UserDefaults = .standard) {
        if typing { lastKeystroke = now }
        let stamp = "\(ObjectIdentifier(defaults)) \(PaneTips.dayStamp(now))"
        guard lastStamp != stamp else { return }
        lastStamp = stamp
        let today = PaneTips.dayStamp(now)
        var days = defaults.stringArray(forKey: daysKey) ?? []
        guard !days.contains(today) else { return }
        days.append(today)
        // Only whether there are 3 matters; a few more keep it honest across clock changes.
        defaults.set(Array(days.suffix(10)), forKey: daysKey)
    }

    static func activeDayCount(defaults: UserDefaults = .standard) -> Int {
        (defaults.stringArray(forKey: daysKey) ?? []).count
    }

    /// When this device first ran with the ask in it: the start of the week without an account.
    static func localFirstUse(now: Date = .now, defaults: UserDefaults = .standard) -> Date {
        if let d = defaults.object(forKey: firstUseKey) as? Date { return d }
        defaults.set(now, forKey: firstUseKey)
        return now
    }
}

/// Where the account's answer is kept, and where the ask is counted (the server; tests swap it).
protocol ShareAskService: Sendable {
    func decided() async throws -> Bool
    func decide(_ choice: ShareAsk.Choice) async throws
    func count(_ event: String) async
}

struct SupabaseShareAsk: ShareAskService {
    let client: SupabaseClient
    func decided() async throws -> Bool {
        try await client.rpc("pane_share_ask_decided").execute().value
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
    /// You chose to share: the thank-you shows.
    private(set) var thanked = false

    @ObservationIgnored private var service: ShareAskService?
    @ObservationIgnored private var account: UUID?
    @ObservationIgnored private var accountCreated: Date?
    /// nil until known: the server hasn't answered yet.
    @ObservationIgnored private(set) var decided: Bool?
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
        attach(account: nil, created: nil, service: nil)
    }

    private var decidedKey: String { "shareAskDecided.\(account?.uuidString.lowercased() ?? "device")" }

    /// The account (or none) the ask is for. With a server, it waits for `refresh` to know.
    func attach(account: UUID?, created: Date?, service: ShareAskService?) {
        self.account = account
        self.accountCreated = created
        self.service = service
        let here = defaults.string(forKey: decidedKey) != nil
        decided = here ? true : (service == nil ? false : nil)
    }

    /// Asks the server whether this account has answered, and tells it an answer this device
    /// gave while it couldn't reach it.
    func refresh() async {
        guard let service else { return }
        let here = defaults.string(forKey: decidedKey).flatMap(ShareAsk.Choice.init)
        guard let there = try? await service.decided() else { return }
        if let here, !there { try? await service.decide(here) }
        decided = there || here != nil
    }

    var firstUse: Date? { accountCreated ?? ShareAsk.localFirstUse(defaults: defaults) }

    /// Whether the rules allow asking now, leaving out what's on screen.
    func isDue(now: Date = .now) -> Bool {
        guard now.timeIntervalSince(launched) >= ShareAsk.launchQuiet,
              now.timeIntervalSince(ShareAsk.lastKeystroke) >= ShareAsk.typingQuiet else { return false }
        return ShareAsk.isDue(firstUse: firstUse, activeDays: ShareAsk.activeDayCount(defaults: defaults), decided: decided, now: now)
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
