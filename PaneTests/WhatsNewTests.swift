import Foundation
import SwiftData
import Testing
@testable import Pane

/// "What's new": shown once after a major update, never after a small one or a fresh install.
@MainActor @Suite struct WhatsNewTests {
    typealias Release = WhatsNew.Release

    static func release(_ version: String, major: Bool = false) -> Release {
        Release(version: version, date: "2026-10-01", title: "Release \(version)", items: ["Something"],
                major: major ? true : nil, highlights: major ? ["One", "Two", "Three"] : nil)
    }

    /// Newest first, as in changelog.json.
    static let releases = [
        release("1.3"), release("1.2.1"), release("1.2", major: true), release("1.1.1"), release("1.1", major: true), release("1.0"),
    ]

    @Test func freshInstallRemembersTheVersionAndShowsNothing() {
        let defaults = TestDefaults()
        let store = WhatsNewStore(defaults: defaults)
        store.launch(running: "1.1", releases: Self.releases, existingUser: false)
        #expect(store.card == nil)
        #expect(store.lastSeen == "1.1")
        // The next major update still shows.
        let later = WhatsNewStore(defaults: defaults)
        later.launch(running: "1.2", releases: Self.releases, existingUser: true)
        #expect(later.card?.version == "1.2")
    }

    @Test func anUpdateWithNoMajorReleaseIsQuiet() {
        #expect(WhatsNew.outcome(lastSeen: "1.1", running: "1.1.1", releases: Self.releases, existingUser: true) == .record)
        let defaults = TestDefaults()
        defaults.set("1.2", forKey: WhatsNewStore.lastSeenKey)
        let store = WhatsNewStore(defaults: defaults)
        store.launch(running: "1.3", releases: Self.releases, existingUser: true)
        #expect(store.card == nil)
        #expect(store.lastSeen == "1.3")
    }

    @Test func skippingVersionsShowsTheNewestMajorInBetween() {
        // 1.1 → 1.3 crosses 1.2 (major) and 1.2.1: one card, for 1.2.
        #expect(WhatsNew.outcome(lastSeen: "1.1", running: "1.3", releases: Self.releases, existingUser: true) == .show(Self.release("1.2", major: true)))
        // 1.0 → 1.2.1 crosses two majors: only the newest.
        #expect(WhatsNew.outcome(lastSeen: "1.0", running: "1.2.1", releases: Self.releases, existingUser: true) == .show(Self.release("1.2", major: true)))
    }

    @Test func theRunningVersionsOwnMajorCounts() {
        #expect(WhatsNew.outcome(lastSeen: "1.1.1", running: "1.2", releases: Self.releases, existingUser: true) == .show(Self.release("1.2", major: true)))
    }

    @Test func sameOrOlderVersionChangesNothing() {
        #expect(WhatsNew.outcome(lastSeen: "1.2", running: "1.2", releases: Self.releases, existingUser: true) == .nothing)
        #expect(WhatsNew.outcome(lastSeen: "1.2.0", running: "1.2", releases: Self.releases, existingUser: true) == .nothing)
        #expect(WhatsNew.outcome(lastSeen: "1.3", running: "1.2", releases: Self.releases, existingUser: true) == .nothing)
    }

    @Test func comingFrom1_0WithNothingStoredIsAnUpdate() {
        let store = WhatsNewStore(defaults: TestDefaults())
        store.launch(running: "1.1", releases: Self.releases, existingUser: true)
        #expect(store.card?.version == "1.1")
        #expect(store.lastSeen == nil, "remembered once it's on screen, not before")
    }

    @Test func showsOnlyOnce() {
        let defaults = TestDefaults()
        let store = WhatsNewStore(defaults: defaults)
        store.launch(running: "1.1", releases: Self.releases, existingUser: true)
        store.shown(progress: nil)
        #expect(store.lastSeen == "1.1")
        // Quit without pressing anything: it was shown, so it doesn't come back.
        let relaunch = WhatsNewStore(defaults: defaults)
        relaunch.launch(running: "1.1", releases: Self.releases, existingUser: true)
        #expect(relaunch.card == nil)
        store.dismiss()
        #expect(store.card == nil)
    }

    @Test func waitsAcrossLaunchesUntilItHasBeenOnScreen() {
        let defaults = TestDefaults()
        WhatsNewStore(defaults: defaults).launch(running: "1.1", releases: Self.releases, existingUser: true)
        let next = WhatsNewStore(defaults: defaults)
        next.launch(running: "1.1", releases: Self.releases, existingUser: true)
        #expect(next.card?.version == "1.1")
    }

    @Test func versionsCompareNumberByNumber() {
        #expect(WhatsNew.compare("1.1", "1.1.0") == .orderedSame)
        #expect(WhatsNew.compare("1.9", "1.10") == .orderedAscending)
        #expect(WhatsNew.compare("2.0", "1.10.3") == .orderedDescending)
    }

    @Test func reconnectOnlyFor1_1WithAnAIFromBefore() {
        let v11 = Self.release("1.1", major: true), v12 = Self.release("1.2", major: true)
        let usedAI = SetupProgress(imported: true, connected: false, aiEdits: 4)
        #expect(WhatsNew.secondary(for: v11, progress: usedAI) == .reconnect)
        #expect(WhatsNew.secondary(for: v11, progress: SetupProgress(imported: true, connected: true, aiEdits: 4)) == .changelog, "already connected again")
        #expect(WhatsNew.secondary(for: v11, progress: SetupProgress(imported: true)) == .changelog, "never used an AI")
        #expect(WhatsNew.secondary(for: v11, progress: nil) == .changelog)
        #expect(WhatsNew.secondary(for: v12, progress: usedAI) == .changelog)
    }

    @Test func anAccountOrOwnNotesMeanAnEarlierVersionWasUsed() throws {
        let container = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = container.mainContext
        // A fresh install: only the welcome note.
        Seed.ensureLibrary(context, demo: false)
        #expect(!WhatsNew.existingUser(defaults: TestDefaults(), context: context))
        let signedIn = TestDefaults()
        signedIn.set(UUID().uuidString.lowercased(), forKey: AccountLibrary.ownerKey)
        #expect(WhatsNew.existingUser(defaults: signedIn, context: context))
        let synced = TestDefaults()
        synced.set(Date.now, forKey: "syncCursor.\(UUID().uuidString)")
        #expect(WhatsNew.existingUser(defaults: synced, context: context))
        _ = context.createNote(in: .all, body: "Groceries\n\nMilk")
        #expect(WhatsNew.existingUser(defaults: TestDefaults(), context: context))
    }

    @Test func theBuiltInChangelogMarks1_1Major() throws {
        let v11 = try #require(WhatsNew.bundled.first { $0.version == "1.1" })
        #expect(v11.isMajor)
        #expect(v11.highlights?.count == 4)
        #expect(!v11.items.isEmpty)
    }
}
