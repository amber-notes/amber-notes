import Foundation
import SwiftUI
import Testing
@testable import Pane

/// Stands in for Supabase: records calls, can be told to fail.
private actor FakeShareLinks: ShareLinkService {
    var live: (slug: String, includesSubNotes: Bool)?
    var calls: [String] = []
    var failing = false
    var nextSlug = "AAAAAAAAAAAAAAAAAAAAAAAA"

    func current(note: UUID) async throws -> (slug: String, includesSubNotes: Bool)? {
        calls.append("current")
        if let lookupError { throw lookupError }
        return live
    }
    func share(note: UUID, includeSubNotes: Bool) async throws -> String {
        calls.append("share \(includeSubNotes)")
        if failing { throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "no such note"]) }
        let slug = live?.slug ?? nextSlug
        live = (slug, includeSubNotes)
        return slug
    }
    func unshare(note: UUID) async throws { calls.append("unshare"); live = nil; nextSlug = "BBBBBBBBBBBBBBBBBBBBBBBB" }
    func fail() { failing = true }
    /// The next lookups fail this way (a dropped connection, a cancelled request).
    var lookupError: (any Error)?
    func failLookups(_ error: (any Error)?) { lookupError = error }
    func seed(_ slug: String, _ subs: Bool) { live = (slug, subs) }
}

@MainActor
@Suite struct ShareLinkTests {
    @Test func stateStepsThroughPressWorkingDone() {
        var s = ShareLinkState()
        #expect(s.slug == nil && !s.isWorking)
        s.begin("Creating link…")
        #expect(s.isWorking)
        s.shared(slug: "abc", includesSubNotes: false, copied: true)
        #expect(s.slug == "abc")
        #expect(s.feedback == .done("Link created and copied"))
        s.shared(slug: "abc", includesSubNotes: false, copied: true)
        #expect(s.feedback == .done("Link copied"), "a second copy says just copied")
        s.shared(slug: "abc", includesSubNotes: true, copied: false)
        #expect(s.includesSubNotes && s.feedback == .done("Sub-notes included"))
        s.stopped()
        #expect(s.phase == .notShared && s.feedback == .done("Sharing stopped"))
        s.failed("x")
        #expect(s.feedback == .failed("x"))
    }

    @Test func shareCopiesTheLinkAndStopMakesItGone() async {
        let fake = FakeShareLinks()
        let store = ShareLinkStore()
        var copied: [URL?] = []
        store.copyURL = { copied.append($0) }
        store.baseURL = URL(string: "https://ambernotes.app")
        let note = UUID()
        await store.load(note: note, service: fake)
        #expect(store.state.phase == .notShared)

        await store.shareAndCopy()
        #expect(store.state.slug == "AAAAAAAAAAAAAAAAAAAAAAAA")
        #expect(copied.count == 1)
        #expect(copied.first??.absoluteString.hasSuffix("/n/AAAAAAAAAAAAAAAAAAAAAAAA") == true)

        await store.setIncludesSubNotes(true)
        #expect(store.state.includesSubNotes)
        #expect(copied.count == 1, "changing the option doesn't copy")

        await store.stopSharing()
        #expect(store.state.phase == .notShared)
        await store.shareAndCopy()
        #expect(store.state.slug == "BBBBBBBBBBBBBBBBBBBBBBBB", "sharing again makes a new link")
        #expect(await fake.calls == ["current", "share false", "share true", "unshare", "share false"])
    }

    @Test func loadsAnExistingLinkAndReportsFailures() async {
        let fake = FakeShareLinks()
        await fake.seed("CCCCCCCCCCCCCCCCCCCCCCCC", true)
        let store = ShareLinkStore()
        store.copyURL = { _ in }
        await store.load(note: UUID(), service: fake)
        #expect(store.state.phase == .shared(slug: "CCCCCCCCCCCCCCCCCCCCCCCC", includesSubNotes: true))

        await fake.fail()
        await store.setIncludesSubNotes(false)
        #expect(store.state.feedback == .failed("Couldn’t share yet. Try again once the note has synced."))
        #expect(store.state.includesSubNotes, "a failed change keeps the old option")
    }

    /// Sharing publishes a readable copy: you're told once per note, before its first link.
    @Test func asksOncePerNoteBeforeSharing() async {
        let fake = FakeShareLinks()
        let store = ShareLinkStore()
        store.copyURL = { _ in }
        store.markUsed = { _ in }
        store.defaults = MemoryDefaults()
        store.baseURL = URL(string: "https://ambernotes.app")
        let note = UUID()
        await store.load(note: note, service: fake)
        store.requestShare()
        #expect(store.confirming == .createLink)
        #expect(await fake.calls == ["current"], "nothing is shared before you answer")
        store.confirming = nil
        await store.confirmedShare()
        #expect(store.state.slug != nil)
        await store.stopSharing()
        let sharing = store.requestShare()
        #expect(store.confirming == nil, "the same note isn't asked about again")
        // Waits for the sharing itself, not a time window: on a busy machine it can take longer.
        await sharing?.value
        #expect(sharing != nil && store.state.slug != nil)

        await store.load(note: UUID(), service: FakeShareLinks())
        store.requestShare()
        #expect(store.confirming == .createLink, "another note is")
    }

    @Test func askingAgainSharesAtOnceAndCanBeAwaited() async {
        // The share runs on the main actor, which other tests can keep busy for seconds: callers
        // wait for the share itself, never a time window.
        let fake = FakeShareLinks()
        let store = ShareLinkStore()
        store.copyURL = { _ in }
        store.markUsed = { _ in }
        store.defaults = MemoryDefaults()
        store.baseURL = URL(string: "https://ambernotes.app")
        let note = UUID()
        await store.load(note: note, service: fake)
        store.defaults.set(true, forKey: ShareLinkStore.askedKey(note))
        let sharing = store.requestShare()
        #expect(sharing != nil && store.confirming == nil)
        await sharing?.value
        #expect(store.state.slug == "AAAAAAAAAAAAAAAAAAAAAAAA")
    }

    @Test func sharingMarksTheFeatureUsedOnce() async {
        var used: [Feature] = []
        let store = ShareLinkStore()
        store.copyURL = { _ in }
        store.markUsed = { used.append($0) }
        store.defaults = MemoryDefaults()
        store.baseURL = URL(string: "https://ambernotes.app")
        await store.load(note: UUID(), service: FakeShareLinks())
        await store.shareAndCopy()
        #expect(used == [.shareLink])
    }

    /// The warning before sharing names the site the link is on, as the link says it.
    @Test func theWarningNamesTheSiteTheLinkIsOn() {
        #expect(ShareLinkConfig.siteName(URL(string: "https://pintonotes.com")) == "pintonotes.com")
        #expect(ShareLinkConfig.siteName(URL(string: "https://www.PintoNotes.com/")) == "pintonotes.com")
        #expect(ShareLinkConfig.siteName(URL(string: "https://ambernotes.app")) == "ambernotes.app")
        #expect(ShareLinkConfig.siteName(nil) == "pintonotes.com")
    }

    /// A link made on another device: the note's one lookup failed or was cancelled as it opened.
    /// That isn't kept as "not shared": the next look asks again, and the note shows Shared with
    /// Copy Link and Stop Sharing, which stops that same link.
    @Test func aLinkFromAnotherDeviceShowsAfterAFailedFirstLookup() async {
        for error in [CancellationError() as any Error, URLError(.networkConnectionLost)] {
            let fake = FakeShareLinks()
            await fake.seed("CCCCCCCCCCCCCCCCCCCCCCCC", false)
            await fake.failLookups(error)
            let store = ShareLinkStore()
            store.baseURL = URL(string: "https://pintonotes.com")
            let note = UUID()
            await store.load(note: note, service: fake)
            #expect(store.state.slug == nil, "nothing known yet: Share Link is offered")
            await fake.failLookups(nil)
            // The view asks again for the same note (it appeared again).
            await store.load(note: note, service: fake)
            #expect(store.state.phase == .shared(slug: "CCCCCCCCCCCCCCCCCCCCCCCC", includesSubNotes: false))
            #expect(store.url?.absoluteString == "https://pintonotes.com/n/CCCCCCCCCCCCCCCCCCCCCCCC", "the address is rebuilt from the slug")
            // Answered: it isn't asked a third time.
            await store.load(note: note, service: fake)
            #expect(await fake.calls == ["current", "current"])
            await store.stopSharing()
            #expect(store.state.phase == .notShared)
            #expect(await fake.calls == ["current", "current", "unshare"])
        }
    }

    /// The account's list of live links (every sync) and the open note disagree: the note asks again.
    @Test func theNoteFollowsTheAccountsLiveLinks() async {
        let fake = FakeShareLinks()
        let store = ShareLinkStore()
        let note = UUID()
        await store.load(note: note, service: fake)
        #expect(store.state.phase == .notShared && !ShareLinkStore.disagrees(listed: false, state: store.state))
        // Shared on another device: the list learns it at the next sync.
        await fake.seed("DDDDDDDDDDDDDDDDDDDDDDDD", true)
        #expect(ShareLinkStore.disagrees(listed: true, state: store.state))
        await store.load(note: note, service: fake, again: true)
        #expect(store.state.phase == .shared(slug: "DDDDDDDDDDDDDDDDDDDDDDDD", includesSubNotes: true))
        #expect(!ShareLinkStore.disagrees(listed: true, state: store.state))
        // Stopped on another device.
        try? await fake.unshare(note: note)
        #expect(ShareLinkStore.disagrees(listed: false, state: store.state))
        await store.load(note: note, service: fake, again: true)
        #expect(store.state.phase == .notShared)
        // Not while this device is in the middle of sharing or stopping.
        var working = ShareLinkState()
        working.begin("Creating link…")
        #expect(!ShareLinkStore.disagrees(listed: true, state: working))
    }

    @Test func productionNeverHandsOutALocalLink() {
        let local = URL(string: "http://localhost:5210")!, site = URL(string: "https://ambernotes.app")!
        #expect(ShareLinkConfig.usable(local, backend: URL(string: "http://127.0.0.1:56421")))
        #expect(!ShareLinkConfig.usable(local, backend: URL(string: "https://x.supabase.co")))
        #expect(ShareLinkConfig.usable(site, backend: URL(string: "https://x.supabase.co")))
        #expect(!ShareLinkConfig.usable(URL(string: "$(PANE_SHARE_URL)") ?? local, backend: URL(string: "https://x.supabase.co")))
    }

    @Test func withoutAnAccountThereIsNoMenu() async {
        let store = ShareLinkStore()
        await store.load(note: UUID(), service: nil)
        #expect(!store.isAvailable)
        #expect(store.state.phase == .unknown)
    }
}

#if os(macOS)
import AppKit

/// Renders the shared indicator and each feedback step offscreen, light and dark, when PANE_SNAPSHOT_DIR is set.
@MainActor
@Suite struct ShareLinkSnapshotTests {
    @Test func chrome() throws {
        guard let dir = ProcessInfo.processInfo.environment["PANE_SNAPSHOT_DIR"] else { return }
        let note = Note(body: "Lisbon trip\n\nEverything for the long weekend.")
        let states: [(String, ShareLinkState)] = [
            ("shared", ShareLinkState(phase: .shared(slug: "AAAAAAAAAAAAAAAAAAAAAAAA", includesSubNotes: false))),
            ("working", ShareLinkState(phase: .notShared, feedback: .working("Creating link…"))),
            ("done", ShareLinkState(phase: .shared(slug: "AAAAAAAAAAAAAAAAAAAAAAAA", includesSubNotes: false), feedback: .done("Link created and copied"))),
            ("failed", ShareLinkState(phase: .notShared, feedback: .failed("Couldn’t reach Pinto Notes. Check your connection."))),
        ]
        for (name, state) in states {
            for dark in [false, true] {
                let store = ShareLinkStore(state: state, noteID: note.id)
                let page = VStack(alignment: .leading, spacing: 8) {
                    Text("Lisbon trip").font(.system(size: 20, weight: .bold))
                    Text("Everything for the long weekend.")
                    Spacer()
                }
                .padding(20)
                .frame(width: 520, height: 160, alignment: .topLeading)
                .background(Color.notePage)
                .shareLinkChrome(store, note: note)
                let host = NSHostingView(rootView: page)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                host.frame = CGRect(x: 0, y: 0, width: 520, height: 160)
                host.layoutSubtreeIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.1))
                let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.cacheDisplay(in: host.bounds, to: rep)
                let png = try #require(rep.representation(using: .png, properties: [:]))
                try png.write(to: URL(fileURLWithPath: dir).appending(path: "share-\(name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
}
#endif
