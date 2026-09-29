import Foundation
import SwiftData
import Testing
@testable import Pane

/// Where the sidebar points after folders come and go.
@MainActor @Suite struct ScopeTests {
    let a = UUID()
    let b = UUID()

    @Test func theFolderListKeepsNoSelection() {
        // nil is the iPhone folder list: never select a row there without pushing it.
        #expect(Scope.settled(nil, liveFolders: [a]) == nil)
        #expect(Scope.settled(nil, liveFolders: [a, b]) == nil)
    }

    @Test func aSingleFolderStandsInForAllNotes() {
        #expect(Scope.settled(.all, liveFolders: [a]) == .folder(a))
        #expect(Scope.settled(.all, liveFolders: [a, b]) == .all)
        #expect(Scope.settled(.trash, liveFolders: [a]) == .trash)
    }

    @Test func aFolderThatIsGoneFallsBack() {
        #expect(Scope.settled(.folder(b), liveFolders: [a, UUID()]) == .all)
        #expect(Scope.settled(.folder(b), liveFolders: [a]) == .folder(a))
        #expect(Scope.settled(.folder(a), liveFolders: [a, b]) == .folder(a))
    }

    /// Deleting Work while Q4 planning (inside it) was open used to leave you in a ghost
    /// folder, and a new note went into it, out of every folder's sight.
    @Test func aNewNoteNeverLandsInADeletedFolder() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = ModelContext(c)
        let home = ctx.createFolder(named: "Notes")
        let work = ctx.createFolder(named: "Work")
        let q4 = ctx.createFolder(named: "Q4 planning", parent: work)
        ctx.delete(work)
        #expect(q4.deletedAt != nil)
        let n = ctx.createNote(in: .folder(q4.id), body: "Typed after the delete")
        #expect(n.folder?.id == home.id)
        #expect(Scope.settled(.folder(q4.id), liveFolders: ctx.allFolders().map(\.id)) == .folder(home.id))
    }
}
