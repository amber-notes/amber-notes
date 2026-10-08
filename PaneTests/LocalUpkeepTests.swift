import Foundation
import SwiftData
import Testing
@testable import Pane

/// The store's change history is forgotten past its cutoff, and the notes are not.
@MainActor @Suite struct LocalUpkeepTests {
    func store() throws -> (ModelContainer, URL) {
        let dir = FileManager.default.temporaryDirectory.appending(path: "LocalUpkeepTests.\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(url: dir.appending(path: "upkeep.store")))
        return (c, dir)
    }

    func transactions(_ c: ModelContainer) throws -> Int {
        try ModelContext(c).fetchHistory(HistoryDescriptor<DefaultHistoryTransaction>()).count
    }

    @Test func oldHistoryGoesAndTheNotesStay() throws {
        let (c, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        let ctx = ModelContext(c)
        for i in 0..<5 {
            ctx.createNote(in: .all, body: "Note \(i)")
            try ctx.save()
        }
        #expect(try transactions(c) >= 5)

        #expect(LocalUpkeep.forgetOldHistory(in: c, before: .now.addingTimeInterval(60)))
        #expect(try transactions(c) == 0)
        #expect(try ModelContext(c).fetch(FetchDescriptor<Note>()).count == 5)
    }

    @Test func historyNewerThanTheCutoffIsKept() throws {
        let (c, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        let ctx = ModelContext(c)
        ctx.createNote(in: .all, body: "Today's note")
        try ctx.save()
        let before = try transactions(c)
        #expect(before >= 1)

        #expect(LocalUpkeep.forgetOldHistory(in: c))
        #expect(try transactions(c) == before)
    }
}
