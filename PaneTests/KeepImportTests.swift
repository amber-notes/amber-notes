import Foundation
import SwiftData
import Testing
import ZIPFoundation
@testable import Pane

/// The Google Keep import from a Takeout download: text and checklists, labels as folders or
/// tags, pins, archive and trash, images (with Takeout's .jpeg/.jpg mix-up), dates, and what
/// can't come over said in the summary.
@MainActor @Suite(.serialized) struct KeepImportTests {
    /// A Takeout download: Takeout/Keep with a .json and .html per note, images and Labels.txt.
    static func takeout() throws -> URL {
        let src = try #require(Bundle(for: KeepFixtureToken.self).url(forResource: "Keep", withExtension: nil))
        let dir = FileManager.default.temporaryDirectory.appending(path: "keep-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: src.appending(path: "Takeout"), to: dir.appending(path: "Takeout"))
        return dir.appending(path: "Takeout")
    }

    typealias Imported = MarkdownImportTests.Imported

    static func importing(_ url: URL, options: ImportOptions = ImportOptions(), container: ModelContainer? = nil) async throws -> Imported {
        let c = try container ?? ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let summary = await KeepImporter(context: c.mainContext, options: options).run([KeepImporter.inspect(url)], into: .perSource)
        return Imported(container: c, summary: summary)
    }

    static func usec(_ n: Int64) -> Date { Date(timeIntervalSince1970: Double(n) / 1_000_000) }

    @Test func readsANote() throws {
        let json = #"{"title":"","textContent":"Hi","isPinned":true,"color":"BLUE","createdTimestampUsec":1704447300000000,"labels":[{"name":"Home"}],"reminders":[{}]}"#
        let n = try #require(KeepNote.read(Data(json.utf8)))
        #expect(n.textContent == "Hi" && n.isPinned == true && n.hasColor && n.reminders && !n.drawings)
        #expect(n.created == Self.usec(1_704_447_300_000_000) && n.labels?.first?.name == "Home")
        #expect(KeepNote.read(Data(#"{"kind":"settings"}"#.utf8)) == nil, "Takeout's other JSON isn't a note")
        #expect(KeepNote.read(Data("not json".utf8)) == nil)
    }

    @Test func bodies() {
        var n = KeepNote()
        n.textContent = "Line one\r\nLine two"
        n.listContent = [.init(text: "Done", isChecked: true), .init(text: "Open", isChecked: false), .init(text: " ", isChecked: false)]
        n.annotations = [.init(url: "https://example.com", title: "Example"), .init(url: "https://a.b", title: nil)]
        #expect(KeepImporter.body(n) == "Line one\nLine two\n\n- [ ] Open\n- [x] Done\n\n[Example](https://example.com)\nhttps://a.b")
    }

    @Test func inspectsTakeoutItsKeepFolderOrAZip() throws {
        let takeout = try Self.takeout()
        #expect(KeepImporter.inspect(takeout).notes == 7)
        #expect(KeepImporter.inspect(takeout.appending(path: "Keep")).notes == 7)
        #expect(KeepImporter.inspect(takeout.deletingLastPathComponent()).notes == 7, "the folder the .zip unpacked into")
        let zip = takeout.deletingLastPathComponent().appending(path: "takeout-20260930T101500Z-001.zip")
        try FileManager.default.zipItem(at: takeout, to: zip, shouldKeepParent: true)
        #expect(KeepImporter.inspect(zip).notes == 7)
        #expect(KeepImporter.inspect(FileManager.default.temporaryDirectory.appending(path: "nothing-\(UUID().uuidString)")).problem != nil)
    }

    @Test func labelsAsFoldersArchiveLeftOut() async throws {
        let r = try await Self.importing(try Self.takeout())
        defer { r.cleanUp() }
        let s = r.summary
        #expect(s.notes == 5 && s.archived == 1 && s.trashed == 1 && s.skipped == 2)
        #expect(s.attachments == 2 && s.filesMissing == 1 && s.notNotes == 0)
        #expect(s.dropped == ["1 note had a color, which Amber Notes doesn't have.",
                              "1 note had a drawing, which couldn't come over.",
                              "1 note had a reminder, which Amber Notes doesn't keep."])

        let groceries = try r.note("Groceries")
        #expect(groceries.body == "Groceries\n- [ ] Oat milk\n- [ ] Saffron\n- [x] Lemons\n")
        #expect(groceries.isPinned && r.path(groceries) == "Google Keep/Home")
        #expect(groceries.createdAt == Self.usec(1_709_280_000_000_000) && groceries.updatedAt == Self.usec(1_709_366_400_123_456))

        let porto = try r.note("Porto ideas")
        let photo = try #require(r.files.first { $0.filename == "1a2b3c4d5e.jpg" }, "Takeout's .jpeg in the JSON is a .jpg on disk")
        #expect(photo.contentType == "public.jpeg")
        #expect(porto.body == "Porto ideas\nPort tasting\nLivraria Lello at 9 — book ahead 📚\n\n[Livraria Lello](https://www.livrarialello.pt/)\n\n\(photo.markdown)\n\n#Family\n")
        #expect(r.path(porto) == "Google Keep/Travel", "the first label is the folder, the rest are tags")

        let dentist = try r.note("Call the dentist")
        #expect(dentist.body == "Call the dentist\nAsk about Thursday\n", "an untitled note is named by its first line")
        #expect(r.path(dentist) == "Google Keep")
        #expect(!r.notes.contains { $0.title == "Old list" || $0.title == "Deleted" })
        #expect(try r.note("Missing photo").body == "Missing photo\nIt was here\n")
    }

    @Test func labelsAsTagsWithTheArchive() async throws {
        let r = try await Self.importing(try Self.takeout(), options: ImportOptions(labelsAsFolders: false, includeArchived: true))
        defer { r.cleanUp() }
        #expect(r.summary.notes == 6 && r.summary.archived == 0 && r.summary.trashed == 1)
        let groceries = try r.note("Groceries")
        #expect(r.path(groceries) == "Google Keep" && groceries.body.hasSuffix("\n\n#Home\n"))
        #expect(try r.note("Porto ideas").body.hasSuffix("\n\n#Travel #Family\n"))
        let old = try r.note("Old list")
        #expect(r.path(old) == "Google Keep/Archive" && old.body == "Old list\n- [x] Paint\n\n#Home\n")
        #expect(Set(r.context.allFolders().map(\.name)) == ["Google Keep", "Archive"])
    }

    @Test func aTakeoutZipAndNoCopiesTheSecondTime() async throws {
        let takeout = try Self.takeout()
        let zip = takeout.deletingLastPathComponent().appending(path: "takeout.zip")
        try FileManager.default.zipItem(at: takeout, to: zip, shouldKeepParent: true)
        let c = try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let first = try await Self.importing(zip, container: c)
        defer { first.cleanUp() }
        #expect(first.summary.notes == 5 && first.summary.attachments == 2)
        let again = try await Self.importing(takeout, container: c)
        #expect(again.summary.notes == 0 && again.summary.alreadyImported == 5 && again.files.count == 2)
    }
}

private final class KeepFixtureToken {}
