import Foundation
import Supabase
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// Working with no network for a while, then coming back (docs/Technical/offline.md): staying
/// signed in, nothing lost or doubled when the connection drops at the worst moment, nothing
/// polling while there's no network, and everything going up the moment it's back.
@MainActor @Suite(.sealedAccount) struct OfflineTests {
    let context: ModelContext
    let path = NetworkPath()
    let engine: SyncEngine
    let defaults: UserDefaults = MemoryDefaults()

    init() throws {
        StubSupabase.reset()
        NetFault.config = .init()
        NetFault.resetLog()
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        context = ModelContext(c)
        engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: SealedAccount.user),
                            context: context, defaults: defaults, path: path)
    }

    private func syncedNote(_ body: String) async throws -> Note {
        let n = context.createNote(in: .all, body: body)
        n.dirty = true
        await engine.sync()
        #expect(!n.dirty && n.serverVersion > 0)
        return n
    }

    private func waitUntil(_ seconds: Double = 5, _ done: () -> Bool) async {
        let end = Date.now.addingTimeInterval(seconds)
        while !done(), Date.now < end { try? await Task.sleep(for: .milliseconds(20)) }
    }

    private func copies() throws -> [Note] {
        try context.fetch(FetchDescriptor<Note>()).filter { $0.body.contains("(conflicted copy)") }
    }

    private func finish() async {
        await engine.stop()
        NetFault.config = .init()
    }

    // MARK: Signed in on a plane

    /// The access token lasts an hour. Opening the app offline after that, the refresh can't reach
    /// the server: the app stays signed in with its notes, instead of showing the sign-in screen.
    @Test func anExpiredSessionStaysSignedInOffline() async throws {
        let storage = MemoryAuthStorage()
        StubSupabase.sessionLifetime = -120
        try await StubSupabase.client(storage: storage).auth.signIn(email: "qa@example.com", password: "a-long-password")
        NetFault.config = .init(offline: true)
        let backend = Backend(watching: StubSupabase.client(storage: storage))
        await waitUntil(2) { backend.state != .signedOut }
        #expect(backend.state == .signedIn(email: "qa@example.com"), "offline, the stored session keeps you signed in")
        #expect(backend.userID == SealedAccount.user)
        NetFault.config = .init()
    }

    /// The same, when the server answers and refuses the refresh token: that's a real sign-out.
    @Test func aRefreshTheServerRefusesSignsOut() async throws {
        let storage = MemoryAuthStorage()
        StubSupabase.sessionLifetime = -120
        try await StubSupabase.client(storage: storage).auth.signIn(email: "qa@example.com", password: "a-long-password")
        StubSupabase.refusesRefresh = true
        let backend = Backend(watching: StubSupabase.client(storage: storage))
        await waitUntil(2) { StubSupabase.requests.contains { $0.contains("grant_type=refresh_token") } }
        try await Task.sleep(for: .milliseconds(300))
        #expect(backend.state == .signedOut)
        #expect(backend.userID == nil)
    }

    @Test func refreshErrorsThatKeepTheSession() {
        #expect(Backend.keepsSession(afterRefreshError: URLError(.notConnectedToInternet)))
        #expect(Backend.keepsSession(afterRefreshError: URLError(.timedOut)))
        // A plane's Wi-Fi answering with its own page.
        #expect(Backend.keepsSession(afterRefreshError: DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "html"))))
        #expect(!Backend.keepsSession(afterRefreshError: AuthError.sessionMissing))
    }

    // MARK: Never lost, never doubled

    /// Both sides changed a note; yours is newer, so it goes up and theirs is kept as a conflicted
    /// copy. The connection drops right then, before or after the server took your version: the
    /// next sync must not make a second copy.
    @Test(arguments: [true, false])
    func aConnectionDroppingMidConflictMakesOneCopy(serverTookIt: Bool) async throws {
        let n = try await syncedNote("Plan")
        StubSupabase.edit(n.id, body: "Plan\n- theirs", updatedAt: .now.addingTimeInterval(-60))
        n.body = "Plan\n- mine"; n.touch()
        // The guarded update finds a newer version (no rows); the overwrite that follows drops.
        StubSupabase.loseAnswer("PATCH", "/notes", skip: 1, applied: serverTookIt)
        // Typing's own push and this sync: the first run drops, the second resolves the conflict again.
        await engine.sync()
        await engine.sync()
        #expect(StubSupabase.requests.filter { $0.hasPrefix("PATCH /rest/v1/notes") }.count >= 3, "the drop happened and was tried again")
        #expect(try copies().count == 1, "one conflicted copy, not one per try")
        #expect(try copies().first?.body.contains("- theirs") == true)
        #expect(StubSupabase.body(n.id) == "Plan\n- mine")
        #expect(!n.dirty)
        await engine.sync()
        let ids = Set(StubSupabase.rows("notes").compactMap { $0["id"] as? String })
        #expect(ids.count == 2, "the note and its one copy on the server")
        await finish()
    }

    /// A note made offline whose first push reached the server but whose answer was lost: the
    /// next push updates it instead of making another.
    @Test func aNewNoteWhoseAnswerWasLostIsNotDoubled() async throws {
        let n = context.createNote(in: .all, body: "Written on the plane")
        n.dirty = true
        StubSupabase.loseAnswer("POST", "/notes")
        await engine.sync()
        #expect(n.dirty)
        n.body = "Written on the plane, landed"; n.touch()
        await engine.sync()
        #expect(StubSupabase.rows("notes").count == 1)
        #expect(StubSupabase.body(n.id) == "Written on the plane, landed")
        await finish()
    }

    /// Hours offline: notes made, edited, deleted and restored, folders made, renamed and moved,
    /// a checklist ticked, a sub-note added; the app is quit and opened again, still offline. Back
    /// online, one sync brings the server to exactly what this device has.
    @Test func aLongOfflineSessionAcrossARestartLandsWhole() async throws {
        let groceries = try await syncedNote("Groceries\n- [ ] milk\n- [ ] eggs")
        let old = try await syncedNote("Old idea")
        NetFault.config = .init(offline: true)

        let trip = context.createFolder(named: "Trip")
        let plans = context.createFolder(named: "Plans")
        plans.name = "Plans 2026"; plans.touch()
        context.move(plans, into: trip)
        var made: [Note] = []
        for i in 0 ..< 200 { made.append(context.createNote(in: .folder(trip.id), body: "Note \(i) from the plane\n| a | b |\n|---|---|\n| \(i) | x |")) }
        groceries.body = "Groceries\n- [x] milk\n- [ ] eggs"; groceries.touch()
        context.trash(old)
        let sub = context.createNote(in: .folder(trip.id), body: "Hotel")
        sub.parentID = made[0].id
        context.trash(made[1])
        context.restore(made[1])
        try context.save()
        await engine.sync()
        #expect(engine.reach == .offline)
        #expect(AccountLibrary.hasUnsynced(context))
        await engine.stop()

        // Opened again, still offline: nothing was lost meanwhile.
        let again = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: SealedAccount.user),
                               context: context, defaults: defaults, path: path)
        await again.sync()
        #expect(AccountLibrary.hasUnsynced(context))

        NetFault.config = .init()
        NetFault.resetLog()
        let t = ContinuousClock.now
        await again.sync()
        print("PERF back online after a long offline session: \(made.count + 4) changes up in \(ContinuousClock.now - t), \(NetFault.started.count) requests")
        #expect(!AccountLibrary.hasUnsynced(context), "everything went up")
        let local = try context.fetch(FetchDescriptor<Note>())
        #expect(StubSupabase.rows("notes").count == local.count, "nothing doubled")
        #expect(StubSupabase.body(groceries.id) == "Groceries\n- [x] milk\n- [ ] eggs")
        #expect(StubSupabase.note(old.id)?["trashed_at"] is String)
        #expect(StubSupabase.note(made[1].id)?["trashed_at"] == nil || StubSupabase.note(made[1].id)?["trashed_at"] is NSNull)
        #expect((StubSupabase.note(sub.id)?["parent_id"] as? String)?.lowercased() == made[0].id.uuidString.lowercased())
        let folderRows = StubSupabase.rows("folders")
        #expect(folderRows.count == context.allFoldersIncludingDeleted().count)
        #expect(folderRows.contains { ($0["parent_id"] as? String)?.lowercased() == trip.id.uuidString.lowercased() })
        await again.stop()
        await finish()
    }

    /// While this device was offline another one edited a different note, and both edited the same
    /// note on different lines: back online, everything arrives, the shared note is merged, and
    /// nothing is a conflicted copy.
    @Test func editsOnBothDevicesWhileOfflineComeTogether() async throws {
        let shared = try await syncedNote("Packing\nPassport\nCharger")
        let theirs = try await syncedNote("Their list")
        NetFault.config = .init(offline: true)
        shared.body = "Packing\nPassport\nCharger\nHeadphones"; shared.touch()
        let mine = context.createNote(in: .all, body: "Mine, from the plane")
        await engine.sync()
        StubSupabase.edit(shared.id, body: "Packing, Friday\nPassport\nCharger", updatedAt: .now.addingTimeInterval(1))
        StubSupabase.edit(theirs.id, body: "Their list, edited", updatedAt: .now.addingTimeInterval(1))

        NetFault.config = .init()
        await engine.sync()
        #expect(shared.body == "Packing, Friday\nPassport\nCharger\nHeadphones")
        #expect(StubSupabase.body(shared.id) == shared.body)
        #expect(theirs.body == "Their list, edited")
        #expect(StubSupabase.body(mine.id) == "Mine, from the plane")
        #expect(try copies().isEmpty)
        await finish()
    }

    // MARK: The network going and coming back

    /// No network: nothing polls, however long it lasts. Back: what waited goes up at once, with
    /// no sync asked for.
    @Test func noPollingWhileTheNetworkIsDownAndSyncAtOnceWhenBack() async throws {
        let saved = SyncEngine.fallbackPoll
        SyncEngine.fallbackPoll = (.milliseconds(100), .milliseconds(100), 300)
        defer { SyncEngine.fallbackPoll = saved }
        // Started as the app starts it (no account id: start() hands the library to the account in
        // the app's own settings, which a test leaves alone).
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: context, defaults: defaults, path: path)
        let n = context.createNote(in: .all, body: "Draft")
        await engine.sync()
        // On a plane: no network, and realtime never joins.
        NetFault.config = .init(offline: true)
        path.force(down: true)
        await engine.start()
        #expect(engine.reach == .offline)
        n.body = "Draft, offline"; n.touch()
        try await Task.sleep(for: .milliseconds(100))
        NetFault.resetLog()
        try await Task.sleep(for: .milliseconds(800))
        let tried = NetFault.started.count
        print("PERF no network: \(tried) requests tried in 0.8 s idle (polling every 0.1 s when up)")
        #expect(tried == 0, "nothing polls with no network")
        #expect(n.dirty)
        // Typing offline tries nothing either, and says offline at once.
        NetFault.resetLog()
        n.body = "Draft, offline, more"; n.touch()
        try await Task.sleep(for: .milliseconds(500))
        #expect(NetFault.started.isEmpty && engine.status == .offline("Offline"))

        NetFault.config = .init()
        path.force(down: false)
        await waitUntil(2) { StubSupabase.body(n.id) == "Draft, offline, more" }
        #expect(StubSupabase.body(n.id) == "Draft, offline, more", "the network came back and the edit went up without a sync being asked for")
        await waitUntil(1) { engine.reach == .online }
        #expect(engine.reach == .online)
        await engine.stop()
        await finish()
    }

    /// The network is there but lets nothing through (a plane's Wi-Fi before you pay): that's
    /// "can't reach", not "offline", and it clears with the next sync that gets through.
    @Test func aNetworkThatLetsNothingThroughIsUnreachable() async throws {
        let n = try await syncedNote("Draft")
        // An edit waiting: the push fails first (reads would be retried for seconds by the client).
        n.body = "Draft, edited"; n.touch()
        NetFault.config = .init(timeoutAfter: 0.05)
        await engine.sync()
        #expect(engine.reach == .unreachable)
        NetFault.config = .init(offline: true)
        await engine.sync()
        #expect(engine.reach == .offline)
        NetFault.config = .init()
        await engine.sync()
        #expect(engine.reach == .online)
        await finish()
    }

    // MARK: Files

    /// A folder kept downloaded: its files come to this device after each sync, so they open on a
    /// plane. Not while there's no network; they come once it's back.
    @Test func aFolderKeptDownloadedHasItsFilesHere() async throws {
        let folder = context.createFolder(named: "Boarding passes")
        let a = try FileStore.importData(Data("Seat 14A".utf8), filename: "pass.txt", type: .plainText)
        a.folderID = folder.id
        context.insert(a)
        defer { FileStore.remove(a) }
        await engine.sync()
        #expect(a.uploaded && !a.dirty)
        // As on a device that only knows the file from the server.
        FileStore.remove(a)
        #expect(!engine.keepsDownloaded(folder.id))

        path.force(down: true)
        engine.setKeepsDownloaded(folder.id, true)
        await engine.keptFilesSettled()
        #expect(!FileStore.exists(a), "no network: nothing tried")

        path.force(down: false)
        // The sync that coming back starts (the app's engine is started; this one runs it by hand).
        await engine.sync()
        await engine.keptFilesSettled()
        #expect(try String(contentsOf: FileStore.url(for: a.id, filename: a.filename), encoding: .utf8) == "Seat 14A")
        #expect(engine.keepsDownloaded(folder.id))
        engine.setKeepsDownloaded(folder.id, false)
        #expect(!engine.keepsDownloaded(folder.id))
        await finish()
    }

    @Test func theOfflineLineSaysWhatsHappening() {
        #expect(OfflineCopy.line(.online, waiting: true) == nil)
        #expect(OfflineCopy.line(.offline, waiting: false) == "Offline")
        #expect(OfflineCopy.line(.offline, waiting: true) == "Offline \u{00B7} changes sync later")
        #expect(OfflineCopy.line(.unreachable, waiting: true) == "Can\u{2019}t reach Amber Notes \u{00B7} changes sync later")
    }
}
}
