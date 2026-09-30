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

    func current(note: UUID) async throws -> (slug: String, includesSubNotes: Bool)? { calls.append("current"); return live }
    func share(note: UUID, includeSubNotes: Bool) async throws -> String {
        calls.append("share \(includeSubNotes)")
        if failing { throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "no such note"]) }
        let slug = live?.slug ?? nextSlug
        live = (slug, includeSubNotes)
        return slug
    }
    func unshare(note: UUID) async throws { calls.append("unshare"); live = nil; nextSlug = "BBBBBBBBBBBBBBBBBBBBBBBB" }
    func fail() { failing = true }
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
        store.requestShare()
        #expect(store.confirming == nil, "the same note isn't asked about again")
        let end = Date.now.addingTimeInterval(2)
        while store.state.slug == nil, Date.now < end { try? await Task.sleep(for: .milliseconds(20)) }
        #expect(store.state.slug != nil)

        await store.load(note: UUID(), service: FakeShareLinks())
        store.requestShare()
        #expect(store.confirming == .createLink, "another note is")
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
            ("failed", ShareLinkState(phase: .notShared, feedback: .failed("Couldn’t reach Amber Notes. Check your connection."))),
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
