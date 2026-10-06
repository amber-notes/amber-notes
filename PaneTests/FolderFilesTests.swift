import Foundation
import SwiftData
import Testing
@testable import Pane

/// Files kept in a folder on their own (FolderFiles.swift): added, listed with notes, renamed,
/// moved, deleted to Recently Deleted and back, synced with folder_id and trashed_at, and shared
/// in from another app into a picked folder.
@MainActor @Suite(.serialized) struct FolderFilesTests {
    private let tmp = FileManager.default.temporaryDirectory.appending(path: "folder-files-\(UUID().uuidString)")

    /// An in-memory library. The container is kept for the whole test: a context outlives it badly.
    private func library() throws -> ModelContainer {
        try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    private func sample(_ name: String, _ text: String = "%PDF-1.4 a paper") throws -> URL {
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let url = tmp.appending(path: name)
        try Data(text.utf8).write(to: url)
        return url
    }

    @Test func addedFilesSitInTheFolderOnTheirOwn() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let toRead = context.createFolder(named: "To read")
        let other = context.createFolder(named: "Other")
        let made = context.addFiles([try sample("Attention.pdf")], to: toRead)
        let file = try #require(made.first)
        #expect(file.folderID == toRead.id)
        #expect(file.dirty && !file.uploaded, "goes up on the next sync")
        #expect(FileStore.exists(file))
        #expect(context.files(in: toRead.id).map(\.id) == [file.id])
        #expect(context.files(in: other.id).isEmpty)
        #expect(file.symbol == "doc.richtext")
        FileStore.remove(file)
    }

    @Test func renameKeepsTheEndingAndMovesTheLocalCopy() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let file = try #require(context.addFiles([try sample("Attention.pdf")], to: context.createFolder(named: "To read")).first)
        file.dirty = false
        context.rename(file, to: "Attention is all you need")
        #expect(file.filename == "Attention is all you need.pdf")
        #expect(file.dirty, "the new name syncs")
        #expect(FileStore.exists(file), "the bytes followed the name")
        context.rename(file, to: "Paper.pdf")
        #expect(file.filename == "Paper.pdf")
        #expect(FolderFileName.keepingExtension("  Notes / draft ", of: "a.csv") == "Notes - draft.csv")
        #expect(FolderFileName.keepingExtension("Budget.CSV", of: "a.csv") == "Budget.CSV")
        #expect(FolderFileName.keepingExtension("Readme", of: "README") == "Readme")
        #expect(FolderFileName.stem("Paper.pdf") == "Paper")
        FileStore.remove(file)
    }

    @Test func deleteGoesToRecentlyDeletedAndBack() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let toRead = context.createFolder(named: "To read")
        let file = try #require(context.addFiles([try sample("Attention.pdf")], to: toRead).first)
        context.remove(files: [file])
        #expect(file.trashedAt != nil && file.deletedAt == nil)
        #expect(context.files(in: toRead.id).isEmpty)
        context.restore(file)
        #expect(file.trashedAt == nil && file.folderID == toRead.id)

        // Its folder gone meanwhile: back into the default folder.
        context.trash(file)
        toRead.deletedAt = .now
        context.restore(file)
        #expect(file.folderID != nil && file.folderID != toRead.id)
        #expect(context.folder(file.folderID!)?.deletedAt == nil)

        // From Recently Deleted, deleting is for good, and the bytes go.
        context.remove(files: [file])
        context.remove(files: [file])
        #expect(file.deletedAt != nil)
        #expect(!FileStore.exists(file))
    }

    @Test func deletingAFolderTakesItsFilesToRecentlyDeleted() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let work = context.createFolder(named: "Work")
        let inner = context.createFolder(named: "Contracts", parent: work)
        let a = try #require(context.addFiles([try sample("A.pdf")], to: work).first)
        let b = try #require(context.addFiles([try sample("B.pdf")], to: inner).first)
        context.delete(work)
        #expect(a.trashedAt != nil && b.trashedAt != nil)
        FileStore.remove(a)
        FileStore.remove(b)
    }

    @Test func thirtyDaysInRecentlyDeletedThenGone() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let folder = context.createFolder(named: "To read")
        let old = try #require(context.addFiles([try sample("Old.pdf")], to: folder).first)
        let fresh = try #require(context.addFiles([try sample("Fresh.pdf")], to: folder).first)
        old.trashedAt = .now.addingTimeInterval(-31 * 24 * 3600)
        fresh.trashedAt = .now.addingTimeInterval(-2 * 24 * 3600)
        context.purgeExpiredTrash()
        #expect(old.deletedAt != nil)
        #expect(fresh.deletedAt == nil)
        FileStore.remove(fresh)
    }

    @Test func droppedFilesKeepTextAsNotesAndTheRestAsFiles() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let folder = context.createFolder(named: "To read")
        let made = context.importFiles([try sample("Idea.md", "# Idea\n\nA thought."), try sample("Paper.pdf")], into: .folder(folder.id))
        #expect(made.count == 2)
        #expect(context.note(made[0])?.title == "Idea")
        let file = try #require(context.attachment(made[1]))
        #expect(file.folderID == folder.id && file.filename == "Paper.pdf")
        FileStore.remove(file)
    }

    @Test func theListMixesNotesAndFilesByDate() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let folder = context.createFolder(named: "To read")
        let pinned = context.createNote(in: .folder(folder.id), body: "Pinned\n")
        pinned.isPinned = true
        let note = context.createNote(in: .folder(folder.id), body: "Plan\n")
        note.updatedAt = .now.addingTimeInterval(-3600)
        let file = try #require(context.addFiles([try sample("Paper.pdf")], to: folder).first)
        let sections = DateBucket.sections([ListItem.note(pinned), .note(note), .file(file)])
        #expect(sections.map(\.0) == ["Pinned", "Today"])
        #expect(sections[1].1.map(\.id) == [file.id, note.id], "newest first, files among the notes")
        FileStore.remove(file)
    }

    @Test func syncCarriesTheFolderAndRecentlyDeleted() throws {
        let sealer = Sealer(key: E2EE.newDataKey(), user: UUID())
        try Wire.$testSealer.withValue(sealer) {
            let folder = UUID()
            let file = Attachment(filename: "Paper.pdf", contentType: "com.adobe.pdf", size: 12)
            file.folderID = folder
            file.trashedAt = Date(timeIntervalSince1970: 1_800_000_000)
            let row = try JSONSerialization.jsonObject(with: JSONEncoder().encode(AttachmentDTO(file, path: "u/\(file.id)"))) as! [String: Any]
            #expect(row["folder_id"] as? String == folder.uuidString)
            #expect(row["trashed_at"] != nil)
            #expect((row["meta_ct"] as? String)?.contains("Paper") == false, "the name is sealed")
            let back = try JSONDecoder().decode(AttachmentDTO.self, from: JSONSerialization.data(withJSONObject: row))
            #expect(back.folder_id == folder && back.trashed_at == file.trashedAt && back.filename == "Paper.pdf")

            // A row from before the columns existed (or a file only a note embeds): no folder.
            var older = row
            older["folder_id"] = nil
            older["trashed_at"] = nil
            let plain = try JSONDecoder().decode(AttachmentDTO.self, from: JSONSerialization.data(withJSONObject: older))
            #expect(plain.folder_id == nil && plain.trashed_at == nil)

            // An embedded file says so explicitly: null, never a folder.
            let embedded = Attachment(filename: "Photo.jpg", contentType: "public.jpeg", size: 3)
            let e = try JSONSerialization.jsonObject(with: JSONEncoder().encode(AttachmentDTO(embedded, path: "u/\(embedded.id)"))) as! [String: Any]
            #expect(e["folder_id"] is NSNull)
        }
    }

    @Test func sharedFilesGoIntoThePickedFolder() throws {
        let inbox = tmp.appending(path: "Inbox")
        Inbox.rootOverride = inbox
        defer { Inbox.rootOverride = nil; try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let toRead = context.createFolder(named: "To read")
        let work = context.createFolder(named: "Work")
        _ = context.createFolder(named: "Clients", parent: work)

        // The app leaves its folders for the share sheet.
        context.publishFolderChoices()
        #expect(Inbox.folders().contains { $0.id == toRead.id && $0.name == "To read" })
        #expect(Inbox.folders().contains { $0.name == "Work/Clients" })

        // Files alone: kept in the folder as files. With text: a note in that folder.
        try Inbox.add(markdown: "", files: [try sample("Paper.pdf")], folder: toRead.id)
        try Inbox.add(markdown: "Call the plumber", files: [], folder: work.id)
        let notes = context.drainInbox()
        #expect(notes.map(\.title) == ["Call the plumber"])
        #expect(notes.first?.folder?.id == work.id)
        let file = try #require(context.files(in: toRead.id).first)
        #expect(file.filename == "Paper.pdf")
        #expect(Inbox.pending().isEmpty)
        FileStore.remove(file)
    }

    @Test func onlyKindsTheAppShowsAreAddedAndTheRestAreNamed() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let folder = context.createFolder(named: "Inbox")
        let big = try sample("Huge.pdf")
        let handle = try FileHandle(forWritingTo: big)
        try handle.truncate(atOffset: UInt64(FileKinds.maxBytes) + 1)
        try handle.close()
        var refused: FileRefusal?
        let observer = NotificationCenter.default.addObserver(forName: FileRefusal.notification, object: nil, queue: nil) { refused = $0.object as? FileRefusal }
        defer { NotificationCenter.default.removeObserver(observer) }
        let made = context.addFiles([try sample("Paper.pdf"), try sample("song.mp3"), try sample("book.epub"), big], to: folder)
        #expect(made.map(\.filename) == ["Paper.pdf"])
        #expect(refused?.unsupported == ["song.mp3", "book.epub"])
        #expect(refused?.tooBig == ["Huge.pdf"])
        #expect(refused?.message.contains("can't show these kinds of files yet") == true)
        #expect(refused?.message.contains("up to 100 MB") == true)
        for kind in ["pdf", "jpg", "png", "heic", "gif", "webp", "txt", "csv", "json", "py", "swift", "docx", "xlsx", "pptx", "pages", "numbers", "key"] {
            #expect(FileKinds.isSupported(URL(fileURLWithPath: "/x/a.\(kind)")), "\(kind) is added")
        }
        for kind in ["mp3", "mp4", "mov", "epub", "zip", "exe"] {
            #expect(!FileKinds.isSupported(URL(fileURLWithPath: "/x/a.\(kind)")), "\(kind) waits")
        }
        made.forEach(FileStore.remove)
    }

    @Test func aFinderFolderDroppedBecomesAFolderWithItsFiles() throws {
        defer { try? FileManager.default.removeItem(at: tmp) }
        let container = try library()
        let context = container.mainContext
        let work = context.createFolder(named: "Work")
        let dropped = tmp.appending(path: "Contracts")
        try FileManager.default.createDirectory(at: dropped.appending(path: "2025"), withIntermediateDirectories: true)
        try Data("%PDF".utf8).write(to: dropped.appending(path: "Acme.pdf"))
        try Data("%PDF".utf8).write(to: dropped.appending(path: "2025/Old.pdf"))
        try Data("x".utf8).write(to: dropped.appending(path: "notes.mp3"))
        let made = context.importFiles([dropped], into: .folder(work.id))
        #expect(made.count == 2)
        let contracts = try #require(context.allFolders().first { $0.name == "Contracts" })
        #expect(contracts.parent?.id == work.id)
        #expect(context.files(in: contracts.id).map(\.filename) == ["Acme.pdf"])
        let y2025 = try #require(context.allFolders().first { $0.name == "2025" })
        #expect(y2025.parent?.id == contracts.id && context.files(in: y2025.id).map(\.filename) == ["Old.pdf"])
        made.compactMap { context.attachment($0) }.forEach(FileStore.remove)
    }

    @Test func subNotesGetTheirParentFromTheLinkOnce() throws {
        let container = try library()
        let context = container.mainContext
        let child = context.createNote(in: .all, body: "Agenda\n")
        let parent = context.createNote(in: .all, body: "Acme\n\n[Agenda](pane-note:\(child.id.uuidString.lowercased()))\n")
        let other = context.createNote(in: .all, body: "Another\n\n[Agenda](pane-note:\(child.id.uuidString.lowercased()))\n")
        child.dirty = false
        #expect(context.backfillSubNoteParents() == 1)
        #expect(child.parentID == parent.id || child.parentID == other.id)
        #expect(child.dirty, "the parent syncs")
        let first = child.parentID
        #expect(context.backfillSubNoteParents() == 0, "a parent already set is never changed")
        #expect(child.parentID == first)
    }

    @Test func csvReadsAsATable() {
        let rows = CSVTable.parse("Book,Author,Pages\n\"Fluent Python\",\"Ramalho, Luciano\",1014\n\"Quote \"\"here\"\"\",x,\"two\nlines\"\n")
        #expect(rows.count == 3)
        #expect(rows[1] == ["Fluent Python", "Ramalho, Luciano", "1014"])
        #expect(rows[2] == ["Quote \"here\"", "x", "two\nlines"])
        #expect(CSVTable.parse("a\tb\n1\t2", separator: "\t") == [["a", "b"], ["1", "2"]])
    }

    @Test func storageWarnsAtNinetyPercentAndSaysWhatToRemoveWhenFull() {
        let gb: Int64 = 1_073_741_824
        var u = StorageUsage(used: gb, limit: 2 * gb, notes: 10_000_000, files: gb - 10_000_000, apps: 0, deleted: 0, versions: 0)
        #expect(u.level == .fine && u.warning == nil)
        #expect(u.summary == "1 GB of 2 GB used")
        u.used = Int64(Double(2 * gb) * 0.92)
        #expect(u.level == .nearlyFull)
        #expect(u.warning?.title == "Amber Notes is almost full")
        u.used = 2 * gb
        u.deleted = 300 * 1_048_576
        #expect(u.level == .full)
        #expect(u.warning?.detail.contains("Recently Deleted") == true)
        #expect(u.warning?.detail.contains("$") == false, "no money anywhere")
    }

    @Test func newBytesElsewhereMeanFetchingAgain() throws {
        let sealer = Sealer(key: E2EE.newDataKey(), user: UUID())
        try Wire.$testSealer.withValue(sealer) {
            let file = Attachment(filename: "Budget.csv", contentType: "public.comma-separated-values-text", size: 12)
            var row = try JSONSerialization.jsonObject(with: JSONEncoder().encode(AttachmentDTO(file, path: "u/\(file.id)"))) as! [String: Any]
            #expect(row["content_version"] == nil, "the server counts it; devices never send it")
            row["content_version"] = 3
            #expect(try JSONDecoder().decode(AttachmentDTO.self, from: JSONSerialization.data(withJSONObject: row)).content_version == 3)
        }
    }
}
