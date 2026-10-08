import Foundation
import Supabase
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// Signing in as another account on the same device: nothing of the previous account's goes up
/// into the new one, and a library left polluted by the old switch (before 2026-10-08) cleans itself.
@MainActor @Suite(.sealedAccount) struct AccountSwitchTests {
    let context: ModelContext
    let defaults = MemoryDefaults()
    let a = UUID(), b = UUID()

    init() throws {
        StubSupabase.reset()
        NetFault.config = .init()
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        context = ModelContext(c)
    }

    private func engine(_ user: UUID) -> SyncEngine {
        SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: user), context: context, defaults: defaults, path: NetworkPath())
    }

    private var folderWrites: Int { StubSupabase.requests.filter { $0.hasPrefix("POST /rest/v1/folders") || $0.hasPrefix("PATCH /rest/v1/folders") }.count }

    @Test func switchingAccountsPushesNothingOfThePreviousOne() async throws {
        AccountLibrary.adopt(a, context: context, defaults: defaults)
        let first = engine(a)
        for i in 0..<30 {
            let f = context.createFolder(named: "Folder \(i)")
            _ = context.createFolder(named: "Folder \(i) inside", parent: f)
            // Library's trash: to Recently Deleted, with what's inside.
            if i % 2 == 0 { context.trash(f) }
        }
        context.createNote(in: .all, body: "A's note")
        await first.sync()
        #expect(!AccountLibrary.hasUnsynced(context))
        await first.stop()

        // B signs in on the same device (Backend.willSignIn). The server shows B only B's rows
        // (row-level security, which the stub doesn't have): here, none.
        #expect(AccountLibrary.adopt(b, context: context, defaults: defaults))
        // B has been on this device before (as the gate's accounts have): its one-time encryption
        // reset, which would also clear synced rows, is long done.
        defaults.set(true, forKey: SyncEngine.resetKey(b))
        StubSupabase.reset()
        let second = engine(b)
        await second.sync()
        #expect(folderWrites == 0, "none of A's folders went up into B")
        #expect(context.allFoldersIncludingDeleted().isEmpty)
        #expect(try context.fetch(FetchDescriptor<Note>()).isEmpty)
        await second.stop()
    }

    /// A, then B, then A again on the same device, with the server's row-level security. Before the
    /// fix, A's folders stayed here as deleted tombstones: B pushed them (refused), and back as A
    /// they went up and deleted A's whole folder tree on the server.
    @Test func anotherAccountAndBackLeavesTheFirstAccountsFoldersAlone() async throws {
        // Both have been on this device before: their one-time encryption resets are done.
        defaults.set(true, forKey: SyncEngine.resetKey(a))
        defaults.set(true, forKey: SyncEngine.resetKey(b))
        StubSupabase.account = a
        AccountLibrary.adopt(a, context: context, defaults: defaults)
        let trip = context.createFolder(named: "Trip")
        let days = context.createFolder(named: "Days", parent: trip)
        let work = context.createFolder(named: "Work")
        context.createNote(in: .folder(days.id), body: "Day one")
        context.createNote(in: .folder(work.id), body: "Plan")
        let first = engine(a)
        await first.sync()
        await first.stop()
        let aFolders = Set([trip.id, days.id, work.id].map { $0.uuidString.lowercased() })
        #expect(Set(StubSupabase.rows("folders").compactMap { $0["id"] as? String }) == aFolders)

        // B.
        #expect(AccountLibrary.adopt(b, context: context, defaults: defaults))
        StubSupabase.account = b
        StubSupabase.resetLog()
        let second = engine(b)
        await second.sync()
        await second.stop()
        let sentAsB = StubSupabase.bodies.joined().lowercased()
        #expect(aFolders.allSatisfy { !sentAsB.contains($0) }, "none of A's rows went up while signed in as B")

        // A again.
        #expect(AccountLibrary.adopt(a, context: context, defaults: defaults))
        StubSupabase.account = a
        StubSupabase.resetLog()
        let third = engine(a)
        await third.sync()
        await third.stop()
        let sentAsA = StubSupabase.bodies.joined().lowercased()
        #expect(aFolders.allSatisfy { !sentAsA.contains($0) }, "coming back, nothing of A's went up: it only came down")
        let server = StubSupabase.rows("folders").filter { aFolders.contains($0["id"] as? String ?? "") }
        #expect(server.count == 3 && server.allSatisfy { $0["deleted_at"] == nil || $0["deleted_at"] is NSNull },
                "A's folders are untouched on the server")
        #expect(context.allFolders().count == 3, "and back here, live")
    }

    /// A deletion the server refuses as another account's row (row-level security) goes from here
    /// and isn't tried again; the rest of the sync carries on.
    @Test func aDeletionTheServerSaysIsntThisAccountsIsDropped() async throws {
        defaults.set(true, forKey: SyncEngine.resetKey(b))
        let other = UUID()
        StubSupabase.account = a
        StubSupabase.insert("folders", ["id": other.uuidString.lowercased(), "_owner": a.uuidString.lowercased(), "version": 1,
                                        "server_updated_at": StubSupabase.stamp(.now)])
        StubSupabase.account = b
        let stray = Folder(name: "Not mine")
        stray.id = other
        stray.deletedAt = .now
        stray.dirty = true
        context.insert(stray)
        let mine = context.createFolder(named: "Mine")
        try context.save()
        let engineB = engine(b)
        await engineB.sync()
        #expect(context.folder(other) == nil && !context.allFoldersIncludingDeleted().contains { $0.id == other })
        #expect(!mine.dirty && engineB.problem == nil)
        StubSupabase.resetLog()
        await engineB.sync()
        #expect(!StubSupabase.bodies.joined().lowercased().contains(other.uuidString.lowercased()), "not tried again")
        await engineB.stop()
    }

    @Test func refusalsThatMeanAnotherAccountsRow() {
        #expect(SyncEngine.notThisAccounts(PostgrestError(hint: "not_yours", code: "PT413", message: "That folder or note doesn't exist.")))
        #expect(SyncEngine.notThisAccounts(PostgrestError(code: "42501", message: "new row violates row-level security policy")))
        #expect(!SyncEngine.notThisAccounts(PostgrestError(hint: "wrong_key", code: "42501", message: "wrong key")))
        #expect(!SyncEngine.notThisAccounts(PostgrestError(hint: "note_bytes", code: "PT413", message: "too long")))
        #expect(!SyncEngine.notThisAccounts(URLError(.notConnectedToInternet)))
    }

    /// What the old switch left: B's library holding A's folders, deleted and marked to go up as if
    /// they'd been synced. The server has only B's own; the rest go for good, without a push.
    @Test func foldersLeftByAnotherAccountAreRemovedNotPushed() async throws {
        let mine = context.createFolder(named: "Mine")
        let mineDeleted = context.createFolder(named: "Mine, deleted")
        let engineB = engine(b)
        await engineB.sync()
        #expect(!mine.dirty && !mineDeleted.dirty)

        var foreign: [UUID] = []
        for i in 0..<250 {
            let f = Folder(name: "A's folder \(i)")
            f.serverVersion = 1
            f.deletedAt = .now
            f.dirty = true
            context.insert(f)
            foreign.append(f.id)
        }
        // B deletes one of its own folders: that one must still go up.
        context.trash(mineDeleted)
        try context.save()

        StubSupabase.resetLog()
        await engineB.sync()
        let pushedIDs = StubSupabase.bodies.joined().lowercased()
        #expect(foreign.allSatisfy { !pushedIDs.contains($0.uuidString.lowercased()) }, "A's folders never went up")
        #expect(context.allFoldersIncludingDeleted().allSatisfy { !foreign.contains($0.id) }, "and they're gone here")
        #expect(!mineDeleted.dirty, "B's own deletion went up")
        #expect(StubSupabase.rows("folders").first { ($0["id"] as? String) == mineDeleted.id.uuidString.lowercased() }?["deleted_at"] is String)
        #expect(engineB.problem == nil)
        // Nothing left to clean: the next sync doesn't ask again.
        StubSupabase.resetLog()
        await engineB.sync()
        #expect(!StubSupabase.requests.contains { $0.contains("folders?select=id") })
        await engineB.stop()
    }
}
}
