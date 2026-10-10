import Foundation
import SwiftData
import Testing
import ZIPFoundation
@testable import Pane

/// Export Your Notes: made on the device, markdown in your folders, files beside them, links that
/// still work.
@MainActor @Suite struct NoteExportTests {
    @Test func exportsNotesInTheirFoldersWithTheirFiles() async throws {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let work = context.createFolder(named: "Work")
        let trips = context.createFolder(named: "Trips", parent: work)
        let file = try FileStore.importData(Data("a map".utf8), filename: "map of Lisbon.txt", type: .plainText)
        context.insert(file)
        defer { try? FileManager.default.removeItem(at: FileStore.url(for: file.id, filename: file.filename).deletingLastPathComponent()) }
        let sub = context.createNote(in: .folder(work.id), body: "Packing list\n- socks")
        let n = context.createNote(in: .folder(trips.id), body: "Lisbon\n\(file.markdown)\n[Packing list](pane-note:\(sub.id.uuidString.lowercased()))")
        context.createNote(in: .folder(trips.id), body: "Lisbon\nthe other one")
        context.createNote(in: .folder(work.id), body: "Gone").trashedAt = .now
        let locked = context.createNote(in: .folder(work.id), body: "Bank")
        locked.lockedBody = "amb2.0123456789abcdef.AAAA"

        let vault = NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults())
        let result = try await NoteExport.make(context, vault: vault, now: Date(timeIntervalSince1970: 1_790_000_000))
        defer { try? FileManager.default.removeItem(at: result.zip.deletingLastPathComponent()) }
        #expect(result.notes == 3 && result.files == 1 && result.skippedLocked == 1 && result.missingFiles == 0)

        let out = result.zip.deletingLastPathComponent().appending(path: "unzipped")
        try FileManager.default.unzipItem(at: result.zip, to: out)
        let top = try #require(try FileManager.default.contentsOfDirectory(at: out, includingPropertiesForKeys: nil).first)
        let lisbon = try String(contentsOf: top.appending(path: "Work/Trips/Lisbon.md"), encoding: .utf8)
        #expect(lisbon.contains("](../../Files/map%20of%20Lisbon.txt)"), "the file link points at the exported file")
        #expect(lisbon.contains("[Packing list](../../Work/Packing%20list.md)"), "a sub-note link points at its export")
        #expect(try String(contentsOf: top.appending(path: "Work/Trips/Lisbon 2.md"), encoding: .utf8).contains("the other one"), "same titles don't overwrite")
        #expect(try String(contentsOf: top.appending(path: "Files/map of Lisbon.txt"), encoding: .utf8) == "a map")
        #expect(!FileManager.default.fileExists(atPath: top.appending(path: "Work/Gone.md").path), "Recently Deleted stays out")
        #expect(!FileManager.default.fileExists(atPath: top.appending(path: "Work/Bank.md").path), "a locked note stays out while it's locked")
        _ = n
    }

    /// Mac 1.2 left these out: a PDF kept in a folder on its own wasn't in the zip, and neither
    /// was its folder, since only notes and the files they embed were written.
    @Test func exportsFilesKeptInFoldersAndFoldersWithNoNotes() async throws {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let notes = context.createFolder(named: "Notes")
        let papers = context.createFolder(named: "Papers")
        let taxes = context.createFolder(named: "Taxes", parent: papers)
        context.createFolder(named: "Empty")
        func file(_ text: String, _ name: String, in folder: Folder? = nil) throws -> Pane.Attachment {
            let a = try FileStore.importData(Data(text.utf8), filename: name, type: .plainText)
            a.folderID = folder?.id
            context.insert(a)
            return a
        }
        let embedded = try file("a picture", "picture.txt")
        let paper = try file("a paper", "paper.txt", in: papers)
        let receipt = try file("a receipt", "receipt.txt", in: taxes)
        let twin = try file("another paper", "paper.txt", in: papers)
        twin.createdAt = paper.createdAt.addingTimeInterval(1)
        let both = try file("kept in a folder and shown in a note", "plan.txt", in: papers)
        let gone = try file("deleted", "old.txt", in: papers)
        gone.trashedAt = .now
        let cloud = try file("only on the server", "cloud.txt", in: papers)
        let all = [embedded, paper, receipt, twin, both, gone, cloud]
        defer { for a in all { try? FileManager.default.removeItem(at: FileStore.url(for: a.id, filename: a.filename).deletingLastPathComponent()) } }
        try FileManager.default.removeItem(at: FileStore.url(for: cloud.id, filename: cloud.filename))
        context.createNote(in: .folder(notes.id), body: "Trip\n\(embedded.markdown)\n\(both.markdown)")

        let vault = NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults())
        let result = try await NoteExport.make(context, vault: vault, now: Date(timeIntervalSince1970: 1_790_000_000))
        defer { try? FileManager.default.removeItem(at: result.zip.deletingLastPathComponent()) }
        #expect(result.notes == 1 && result.files == 5 && result.missingFiles == 1)

        let out = result.zip.deletingLastPathComponent().appending(path: "unzipped")
        try FileManager.default.unzipItem(at: result.zip, to: out)
        let top = try #require(try FileManager.default.contentsOfDirectory(at: out, includingPropertiesForKeys: nil).first)
        func text(_ path: String) -> String? { try? String(contentsOf: top.appending(path: path), encoding: .utf8) }
        #expect(text("Papers/paper.txt") == "a paper", "a file kept in a folder is in that folder")
        #expect(text("Papers/paper 2.txt") == "another paper", "two with one name are both there")
        #expect(text("Papers/Taxes/receipt.txt") == "a receipt", "in a sub-folder too")
        #expect(text("Files/picture.txt") == "a picture", "a file only a note embeds stays under Files")
        #expect(text("Papers/plan.txt") == "kept in a folder and shown in a note")
        #expect(text("Notes/Trip.md")?.contains("](../Papers/plan.txt)") == true, "and the note's link points at it there")
        #expect(text("Papers/old.txt") == nil, "Recently Deleted stays out")
        #expect(text("Papers/cloud.txt") == nil, "a file that couldn't be fetched is counted, not written")
        var isFolder: ObjCBool = false
        #expect(FileManager.default.fileExists(atPath: top.appending(path: "Empty").path, isDirectory: &isFolder) && isFolder.boolValue,
                "a folder with nothing in it is still in the export")
    }

    @Test func sharingListsPeopleLinkSettingsAndTemplates() async throws {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let work = context.createFolder(named: "Work")
        let offsite = context.createNote(in: .folder(work.id), body: "Team offsite\n- book the venue")
        let habits = Note(body: "Habits\n| Day | Run |")
        let mine = Note(body: "Sharing\na note that happens to share the name")
        context.insert(habits)
        context.insert(mine)
        let sharing = NoteExport.Sharing(
            notes: [.init(note: offsite.id, people: [.init(name: "Emil", role: "owner", isMe: true), .init(name: "Sara", role: "editor")], link: .edit),
                    .init(note: UUID(), people: [.init(name: "Jonas", role: "owner")], link: nil)],
            templates: [.init(note: habits.id, url: URL(string: "https://ambernotes.app/t/abc123")!)])

        let vault = NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults())
        let result = try await NoteExport.make(context, vault: vault, now: Date(timeIntervalSince1970: 1_790_000_000), sharing: sharing)
        defer { try? FileManager.default.removeItem(at: result.zip.deletingLastPathComponent()) }
        #expect(result.notes == 3)

        let out = result.zip.deletingLastPathComponent().appending(path: "unzipped")
        try FileManager.default.unzipItem(at: result.zip, to: out)
        let top = try #require(try FileManager.default.contentsOfDirectory(at: out, includingPropertiesForKeys: nil).first)
        let text = try String(contentsOf: top.appending(path: "Sharing.md"), encoding: .utf8)
        #expect(text.contains("### [Team offsite](Work/Team%20offsite.md)\n\n- People with the link: Can edit\n- Emil (you), owner\n- Sara, can edit"))
        #expect(text.contains("### A note that isn't in this export\n\n- People with the link: No link\n- Jonas, owner"))
        #expect(text.contains("- [Habits](Habits.md): https://ambernotes.app/t/abc123"))
        #expect(!text.contains("/s/"), "no share link, and so no link secret, is written")
        #expect(try String(contentsOf: top.appending(path: "Sharing 2.md"), encoding: .utf8).contains("happens to share the name"), "a note named Sharing doesn't overwrite it")
    }

    @Test func noSharingNoFile() async throws {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        context.insert(Note(body: "Sharing\njust a note"))
        let vault = NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults())
        let result = try await NoteExport.make(context, vault: vault)
        defer { try? FileManager.default.removeItem(at: result.zip.deletingLastPathComponent()) }
        let out = result.zip.deletingLastPathComponent().appending(path: "unzipped")
        try FileManager.default.unzipItem(at: result.zip, to: out)
        let top = try #require(try FileManager.default.contentsOfDirectory(at: out, includingPropertiesForKeys: nil).first)
        #expect(try String(contentsOf: top.appending(path: "Sharing.md"), encoding: .utf8).contains("just a note"), "without sharing, the name is free for a note")
    }

    @Test func namesAreSafeOnEverySystem() {
        #expect(NoteExport.safeName("a/b:c") == "a-b-c")
        #expect(NoteExport.safeName("..hidden") == "hidden")
        #expect(NoteExport.safeName("   ") == "Untitled")
        var used = Set<String>()
        #expect(NoteExport.unique(["A", "x.md"], in: &used) == "A/x.md")
        #expect(NoteExport.unique(["a", "X.md"], in: &used) == "a/X 2.md")
    }
}
