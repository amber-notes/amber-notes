import Foundation
import Supabase
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// What the app makes for an account on its own (a first "Notes" folder, the setup guide's "To-do"
/// note) is made once for the account, never once for each empty library. Mac 1.2 added a "To-do"
/// note and another "Notes" folder to the account at every sign-in on a device with no library yet.
@MainActor @Suite(.sealedAccount) struct SeedOnceTests {
    let user = SealedAccount.user

    init() {
        StubSupabase.reset()
        NetFault.config = .init()
    }

    struct Device {
        let context: ModelContext
        let engine: SyncEngine
    }

    func device(defaults: UserDefaults = MemoryDefaults()) throws -> Device {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        return Device(context: context, engine: SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: user),
                                                           context: context, defaults: defaults))
    }

    /// What AppGate.openLibrary and the note list do after signing in, in their order.
    private func openLibrary(_ d: Device) async {
        await d.engine.sync()
        if d.engine.claimNewAccount() { Seed.ensureLibrary(d.context, demo: false, welcome: false) }
        if d.engine.knowsAccount { d.context.makeToDoNoteIfMissing()?.dirty = true }
        await d.engine.sync()
    }

    private var live: (folders: Int, notes: Int) {
        (StubSupabase.rows("folders").filter { $0["deleted_at"] is NSNull || $0["deleted_at"] == nil }.count,
         StubSupabase.rows("notes").filter { $0["deleted_at"] is NSNull || $0["deleted_at"] == nil }.count)
    }

    @Test func aNewAccountGetsItsFolderAndEveryLaterDeviceAddsNothing() async throws {
        let first = try device()
        #expect(!first.engine.knowsAccount, "nothing is known before the first pull")
        await openLibrary(first)
        #expect(first.context.allFolders().map(\.name) == ["Notes"])
        #expect(live.folders == 1 && live.notes == 1, "one Notes folder and one To-do")

        // A second device, a reinstall, an App Reviewer: an empty library, the same account.
        for _ in 0 ..< 3 {
            let next = try device()
            await openLibrary(next)
            #expect(next.engine.knowsAccount && !next.engine.claimNewAccount())
            #expect(next.context.allFolders().count == 1)
            #expect(live.folders == 1 && live.notes == 1, "nothing was added to the account")
        }
    }

    @Test func theFirstFolderIsOfferedOnce() async throws {
        let d = try device()
        await d.engine.sync()
        #expect(d.engine.claimNewAccount())
        #expect(!d.engine.claimNewAccount())
    }

    /// The pull didn't happen (offline): the library is empty and says nothing about the account.
    @Test func nothingIsMadeBeforeTheAccountsNotesHaveComeDown() async throws {
        let first = try device()
        await openLibrary(first)
        let next = try device()
        NetFault.config = .init(offline: true)
        await openLibrary(next)
        NetFault.config = .init()
        #expect(!next.engine.knowsAccount && !next.engine.claimNewAccount())
        #expect(next.context.allFolders().isEmpty && SyncEngine.holdsNothing(next.context))
        await openLibrary(next)
        #expect(next.context.allFolders().count == 1)
        #expect(live.folders == 1 && live.notes == 1)
    }

    /// The library was removed and the settings weren't, so sync remembers a place the library
    /// no longer matches: everything comes down again, and the account isn't taken for a new one.
    @Test func anEmptyLibraryWithAMemoryOfSyncPullsEverythingAgain() async throws {
        let defaults = MemoryDefaults()
        let before = try device(defaults: defaults)
        await openLibrary(before)
        let after = try device(defaults: defaults)
        await openLibrary(after)
        #expect(after.context.allFolders().map(\.name) == ["Notes"])
        #expect(!after.engine.claimNewAccount())
        #expect(live.folders == 1 && live.notes == 1)
    }

    @Test func signingOutForgetsWhatWasKnownAboutTheAccount() async throws {
        let d = try device()
        await d.engine.sync()
        #expect(d.engine.knowsAccount)
        await d.engine.stop()
        #expect(!d.engine.knowsAccount && !d.engine.claimNewAccount())
    }

    /// The To-do note is looked for in the whole library, not in the folder on screen.
    @Test func aToDoNoteAnywhereIsEnough() throws {
        let context = try device().context
        let work = context.createFolder(named: "Work")
        context.createNote(in: .folder(work.id), body: "to-do\n\n- [ ] Call mom")
        #expect(context.makeToDoNoteIfMissing() == nil)

        let empty = try device().context
        let home = empty.createFolder(named: "Notes")
        let made = try #require(empty.makeToDoNoteIfMissing())
        #expect(made.body == SetupProgress.toDoBody && made.folder?.id == home.id)
        #expect(empty.makeToDoNoteIfMissing() == nil)
    }
}
}
