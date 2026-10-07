import Foundation
import Observation
import SwiftData

/// "What's new": one card after a major update, never after a small one.
///
/// The releases come from web/content/changelog.json, the file behind ambernotes.app/changelog,
/// copied into the app when it's built (it works offline). An entry marked `"major": true`
/// carries a few short `highlights` for the card. This device remembers the last version it
/// has shown you (in UserDefaults: it isn't note data, so it never syncs).
enum WhatsNew {
    /// One release, as in changelog.json.
    struct Release: Decodable, Equatable, Sendable {
        var version: String
        var date: String
        var title: String
        var items: [String]
        var major: Bool?
        var highlights: [String]?

        var isMajor: Bool { major == true }
    }

    /// What a launch does about the card.
    enum Outcome: Equatable {
        /// Already up to date here: nothing changes.
        case nothing
        /// Remember the running version, quietly (a fresh install, or no major update in between).
        case record
        /// Show this release's card, then remember the running version.
        case show(Release)
    }

    /// The last version an install from before this card had: 1.0 never stored one.
    static let before = "1.0"

    /// `lastSeen`: the version this device last showed (nil before this card existed).
    /// `existingUser`: an account or notes from an earlier version, which makes a missing
    /// `lastSeen` an update from 1.0 rather than a fresh install.
    static func outcome(lastSeen: String?, running: String, releases: [Release], existingUser: Bool) -> Outcome {
        guard let from = lastSeen ?? (existingUser ? before : nil) else { return .record }
        guard compare(from, running) == .orderedAscending else { return .nothing }
        let between = releases.filter {
            compare($0.version, from) == .orderedDescending && compare($0.version, running) != .orderedDescending
        }
        let newestMajor = between.filter(\.isMajor).max { compare($0.version, $1.version) == .orderedAscending }
        return newestMajor.map(Outcome.show) ?? .record
    }

    /// Compares dotted versions number by number ("1.1" == "1.1.0" < "1.10").
    static func compare(_ a: String, _ b: String) -> ComparisonResult {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }, y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l < r ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    /// The releases built into the app.
    static var bundled: [Release] {
        guard let url = Bundle.main.url(forResource: "changelog", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Release].self, from: data)) ?? []
    }

    static var runningVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? before
    }

    /// Someone who used an earlier version here: an account that synced on this device, or notes
    /// of their own (the welcome note a fresh install makes doesn't count).
    @MainActor
    static func existingUser(defaults: UserDefaults, context: ModelContext) -> Bool {
        if defaults.string(forKey: AccountLibrary.ownerKey) != nil { return true }
        if defaults.dictionaryRepresentation().keys.contains(where: { $0.hasPrefix("syncCursor.") }) { return true }
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        return notes.contains { $0.deletedAt == nil && $0.body != Seed.welcome && !$0.body.contains(Seed.sampleAppLine) }
    }

    /// The card's quiet button.
    enum Secondary: Equatable {
        /// Settings › Connect an AI: connections from before 1.1 have to be made again.
        case reconnect
        /// ambernotes.app/changelog.
        case changelog
    }

    static let changelogURL = URL(string: "https://ambernotes.app/changelog")!

    /// 1.1 encrypted everything, and AI connections from before it stopped working. An account
    /// whose AI has edited notes but has nothing connected now had one of those.
    static func secondary(for release: Release, progress: SetupProgress?) -> Secondary {
        guard compare(release.version, "1.1") == .orderedSame, let p = progress, p.aiEdits > 0, !p.connected else { return .changelog }
        return .reconnect
    }
}

/// The card waiting to be shown on this device, if any.
@MainActor
@Observable
final class WhatsNewStore {
    static let shared = WhatsNewStore()
    static let lastSeenKey = "whatsNew.lastSeen"

    /// The release the card is about, until you dismiss it.
    private(set) var card: WhatsNew.Release?
    /// The card is on screen: it stays until dismissed, whatever comes up after it.
    private(set) var presented = false
    /// Something else has your attention (an ask, an alert): the card waits.
    var held = false
    /// Its quiet button, fixed when it first shows so it doesn't change under you.
    private(set) var secondary: WhatsNew.Secondary = .changelog

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var running = WhatsNew.before

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var lastSeen: String? { defaults.string(forKey: Self.lastSeenKey) }

    /// At launch, before anything is drawn.
    func launch(running: String, releases: [WhatsNew.Release], existingUser: Bool) {
        self.running = running
        switch WhatsNew.outcome(lastSeen: lastSeen, running: running, releases: releases, existingUser: existingUser) {
        case .nothing: break
        case .record: defaults.set(running, forKey: Self.lastSeenKey)
        case .show(let release): card = release
        }
    }

    /// The card came on screen: it's been shown, and won't be again for this version.
    func shown(progress: SetupProgress?) {
        guard let card, !presented else { return }
        secondary = WhatsNew.secondary(for: card, progress: progress)
        presented = true
        defaults.set(running, forKey: Self.lastSeenKey)
    }

    func dismiss() {
        if card != nil { defaults.set(running, forKey: Self.lastSeenKey) }
        card = nil
        presented = false
    }

    /// Captures and snapshots: a card as if it had just come up.
    func showForPreview(_ release: WhatsNew.Release?, secondary: WhatsNew.Secondary = .changelog) {
        card = release
        self.secondary = secondary
        presented = release != nil
    }
}

/// Which page Settings shows. The Mac keeps its last tab for next time; links, cards and the
/// storage warning open Settings at a page (the card's "Reconnect your AI" opens AI).
@MainActor
@Observable
final class SettingsRoute {
    static let shared = SettingsRoute()
    static let key = "settings.tab"
    @ObservationIgnored private let defaults: UserDefaults

    /// The Mac's tab, remembered across launches.
    var tab: SettingsTab { didSet { if tab != oldValue { defaults.set(tab.rawValue, forKey: Self.key) } } }
    /// iPhone: the page to open once Settings is showing; cleared when it has.
    var target: SettingsTab?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        tab = defaults.string(forKey: Self.key).flatMap(SettingsTab.init) ?? .general
    }

    /// Settings at `tab`: the Mac's window switches to it, iPhone opens its page.
    func open(_ tab: SettingsTab) {
        self.tab = tab
        #if os(iOS)
        target = tab
        #endif
    }
}
