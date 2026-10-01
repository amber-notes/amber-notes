import Foundation
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// An Evernote import goes through sync like anything typed (against StubSupabase): every note,
/// folder and file goes up sealed, nothing readable reaches the server, and another device with
/// the account's key opens it all, files placed where they were.
@MainActor @Suite(.sealedAccount) struct EvernoteSyncTests {
    let user = SealedAccount.user

    init() {
        StubSupabase.reset()
        NetFault.config = .init()
    }

    private func device() throws -> (ModelContext, SyncEngine) {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: user), context: context, defaults: MemoryDefaults())
        return (context, engine)
    }

    private func everythingSent() -> String {
        let rows = ["notes", "folders", "attachments"].flatMap { StubSupabase.rows($0) }
        return StubSupabase.bodies.joined(separator: "\n")
            + String(decoding: (try? JSONSerialization.data(withJSONObject: rows)) ?? Data(), as: UTF8.self)
            + StubSupabase.objects.values.map { String(decoding: $0, as: UTF8.self) }.joined()
    }

    @Test func anImportedNotebookGoesUpSealedAndOpensOnTheOtherDevice() async throws {
        let (a, engineA) = try device()
        let source = ENEXSource.inspect(EvernoteImportTests.recipes)
        let summary = await EvernoteImporter(context: a).run([source], into: .perNotebook)
        #expect(summary.notes == 5 && summary.attachments == 3)
        await engineA.sync()

        let notes = try a.fetch(FetchDescriptor<Note>())
        let files = try a.fetch(FetchDescriptor<Pane.Attachment>())
        #expect(notes.allSatisfy { !$0.dirty } && files.allSatisfy { !$0.dirty && $0.uploaded })
        #expect(StubSupabase.rows("notes").count == 5 && StubSupabase.rows("attachments").count == 3 && StubSupabase.objects.count == 3)
        for row in StubSupabase.rows("notes") {
            #expect(row["body"] == nil && (row["body_ct"] as? String)?.hasPrefix("amb2.") == true, "only sealed text goes up")
        }
        for f in StubSupabase.objects.values { #expect(E2EE.isSealedFile(f)) }
        let sent = everythingSent()
        for secret in ["cardamom", "Recipes", "Lease 2022", "floor plan", "Oat milk", "李雷", "family-recipes", "%PDF", "IHDR"] {
            #expect(!sent.contains(secret), "\(secret) reached the server readable")
        }

        let (b, engineB) = try device()
        await engineB.sync()
        for n in notes {
            let there = try #require(b.note(n.id))
            #expect(there.body == n.body && there.folder?.name == "Recipes")
            #expect(Int(there.createdAt.timeIntervalSince1970) == Int(n.createdAt.timeIntervalSince1970), "Evernote's dates carry over")
        }
        let pdf = try #require(files.first { $0.filename == "Lease 2022.pdf" })
        let theirs = try #require(b.attachment(pdf.id))
        let original = try Data(contentsOf: FileStore.url(for: pdf.id, filename: pdf.filename))
        try FileManager.default.removeItem(at: FileStore.url(for: pdf.id, filename: pdf.filename))
        #expect(await engineB.download(theirs))
        #expect(try Data(contentsOf: FileStore.url(for: pdf.id, filename: pdf.filename)) == original)
        for f in files { try? FileManager.default.removeItem(at: FileStore.url(for: f.id, filename: f.filename).deletingLastPathComponent()) }
        await engineA.stop(); await engineB.stop()
    }
}
}
