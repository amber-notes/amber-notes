import Foundation
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// Sync on a slow, flaky or missing network, against a stub server (StubSupabase): nothing
/// typed is lost, offline edits go up later, and nothing hammers the server.
@MainActor @Suite struct SyncFaultTests {
    let context: ModelContext
    let engine: SyncEngine

    init() throws {
        StubSupabase.reset()
        NetFault.config = .init()
        NetFault.resetLog()
        UserDefaults.standard.removeObject(forKey: "syncCursor.none")
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        context = ModelContext(c)
        engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: context)
    }

    /// A note that's on the server and clean here.
    private func syncedNote(_ body: String) async throws -> Note {
        let n = context.createNote(in: .all, body: body)
        n.dirty = true
        await engine.sync()
        #expect(!n.dirty && n.serverVersion > 0)
        return n
    }

    private func serverBody(_ n: Note) -> String? { StubSupabase.note(n.id)?["body"] as? String }

    private func waitUntil(_ seconds: Double = 5, _ done: () -> Bool) async {
        let end = Date.now.addingTimeInterval(seconds)
        while !done(), Date.now < end { try? await Task.sleep(for: .milliseconds(20)) }
    }

    /// Nothing this engine scheduled may run into the next test.
    private func finish() async {
        await engine.stop()
        NetFault.config = .init()
    }

    /// The editor's save, as NoteDetailView does it: written after a pause, dropped if the
    /// note changed underneath.
    private func type(_ text: String, into n: Note, with saver: DebouncedSave) {
        saver.schedule(base: n.body) { [saver] in
            guard n.body == saver.base else { return }
            n.body = text
            n.touch()
        }
    }

    // MARK: Offline, then back

    @Test func offlineEditsGoUpOnceOnline() async throws {
        let n = try await syncedNote("Groceries")
        NetFault.config = .init(offline: true)
        n.body = "Groceries\n- milk"; n.touch()
        let fresh = context.createNote(in: .all, body: "Written on the train")
        fresh.dirty = true
        await engine.sync()
        #expect(engine.status == .offline("Offline"))
        #expect(n.dirty && fresh.dirty)
        #expect(n.body == "Groceries\n- milk", "an offline sync never touches what you wrote")

        NetFault.config = .init()
        await engine.sync()
        #expect(serverBody(n) == "Groceries\n- milk")
        #expect(serverBody(fresh) == "Written on the train")
        #expect(!n.dirty && !fresh.dirty)
        if case .synced = engine.status {} else { Issue.record("status should be synced, is \(engine.status)") }
        await finish()
    }

    @Test func slowNetworkTypingDuringAPushStillGoesUp() async throws {
        let n = try await syncedNote("Draft")
        NetFault.config = .init(delay: 0.4)
        n.body = "Draft one"; n.touch()
        try await Task.sleep(for: .milliseconds(150))
        n.body = "Draft one two"; n.touch()   // typed while the first push is in the air
        await waitUntil { serverBody(n) == "Draft one two" && !n.dirty }
        #expect(serverBody(n) == "Draft one two")
        #expect(!n.dirty)
        await finish()
    }

    @Test func flakyNetworkConvergesWithoutLosingAnything() async throws {
        var notes: [Note] = []
        for i in 0..<12 {
            let n = context.createNote(in: .all, body: "Note \(i)")
            n.dirty = true
            notes.append(n)
        }
        NetFault.config = .init(delay: 0.01, jitter: 0.02, failRate: 0.4)
        for i in 0..<12 { notes[i].body += " edited"; notes[i].touch() }
        var runs = 0
        while notes.contains(where: \.dirty), runs < 60 {
            await engine.sync()
            runs += 1
        }
        NetFault.config = .init()
        let dirty = notes.filter(\.dirty).count
        #expect(dirty == 0, "every note got up in the end (\(runs) runs)")
        for (i, n) in notes.enumerated() { #expect(serverBody(n) == "Note \(i) edited") }
        await finish()
    }

    // MARK: Conflicts

    @Test func theirNewerEditKeepsYoursAsACopy() async throws {
        let n = try await syncedNote("Plan")
        n.body = "Plan\n- mine"; n.touch()
        StubSupabase.edit(n.id, body: "Plan\n- theirs", updatedAt: .now.addingTimeInterval(5))
        await engine.sync()
        #expect(n.body == "Plan\n- theirs")
        let copies = try context.fetch(FetchDescriptor<Note>()).filter { $0.body.contains("(conflicted copy)") }
        #expect(copies.count == 1 && copies.first?.body.contains("- mine") == true)
        await finish()
    }
}
}
