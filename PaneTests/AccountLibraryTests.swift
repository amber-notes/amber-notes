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
}
