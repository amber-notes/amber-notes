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

    /// A sync asked for while another is running isn't dropped: it runs straight after, and
    /// awaiting it waits for that run (Sync Now mid-push, a restore's push, the last push).
    @Test func aSyncAskedForMidRunRunsAfterIt() async throws {
        let n = try await syncedNote("Draft")
        let other = context.createNote(in: .all, body: "Elsewhere")
        other.dirty = true
        NetFault.config = .init(delay: 0.3)
        NetFault.resetLog()
        let first = Task { await engine.sync(pulling: false) }
        await waitUntil { NetFault.started.contains { $0.1.hasSuffix("/notes") } }
        // The first run is in the air with the old text; this change needs a run of its own.
        n.body = "Draft two"; n.dirty = true
        await engine.sync()
        #expect(serverBody(n) == "Draft two", "the second sync ran after the first")
        #expect(!n.dirty)
        await first.value
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

    // MARK: Not hammering the server

    /// Typing for three seconds with no connection (or every request failing), then stopping:
    /// pushes stay throttled while you type and stop when you do.
    @Test(arguments: [NetFault.Config(offline: true), NetFault.Config(failRate: 1)])
    func typingOnABadNetworkDoesNotHammer(_ fault: NetFault.Config) async throws {
        let n = try await syncedNote("Draft")
        NetFault.config = fault
        NetFault.resetLog()
        for i in 0..<30 {
            n.body = "Draft \(i)"; n.touch()
            try await Task.sleep(for: .milliseconds(100))
        }
        let typing = NetFault.started.count
        try await Task.sleep(for: .seconds(3))
        let idle = NetFault.started.count - typing
        print("PERF \(fault.offline ? "offline" : "every request failing"): \(typing) requests in 3 s of typing (\(Double(typing) / 3) a second), \(idle) in 3 s idle")
        #expect(Double(typing) / 3 <= 4, "at most one push attempt per 0.35 s")
        #expect(idle <= 1, "nothing retries on its own once you stop")
        #expect(n.dirty && n.body == "Draft 29")
        await finish()
    }

    // MARK: Realtime down

    /// While realtime isn't joined, a short poll brings other devices' edits (8 s, 30 s once
    /// quiet for 5 minutes; shortened here), and it stops when realtime joins or the app leaves
    /// the front.
    @Test func realtimeDownPollsAndBacksOff() async throws {
        let saved = SyncEngine.fallbackPoll
        SyncEngine.fallbackPoll = (.milliseconds(200), .milliseconds(600), 1.0)
        defer { SyncEngine.fallbackPoll = saved }
        let n = try await syncedNote("Plan")
        // The socket can't join (as with -netOffline); the network itself is fine.
        NetFault.config = .init(offline: true)
        await engine.start()
        NetFault.config = .init()
        #expect(!engine.realtimeUp)
        StubSupabase.edit(n.id, body: "Plan\n- from the phone", updatedAt: .now.addingTimeInterval(1))
        await waitUntil(1.5) { n.body == "Plan\n- from the phone" }
        #expect(n.body == "Plan\n- from the phone", "the poll brought the other device's edit")

        func pulls(over seconds: Double) async -> Int {
            let before = StubSupabase.requests.filter { $0.hasPrefix("GET") }.count
            try? await Task.sleep(for: .seconds(seconds))
            return StubSupabase.requests.filter { $0.hasPrefix("GET") }.count - before
        }
        let fast = await pulls(over: 0.8)
        // Quiet for over `slowAfter`: the poll slows down.
        try await Task.sleep(for: .seconds(0.6))
        let slow = await pulls(over: 1.8)
        print("PERF realtime down: \(fast) GETs in 0.8 s polling fast, \(slow) in 1.8 s once quiet")
        #expect(fast > 0 && Double(slow) / 1.8 < Double(fast) / 0.8, "polling slows once nothing changes")

        engine.realtimeChanged(up: true)
        try await Task.sleep(for: .milliseconds(700))
        #expect(await pulls(over: 1) == 0, "realtime is back: no polling")

        engine.realtimeChanged(up: false)
        engine.setActive(false)
        #expect(await pulls(over: 1) == 0, "in the background: no polling")
        engine.setActive(true)
        #expect(await pulls(over: 1) > 0, "back in front with realtime down: polling again")
        await finish()
        #expect(await pulls(over: 0.6) == 0, "signed out: nothing")
    }

    // MARK: Version history

    /// Restoring on a connection that hangs: each push attempt waits out its timeout, so
    /// retrying eight times kept the spinner up for minutes (8 × the request timeout). It
    /// gives up after the first failed attempt and says you're offline.
    @Test func restoreOnAHungNetworkGivesUpQuickly() async throws {
        let n = try await syncedNote("Draft")
        n.body = "Draft, edited"; n.touch()
        NetFault.config = .init(timeoutAfter: 0.5)
        NetFault.resetLog()
        let history = NoteHistory(store: EmptyHistoryStore(), context: context, sync: engine)
        let t = ContinuousClock.now
        await #expect(throws: HistoryError.offline) {
            try await history.restore(noteID: n.id, toVersion: 1)
        }
        let took = ContinuousClock.now - t
        print("PERF restore on a hung network gave up after \(took), \(NetFault.started.count) requests")
        #expect(took < .seconds(2), "one timed-out attempt, not eight")
        #expect(n.body == "Draft, edited", "and nothing you wrote changed")
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

    /// The push meets a newer version on the server (the conflict path) while typing is still
    /// waiting to be written: that typing goes into your conflicted copy, not nowhere.
    @Test func aConflictMidTypingKeepsYourTyping() async throws {
        let n = try await syncedNote("Plan")
        StubSupabase.edit(n.id, body: "Plan\n- theirs", updatedAt: .now.addingTimeInterval(5))
        let saver = DebouncedSave()
        n.body = "Plan\n- mine"; n.touch()
        type("Plan\n- mine, and more", into: n, with: saver)
        await engine.sync()
        await waitUntil { !saver.isPending }
        let all = try context.fetch(FetchDescriptor<Note>()).map(\.body).joined(separator: "\n")
        #expect(all.contains("mine, and more"), "typing waiting to be written is kept")
        #expect(n.body == "Plan\n- theirs")
        await finish()
    }

    /// An AI edits the note while you're typing in it: the pull that brings the AI's version
    /// must not throw away what you typed in the last moment (not yet written to the note).
    @Test func anAIEditArrivingMidTypingKeepsYourTyping() async throws {
        let n = try await syncedNote("Groceries\n- milk")
        StubSupabase.edit(n.id, body: "Groceries\n- milk\n- eggs", aiEditor: "Claude")
        let saver = DebouncedSave()
        type("Groceries\n- milk\n- bread", into: n, with: saver)
        await engine.sync()
        saver.flush()
        let all = try context.fetch(FetchDescriptor<Note>()).map(\.body).joined(separator: "\n")
        #expect(all.contains("bread"), "what you typed survives")
        #expect(all.contains("eggs") || (serverBody(n) ?? "").contains("eggs"), "and so does the AI's edit")
        await finish()
    }
}
}
