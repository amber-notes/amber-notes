import CryptoKit
import Foundation
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// An encrypted account on the wire and through sync (against StubSupabase): nothing readable goes
/// up, another device with the key reads it all, and a row it can't open is never applied.
@MainActor @Suite struct E2EESyncTests {
    let user = UUID()
    let key = SymmetricKey(size: .bits256)
    /// Any of these in what reaches the server is a leak.
    let canary = "Canary-7f3c Lisbon trip"

    init() {
        StubSupabase.reset()
        NetFault.config = .init()
    }

    func device() throws -> (context: ModelContext, engine: SyncEngine) {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: context, defaults: MemoryDefaults())
        return (context, engine)
    }

    private func sealed(_ body: () async throws -> Void) async rethrows {
        E2EE.sealer = Sealer(key: key, user: user)
        defer { E2EE.sealer = nil }
        try await body()
    }

    /// Every row the stub holds, as JSON text.
    private func serverText() -> String {
        let all = ["notes", "folders", "attachments"].flatMap { StubSupabase.rows($0) }
        return String(decoding: (try? JSONSerialization.data(withJSONObject: all)) ?? Data(), as: UTF8.self)
    }

    @Test func nothingReadableGoesUpAndTheOtherDeviceReadsItAll() async throws {
        try await sealed {
            let a = try device()
            let folder = a.context.createFolder(named: "\(canary) folder")
            let n = a.context.createNote(in: .folder(folder.id), body: "\(canary)\nPastéis at 9")
            n.dirty = true
            await a.engine.sync()
            #expect(!n.dirty)
            let row = try #require(StubSupabase.note(n.id))
            #expect(row["body"] is NSNull)
            #expect((row["body_ct"] as? String)?.hasPrefix("amb2.\(E2EE.keyID(of: key)).") == true)
            #expect(row["head_ct"] is String)
            #expect(!serverText().contains("Canary-7f3c"), "the server never sees the text, the title or the folder name")

            let b = try device()
            await b.engine.sync()
            let there = try #require(b.context.note(n.id))
            #expect(there.body == "\(canary)\nPastéis at 9")
            #expect(there.folder?.name == "\(canary) folder")
            await a.engine.stop(); await b.engine.stop()
        }
    }

    @Test func anUnchangedNoteSealsToTheSameBox() async throws {
        try await sealed {
            let a = try device()
            let n = a.context.createNote(in: .all, body: "Same text")
            n.dirty = true
            await a.engine.sync()
            let first = StubSupabase.note(n.id)?["body_ct"] as? String
            n.isPinned = true
            n.touch()
            await a.engine.sync()
            #expect(StubSupabase.note(n.id)?["body_ct"] as? String == first, "a pin doesn't look like a new text to the server")
            await a.engine.stop()
        }
    }

    @Test func aRowSealedWithAnotherKeyIsNeverApplied() async throws {
        let a = try device()
        let n = a.context.createNote(in: .all, body: "Mine")
        n.dirty = true
        try await sealed {
            await a.engine.sync()
        }
        // Another key: this device can't open what's on the server now.
        E2EE.sealer = Sealer(key: SymmetricKey(size: .bits256), user: user)
        defer { E2EE.sealer = nil }
        let b = try device()
        await b.engine.sync()
        #expect(b.context.note(n.id) == nil, "a note that can't be opened isn't made here, empty")
        #expect(b.engine.problem?.contains("couldn't be opened") == true)
        await a.engine.stop(); await b.engine.stop()
    }

    @Test func theWireCarriesSealedColumnsOnly() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = ModelContext(c)
        let n = context.createNote(in: .all, body: "\(canary)\nsecond line")
        let locked = context.createNote(in: .all, body: "\(canary) locked title")
        locked.lockedBody = "amb2.0123456789abcdef.AAAA"
        E2EE.sealer = Sealer(key: key, user: user)
        defer { E2EE.sealer = nil }
        for data in [try JSONEncoder().encode(NoteDTO(n)), try JSONEncoder().encode(NoteDTO(n).patch), try JSONEncoder().encode(NoteDTO(locked)),
                     try JSONEncoder().encode(FolderDTO(Folder(name: canary))),
                     try JSONEncoder().encode(AttachmentDTO(id: UUID(), filename: "\(canary).pdf", content_type: "com.adobe.pdf", size: 10, storage_path: "u/x/sealed", created_at: .now, updated_at: .now, deleted_at: nil))] {
            #expect(!String(decoding: data, as: UTF8.self).contains("Canary-7f3c"))
        }
        let sent = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteDTO(n))) as? [String: Any])
        let back = try JSONDecoder().decode(NoteDTO.self, from: JSONSerialization.data(withJSONObject: sent.merging(["version": 1]) { $1 }))
        #expect(back.body == n.body && !back.unreadable)
        // A locked note: its sealed text as always, its title sealed as the head.
        let l = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteDTO(locked))) as? [String: Any])
        #expect(l["body_ct"] is NSNull && l["body"] is NSNull && l["locked_body"] as? String == "amb2.0123456789abcdef.AAAA")
        let lb = try JSONDecoder().decode(NoteDTO.self, from: JSONSerialization.data(withJSONObject: l))
        #expect(lb.body == "\(canary) locked title")
        // A file: name and type sealed, the stored size is the sealed size.
        let f = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(AttachmentDTO(id: UUID(), filename: "a.pdf", content_type: "com.adobe.pdf", size: 10, storage_path: "u/x/sealed", created_at: .now, updated_at: .now, deleted_at: nil))) as? [String: Any])
        #expect(f["filename"] is NSNull && f["size"] as? Int == 10 + Int(AttachmentDTO.sealOverhead))
        let fb = try JSONDecoder().decode(AttachmentDTO.self, from: JSONSerialization.data(withJSONObject: f))
        #expect(fb.filename == "a.pdf" && fb.content_type == "com.adobe.pdf" && fb.size == 10 && fb.sealed)
    }

    @Test func aRealtimeRowWithoutItsTextIsFetchedNotApplied() throws {
        let row: [String: Any] = ["id": UUID().uuidString, "created_at": 0, "updated_at": 0, "is_pinned": false]
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(NoteDTO.self, from: JSONSerialization.data(withJSONObject: row)) }
    }

    @Test func migrationMarksWhatsOnTheServerAndReadableFiles() throws {
        let (context, _) = try device()
        let defaults = MemoryDefaults()
        let synced = context.createNote(in: .all, body: "On the server")
        synced.serverVersion = 3
        synced.dirty = false
        let file = Attachment(filename: "x.pdf", contentType: "com.adobe.pdf", size: 3)
        file.uploaded = true
        file.dirty = false
        context.insert(file)
        let missing = E2EEMigration.mark(context, user: user, defaults: defaults)
        #expect(synced.dirty, "every note goes up again, sealed")
        #expect(file.dirty && missing.map(\.id) == [file.id], "a file not on this device is fetched first, then sealed")
        synced.dirty = false
        _ = E2EEMigration.mark(context, user: user, defaults: defaults)
        #expect(!synced.dirty, "notes are marked once, not on every launch")
    }
}
}
