import Foundation
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
            // Library's delete: to Recently Deleted, with what's inside.
            if i % 2 == 0 { context.delete(f) }
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
        context.delete(mineDeleted)
        try context.save()

        StubSupabase.resetLog()
        await engineB.sync()
        let pushedIDs = StubSupabase.bodies.joined()
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
