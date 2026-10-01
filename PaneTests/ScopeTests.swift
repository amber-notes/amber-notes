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

    /// Compose on the iPhone folder list opens the new note inside its folder (TestFlight 1.1.1
    /// added a note there that no editor showed).
    @Test func composeFromTheFolderListOpensTheNotesFolder() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = ModelContext(c)
        let travel = ctx.createFolder(named: "Travel")
        _ = ctx.createFolder(named: "Personal")
        let n = ctx.createNote(in: .all)
        #expect(Scope.opening(n) == .folder(travel.id))
        #expect(Scope.settled(Scope.opening(n), liveFolders: ctx.allFolders().map(\.id)) == .folder(travel.id))
    }

    /// Relaunching on a blank note you never typed in discards it and opens the last real one,
    /// instead of an empty page (the 1.1.1 relaunch).
    @Test func aBlankNoteLeftOpenIsDiscardedAtLaunch() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = ModelContext(c)
        let folder = ctx.createFolder(named: "Notes")
        let real = ctx.createNote(in: .folder(folder.id), body: "Groceries\n\n- [ ] Eggs\n")
        let blank = ctx.createNote(in: .folder(folder.id))
        blank.updatedAt = .now.addingTimeInterval(10)
        #expect(ctx.noteToReopen(last: blank.id)?.id == real.id)
        #expect(blank.deletedAt != nil, "discarded, so it syncs away too")
        #expect(ctx.noteToReopen(last: real.id)?.id == real.id)
        #expect(ctx.noteToReopen(last: nil)?.id == real.id)
    }
}
