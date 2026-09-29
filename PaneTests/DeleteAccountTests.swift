import Foundation
import SwiftData
import Testing
@testable import Pane

@MainActor
@Suite struct DeleteAccountTests {
    @Test func wipingForgetsEveryNoteFolderAndFile() throws {
        let container = try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = container.mainContext
        let folder = Folder(name: "Work")
        context.insert(folder)
        context.insert(Note(body: "Plan\n\nsecret", folder: folder))
        try context.save()
        #expect(try context.fetchCount(FetchDescriptor<Note>()) == 1)

        context.wipeLocalLibrary()

        #expect(try context.fetchCount(FetchDescriptor<Note>()) == 0)
        #expect(try context.fetchCount(FetchDescriptor<Folder>()) == 0)
        #expect(try context.fetchCount(FetchDescriptor<Pane.Attachment>()) == 0)
    }
}
