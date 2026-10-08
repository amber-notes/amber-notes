import Foundation
import SwiftData
import Testing
@testable import Pane

/// Answers requests for one test's own host, so suites running side by side never share answers.
final class StubSite: URLProtocol, @unchecked Sendable {
    typealias Answer = @Sendable (URLRequest) throws -> (Int, Data)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var answers: [String: Answer] = [:]
    nonisolated(unsafe) private static var seen: [String: [URLRequest]] = [:]

    /// A session whose requests to `host` get `answer`.
    static func session(host: String, answer: @escaping Answer) -> URLSession {
        lock.withLock { answers[host] = answer; seen[host] = [] }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubSite.self]
        return URLSession(configuration: config)
    }

    static func requests(_ host: String) -> [URLRequest] { lock.withLock { seen[host] ?? [] } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}
    override func startLoading() {
        let host = request.url?.host ?? ""
        var req = request
        // URLSession moves the body to a stream; read it back for the test.
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open()
            var data = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; data.append(buf, count: n) }
            stream.close()
            req.httpBody = data
        }
        let answer = Self.lock.withLock { () -> Answer? in Self.seen[host, default: []].append(req); return Self.answers[host] }
        do {
            guard let answer else { throw URLError(.cannotFindHost) }
            let (status, data) = try answer(req)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
}

private let habitJSON = """
{
  "version": 1,
  "slug": "habit-tracker",
  "title": "Habit tracker",
  "category": "Habits and health",
  "audience": "Anyone building a daily routine",
  "description": "One row a day.",
  "folder": "Habits",
  "note": "Habit tracker\\n\\n<!-- pane-table: Date=date; Walk=choice Yes|No -->\\n| Date | Walk |\\n| --- | --- |",
  "instructions": [
    { "client": "chatgpt", "name": "ChatGPT", "prompt": "In Pinto Notes, use the note 'Habit tracker'." },
    { "client": "claude", "name": "Claude", "prompt": "Claude prompt" },
    { "client": "broken" },
    { "client": "claude-code", "name": "Claude Code", "prompt": "Claude Code prompt" }
  ],
  "example": "Habit tracker\\n\\n| Date | Walk |",
  "url": "https://ambernotes.app/templates/habit-tracker",
  "somethingNew": { "nested": true }
}
"""

private let shareSlug = "AbCdEfGhIjKlMnOpQrStUvWx"

private final class NoteSourceFixtureToken {}

@MainActor
@Suite struct NoteSourceTests {
    /// The site's real template file (web/content/templates/habit-tracker.json, as served).
    nonisolated static var habitTrackerFixture: URL { Bundle(for: NoteSourceFixtureToken.self).url(forResource: "habit-tracker", withExtension: "json")! }

    @Test func decodesTheSitesRealTemplate() throws {
        let t = try JSONDecoder().decode(NoteTemplate.self, from: Data(contentsOf: Self.habitTrackerFixture))
        #expect(t.slug == "habit-tracker" && t.title == "Habit tracker" && t.folder == "Habits")
        #expect(t.instructions.map(\.client) == ["chatgpt", "claude", "claude-code"])
        #expect(NoteText.title(of: t.note) == "Habit tracker")
        #expect(NotePreview.blocks(t.note).contains { if case .table(let h, _) = $0 { h.first == "Date" } else { false } })
        // The prompt shows its words; the note's markdown rides along only in what's copied.
        let shown = PromptText.shown(t.instructions[0].prompt)
        #expect(shown.includesMarkdown && !shown.text.contains("```") && shown.text.hasPrefix("First, look for a note"))
        #expect(PromptText.shown("Just this.") == ("Just this.", false))
    }

    private func context() throws -> ModelContext {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        return ModelContext(c)
    }

    private func defaults() -> UserDefaults {
        let name = "NoteSourceTests.\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    private func source(_ host: String, answer: @escaping StubSite.Answer) -> WebNoteSource {
        WebNoteSource(site: URL(string: "https://\(host)")!, supabaseURL: URL(string: "https://\(host)")!, anonKey: "anon-key",
                      session: StubSite.session(host: host, answer: answer), timeout: 5)
    }

    // MARK: Links

    @Test func parsesAllFourLinkForms() {
        let t = NoteSourceLink.parse(URL(string: "https://ambernotes.app/open/template/habit-tracker")!)
        #expect(t == NoteSourceLink(kind: .template, slug: "habit-tracker") && t?.isValid == true)
        #expect(NoteSourceLink.parse(URL(string: "https://www.ambernotes.app/open/template/habit-tracker/")!)?.slug == "habit-tracker")
        #expect(NoteSourceLink.parse(URL(string: "ambernotes://template/habit-tracker")!) == NoteSourceLink(kind: .template, slug: "habit-tracker"))
        let c = NoteSourceLink.parse(URL(string: "https://ambernotes.app/open/copy/\(shareSlug)")!)
        #expect(c == NoteSourceLink(kind: .copy, slug: shareSlug) && c?.isValid == true)
        #expect(NoteSourceLink.parse(URL(string: "ambernotes://copy/\(shareSlug)")!) == NoteSourceLink(kind: .copy, slug: shareSlug))
    }

    @Test func badSlugsAreTakenButInvalid() {
        for s in ["https://ambernotes.app/open/template/Habit_Tracker", "ambernotes://template/", "https://ambernotes.app/open/template",
                  "ambernotes://template/-x", "ambernotes://template/" + String(repeating: "a", count: 65)] {
            let link = NoteSourceLink.parse(URL(string: s)!)
            #expect(link?.kind == .template, "\(s) is a template link")
            #expect(link?.isValid == false, "\(s) has a bad slug")
        }
        #expect(NoteSourceLink.parse(URL(string: "ambernotes://copy/short")!)?.isValid == false)
        #expect(NoteSourceLink.parse(URL(string: "ambernotes://copy/\(shareSlug)!")!)?.isValid == false)
    }

    @Test func otherLinksAreLeftAlone() {
        for s in ["https://evil.example/open/template/habit-tracker", "http://ambernotes.app/open/template/habit-tracker",
                  "https://ambernotes.app/templates/habit-tracker", "https://ambernotes.app/open/template/a/b",
                  "ambernotes://connect?request=6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55", "ambernotes://auth-callback",
                  "https://ambernotes.app/open/connect?request=6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55"] {
            #expect(NoteSourceLink.parse(URL(string: s)!) == nil, "\(s)")
        }
    }

    @Test func connectLinksStillReachTheConsentSheet() {
        let id = UUID()
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://connect?request=\(id)")!) == id)
        #expect(ConnectLink.requestID(from: URL(string: "https://ambernotes.app/open/connect?request=\(id)")!) == id)
        let center = NoteSourceCenter()
        #expect(!center.receive(URL(string: "https://ambernotes.app/open/connect?request=\(id)")!))
        #expect(center.pending == nil)
        #expect(center.receive(URL(string: "ambernotes://template/habit-tracker")!))
        #expect(center.pending?.slug == "habit-tracker")
    }

    // MARK: Fetching

    @Test func decodesATemplateTolerantly() throws {
        let t = try JSONDecoder().decode(NoteTemplate.self, from: Data(habitJSON.utf8))
        #expect(t.title == "Habit tracker" && t.folder == "Habits")
        #expect(t.instructions.map(\.client) == ["chatgpt", "claude", "claude-code"], "the broken one is left out")
        let newer = try JSONDecoder().decode(NoteTemplate.self, from: Data(#"{"version": 3, "slug": "x", "title": "X", "note": "X\n\nBody", "instructions": "not a list"}"#.utf8))
        #expect(newer.version == 3 && newer.instructions.isEmpty && newer.folder == nil)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(NoteTemplate.self, from: Data(#"{"slug": "x", "title": "X"}"#.utf8)) }
    }

    @Test func fetchesATemplateFromTheSite() async throws {
        let host = "t1.stub.test"
        let s = source(host) { req in
            #expect(req.url?.path == "/templates/habit-tracker.json")
            return (200, Data(habitJSON.utf8))
        }
        let draft = try await s.draft(for: NoteSourceLink(kind: .template, slug: "habit-tracker"))
        #expect(draft.title == "Habit tracker" && draft.folder == "Habits" && draft.instructions.count == 3)
        #expect(draft.body.hasPrefix("Habit tracker\n\n<!-- pane-table:"))
    }

    @Test func unknownTemplateIsNotFound() async {
        let s = source("t2.stub.test") { _ in (404, Data("{}".utf8)) }
        await #expect(throws: NoteSourceError.notFound(.template)) { try await s.draft(for: NoteSourceLink(kind: .template, slug: "nope")) }
    }

    @Test func garbageIsUnavailable() async {
        let s = source("t3.stub.test") { _ in (200, Data("<html>".utf8)) }
        await #expect(throws: NoteSourceError.unavailable) { try await s.draft(for: NoteSourceLink(kind: .template, slug: "habit-tracker")) }
    }

    @Test func badSlugNeverReachesTheNetwork() async {
        let host = "t4.stub.test"
        let s = source(host) { _ in (200, Data(habitJSON.utf8)) }
        await #expect(throws: NoteSourceError.badLink(.template)) { try await s.draft(for: NoteSourceLink(kind: .template, slug: "../secrets")) }
        await #expect(throws: NoteSourceError.badLink(.copy)) { try await s.draft(for: NoteSourceLink(kind: .copy, slug: "x")) }
        #expect(StubSite.requests(host).isEmpty)
    }

    @Test func offlineSaysSoAndCanRetry() async {
        let s = source("t5.stub.test") { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await s.draft(for: NoteSourceLink(kind: .template, slug: "habit-tracker"))
            Issue.record("expected offline")
        } catch {
            #expect(NoteSourceError.from(error) == .offline)
            #expect(NoteSourceError.offline.canRetry && !NoteSourceError.badLink(.template).canRetry)
        }
    }

    // MARK: Shared pages

    @Test func copiesASharedPageThroughThePublicRPC() async throws {
        let host = "c1.stub.test"
        let body = """
        Lisbon

        Four days in May.

        ![Sunset](pane-file:6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55)

        - [ ] Tram 28
        [Hotel booking](pane-note:7d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55)
        [Itinerary.pdf](pane-file:8d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55)
        """
        let s = source(host) { req in
            #expect(req.httpMethod == "POST" && req.url?.path == "/rest/v1/rpc/shared_note")
            #expect(req.value(forHTTPHeaderField: "apikey") == "anon-key")
            #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer anon-key")
            let params = try JSONSerialization.jsonObject(with: req.httpBody ?? Data()) as? [String: Any]
            #expect(params?["p_slug"] as? String == shareSlug && params?["p_sub"] is NSNull)
            return (200, try JSONSerialization.data(withJSONObject: ["title": "Lisbon", "body": body, "updated_at": "2026-09-30T10:00:00Z"]))
        }
        let draft = try await s.draft(for: NoteSourceLink(kind: .copy, slug: shareSlug))
        #expect(draft.title == "Lisbon")
        #expect(draft.leftOut == 2)
        #expect(draft.body == "Lisbon\n\nFour days in May.\n\n- [ ] Tram 28\nHotel booking")
        #expect(draft.instructions.isEmpty && draft.folder == nil)
    }

    @Test func aPageNoLongerSharedIsNotFound() async {
        let s = source("c2.stub.test") { _ in (200, Data("null".utf8)) }
        await #expect(throws: NoteSourceError.notFound(.copy)) { try await s.draft(for: NoteSourceLink(kind: .copy, slug: shareSlug)) }
    }

    @Test func sharedCopyKeepsOrdinaryLinks() {
        let (body, n) = SharedCopy.clean("Title\n\n[Site](https://example.com) and [sub](pane-note:7d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55) inline")
        #expect(n == 0)
        #expect(body == "Title\n\n[Site](https://example.com) and sub inline")
    }

    // MARK: Adding

    @Test func addsTheNoteInTheSuggestedFolderCreatingIt() async throws {
        let ctx = try context()
        let notes = ctx.createFolder(named: "Notes")
        let s = source("a1.stub.test") { _ in (200, Data(habitJSON.utf8)) }
        let model = NoteSourceModel(link: NoteSourceLink(kind: .template, slug: "habit-tracker"), source: s, ledger: NoteSourceLedger(defaults: defaults(), account: UUID()))
        await model.load(context: ctx)
        #expect(model.folder == .new("Habits"))
        model.add(context: ctx)
        guard case .added(_, let id, let folder) = model.phase, let note = ctx.note(id) else { Issue.record("not added"); return }
        #expect(folder == "Habits")
        #expect(note.folder?.name == "Habits" && note.folder?.id != notes.id)
        #expect(note.title == "Habit tracker")
        #expect(note.body.contains("<!-- pane-table: Date=date; Walk=choice Yes|No -->"))
        #expect(note.dirty, "it syncs like any new note")
    }

    @Test func usesAnExistingFolderByNameOrTheOneYouPick() throws {
        let ctx = try context()
        let habits = ctx.createFolder(named: "habits")
        let work = ctx.createFolder(named: "Work")
        var t = try JSONDecoder().decode(NoteTemplate.self, from: Data(habitJSON.utf8))
        t.folder = "Habits"
        let draft = NoteDraft(template: t, link: NoteSourceLink(kind: .template, slug: "habit-tracker"))
        #expect(ctx.suggestedFolder(for: draft) == .existing(habits.id))
        #expect(ctx.addNote(from: draft, to: .new("Habits")).folder?.id == habits.id, "no second Habits folder")
        #expect(ctx.addNote(from: draft, to: .existing(work.id)).folder?.id == work.id)
        #expect(ctx.allFolders().count == 2)
    }

    @Test func addingTheSameTemplateTwiceAsksFirst() async throws {
        let ctx = try context()
        let store = defaults()
        let account = UUID()
        let link = NoteSourceLink(kind: .template, slug: "habit-tracker")
        let s = source("d1.stub.test") { _ in (200, Data(habitJSON.utf8)) }

        let first = NoteSourceModel(link: link, source: s, ledger: NoteSourceLedger(defaults: store, account: account))
        await first.load(context: ctx)
        first.add(context: ctx)
        guard case .added(_, let firstID, _) = first.phase else { Issue.record("not added"); return }

        // Later (a relaunch: a new model, the same defaults): it asks.
        let second = NoteSourceModel(link: link, source: s, ledger: NoteSourceLedger(defaults: store, account: account))
        await second.load(context: ctx)
        second.add(context: ctx)
        #expect(second.duplicate == firstID)
        #expect(second.phase != .loading && { if case .ready = second.phase { true } else { false } }())
        second.add(context: ctx, again: true)
        guard case .added(_, let secondID, _) = second.phase else { Issue.record("not added again"); return }
        #expect(secondID != firstID)

        // Another account on this device hasn't added it.
        let other = NoteSourceModel(link: link, source: s, ledger: NoteSourceLedger(defaults: store, account: UUID()))
        await other.load(context: ctx)
        other.add(context: ctx)
        #expect(other.duplicate == nil)
    }

    @Test func aDeletedCopyDoesNotCountAsAdded() async throws {
        let ctx = try context()
        let store = defaults()
        let link = NoteSourceLink(kind: .copy, slug: shareSlug)
        let ledger = NoteSourceLedger(defaults: store, account: nil)
        let n = ctx.createNote(in: .all, body: "Lisbon")
        ledger.record(link, note: n.id)
        #expect(ledger.existing(link, in: ctx)?.id == n.id)
        n.trashedAt = .now
        #expect(ledger.existing(link, in: ctx) == nil, "in Recently Deleted: adding again doesn't ask")
    }

    @Test func badSlugShowsTheProblemWithoutLoading() async throws {
        let ctx = try context()
        let host = "b1.stub.test"
        let model = NoteSourceModel(link: NoteSourceLink(kind: .template, slug: "Not A Slug"), source: source(host) { _ in (200, Data(habitJSON.utf8)) },
                                    ledger: NoteSourceLedger(defaults: defaults(), account: nil))
        await model.load(context: ctx)
        #expect(model.phase == .failed(.badLink(.template)))
        #expect(StubSite.requests(host).isEmpty)
    }

    @Test func offlineThenTryAgain() async throws {
        let ctx = try context()
        let online = OnlineFlag()
        let s = source("o1.stub.test") { _ in
            guard online.value else { throw URLError(.notConnectedToInternet) }
            return (200, Data(habitJSON.utf8))
        }
        let model = NoteSourceModel(link: NoteSourceLink(kind: .template, slug: "habit-tracker"), source: s, ledger: NoteSourceLedger(defaults: defaults(), account: nil))
        await model.load(context: ctx)
        #expect(model.phase == .failed(.offline))
        model.add(context: ctx)
        #expect(model.phase == .failed(.offline), "nothing to add while it failed")
        online.value = true
        await model.load(context: ctx)
        #expect(model.draft?.title == "Habit tracker")
    }
}

@MainActor
@Suite struct NotePreviewTests {
    @Test func drawsTablesChecklistsAndHeadingsButNotTypeLines() {
        let blocks = NotePreview.blocks("Habit tracker\n\nOne row a day.\n\n## Habits\n- [ ] Walk\n  - [x] Read\n* Bullet\n- Dash\n1. First\n> Quote\n\n<!-- pane-table: Date=date; Walk=choice Yes|No -->\n| Date | Walk |\n| --- | --- |\n| 2026-09-30 | Yes |\n| 2026-10-01 |\n\n```\ncode | here\n```")
        #expect(blocks == [
            .title("Habit tracker"), .gap, .paragraph("One row a day."), .gap, .heading(2, "Habits"),
            .check(false, "Walk", indent: 0), .check(true, "Read", indent: 1), .bullet(dash: false, "Bullet", indent: 0), .bullet(dash: true, "Dash", indent: 0),
            .numbered("1.", "First", indent: 0), .quote("Quote"), .gap,
            .table(header: ["Date", "Walk"], rows: [["2026-09-30", "Yes"], ["2026-10-01", ""]]), .gap, .code("code | here"),
        ])
        #expect(MarkdownTableCells.cells("| a \\| b | c |") == ["a | b", "c"])
    }
}

private final class OnlineFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = false
    var value: Bool {
        get { lock.withLock { _value } }
        set { lock.withLock { _value = newValue } }
    }
}
