import Foundation
import SwiftData
import Testing
@testable import Pane

/// Signing in as someone else never shows, reopens or pushes the previous account's notes.
@MainActor @Suite struct AccountLibraryTests {
    let a = UUID()
    let b = UUID()

    func setup() throws -> (ModelContext, UserDefaults, URL) {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let suite = "AccountLibraryTests.\(UUID().uuidString)"
        let defaults = TestDefaults()
        let files = FileManager.default.temporaryDirectory.appending(path: suite, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: files.appending(path: "cached.png"))
        return (ModelContext(c), defaults, files)
    }

    @Test func anotherAccountClearsTheLibraryAndWhereYouWere() throws {
        let (ctx, defaults, files) = try setup()
        AccountLibrary.adopt(a, context: ctx, defaults: defaults, files: files)
        let old = ctx.createNote(in: .all, body: "Account A's note")
        try ctx.save()
        defaults.set(old.id.uuidString, forKey: "lastNote")
        defaults.set(Data([1]), forKey: "lastScope")
        defaults.set("cursor", forKey: "syncCursor.\(a.uuidString)")

        #expect(AccountLibrary.adopt(b, context: ctx, defaults: defaults, files: files))
        #expect(try ctx.fetch(FetchDescriptor<Note>()).isEmpty)
        #expect(defaults.string(forKey: "lastNote") == nil)
        #expect(defaults.data(forKey: "lastScope") == nil)
        #expect(defaults.string(forKey: "syncCursor.\(a.uuidString)") == nil)
        #expect(!FileManager.default.fileExists(atPath: files.path))
    }

    @Test func theSameAccountKeepsEverything() throws {
        let (ctx, defaults, files) = try setup()
        AccountLibrary.adopt(a, context: ctx, defaults: defaults, files: files)
        _ = ctx.createNote(in: .all, body: "Mine")
        defaults.set("x", forKey: "lastNote")
        #expect(!AccountLibrary.adopt(a, context: ctx, defaults: defaults, files: files))
        #expect(try ctx.fetch(FetchDescriptor<Note>()).count == 1)
        #expect(defaults.string(forKey: "lastNote") == "x")
    }

    @Test func theFirstAccountKeepsNotesWrittenBeforeSigningIn() throws {
        let (ctx, defaults, files) = try setup()
        _ = ctx.createNote(in: .all, body: "Written offline")
        #expect(!AccountLibrary.adopt(a, context: ctx, defaults: defaults, files: files))
        #expect(try ctx.fetch(FetchDescriptor<Note>()).count == 1)
    }

    // This device was removed from the account's devices (DeviceRemoval): what hasn't synced goes
    // up first when the server can be reached, and the library is erased either way.

    @Test func aRemovedDevicePushesWhatHasntSyncedBeforeItErases() async throws {
        let (ctx, defaults, files) = try setup()
        AccountLibrary.adopt(a, context: ctx, defaults: defaults, files: files)
        defaults.set("cursor", forKey: "syncCursor.\(a.uuidString.lowercased())")
        let synced = ctx.createNote(in: .all, body: "Already on the server")
        synced.dirty = false
        let unsynced = ctx.createNote(in: .all, body: "Typed on the train")
        unsynced.dirty = true
        try ctx.save()
        #expect(AccountLibrary.hasUnsynced(ctx))
        var pushed: [String] = [], keyThereAtPush = false, keyHere = true
        let removal = DeviceRemoval(
            defaults: defaults,
            push: {
                // As the app does it: only when something is unsynced, and while the key is still here.
                guard AccountLibrary.hasUnsynced(ctx) else { return }
                keyThereAtPush = keyHere
                for n in (try? ctx.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.dirty }))) ?? [] { pushed.append(n.body); n.dirty = false }
            },
            dropKey: { _ in keyHere = false },
            erase: { AccountLibrary.erase(context: ctx, defaults: defaults, files: files) },
            forget: { _ in },
            signOut: {})
        await removal.run(account: a)
        #expect(pushed == ["Typed on the train"] && keyThereAtPush, "the unsynced note went up before the key and the library went")
        #expect(try ctx.fetch(FetchDescriptor<Note>()).isEmpty)
        #expect(!keyHere)
        #expect(defaults.string(forKey: AccountLibrary.ownerKey) == nil && defaults.string(forKey: "syncCursor.\(a.uuidString.lowercased())") == nil,
                "signing in again starts from an empty library and pulls everything")
        #expect(!FileManager.default.fileExists(atPath: files.path))
    }

    @Test func aRemovedDeviceThatCantReachTheServerErasesAnyway() async throws {
        let (ctx, defaults, files) = try setup()
        AccountLibrary.adopt(a, context: ctx, defaults: defaults, files: files)
        ctx.createNote(in: .all, body: "Never synced").dirty = true
        try ctx.save()
        var erased = false
        let removal = DeviceRemoval(defaults: defaults,
                                    push: { /* offline: nothing goes up */ },
                                    dropKey: { _ in },
                                    erase: { AccountLibrary.erase(context: ctx, defaults: defaults, files: files); erased = true },
                                    forget: { _ in },
                                    signOut: {})
        await removal.run(account: a)
        #expect(erased, "the removal wins; the Remove dialog warns about this")
        #expect(try ctx.fetch(FetchDescriptor<Note>()).isEmpty)
        #expect(!AccountLibrary.hasUnsynced(ctx))
    }
}
