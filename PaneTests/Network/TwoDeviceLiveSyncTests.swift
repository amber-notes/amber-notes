import Foundation
import Supabase
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// Near-live sync between two devices on one account, in one process: each has its own library
/// and sync engine, both talk to the stub server through the fault layer, and "realtime" hands
/// each server write to the other device a moment later (the real socket needs the local stack).
@MainActor @Suite(.sealedAccount) struct TwoDeviceLiveSyncTests {
    struct Device {
        let context: ModelContext
        let engine: SyncEngine
    }

    let phone: Device
    let mac: Device

    init() throws {
        StubSupabase.reset()
        NetFault.config = .init()
        NetFault.resetLog()
        func device(_ name: String) throws -> Device {
            let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
            let ctx = ModelContext(c)
            return Device(context: ctx, engine: SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: ctx, defaults: TestDefaults()))
        }
        phone = try device("phone")
        mac = try device("mac")
    }

    /// The server's copy of a note, as realtime would carry it.
    static func serverRow(_ id: UUID) -> NoteDTO? {
        guard let raw = StubSupabase.note(id), let data = try? JSONSerialization.data(withJSONObject: raw) else { return nil }
        return try? AnyJSON.decoder.decode(NoteDTO.self, from: data)
    }

    /// Realtime: every new server version of the note reaches `to` about `delay` later.
    func relay(_ id: UUID, to d: Device, delay: Duration = .milliseconds(20), while running: @escaping () -> Bool) -> Task<Void, Never> {
        Task { @MainActor in
            var seen = -1
            while running() {
                if let v = StubSupabase.note(id)?["version"] as? Int, v != seen, let row = Self.serverRow(id) {
                    seen = v
                    try? await Task.sleep(for: delay)
                    d.engine.take([row])
                }
                try? await Task.sleep(for: .milliseconds(10))
            }
        }
    }

    /// A note both devices have, synced.
    func sharedNote(_ body: String) async throws -> (Note, Note) {
        let n = phone.context.createNote(in: .all, body: body)
        n.dirty = true
        await phone.engine.sync()
        await mac.engine.sync()
        let m = try #require(mac.context.note(n.id))
        #expect(m.body == body)
        return (n, m)
    }

    /// Types `text` on `n` a character every 100 ms, written to the note the way the editor
    /// does (at most every 0.35 s), pushing as the app does. Returns when each character was typed.
    func type(_ text: String, into n: Note, on d: Device) async -> [Date] {
        var typedAt: [Date] = []
        var pending = n.body
        var lastWrite = Date.now
        for ch in text {
            pending.append(ch)
            typedAt.append(.now)
            if Date.now.timeIntervalSince(lastWrite) >= DebouncedSave.maxWait {
                n.body = pending; n.touch(); lastWrite = .now
                d.engine.localChanged()
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        n.body = pending; n.touch()
        d.engine.localChanged()
        return typedAt
    }

    static func percentile(_ xs: [Double], _ p: Double) -> Double {
        let s = xs.sorted()
        return s.isEmpty ? .nan : s[min(s.count - 1, Int(Double(s.count - 1) * p))]
    }

    /// One device types, the other has the note open: how long until each character shows.
    @Test(arguments: [
        ("normal", NetFault.Config()),
        ("300 ms ± 200", NetFault.Config(delay: 0.3, jitter: 0.2)),
        ("1 s ± 500, 20 % dropped", NetFault.Config(delay: 1, jitter: 0.5, failRate: 0.2)),
    ])
    func typingReachesTheOtherDevice(_ label: String, _ fault: NetFault.Config) async throws {
        let (n, m) = try await sharedNote("Plan\n")
        NetFault.config = fault
        var running = true
        let r = relay(n.id, to: mac) { running }
        // When each prefix of the text first showed on the Mac.
        var shownAt: [Int: Date] = [:]
        let watch = Task { @MainActor in
            while running {
                let count = m.body.count - "Plan\n".count
                if count > 0, shownAt[count] == nil { shownAt[count] = .now }
                try? await Task.sleep(for: .milliseconds(5))
            }
        }
        let text = String(repeating: "live typing ", count: 5)
        let typed = await type(text, into: n, on: phone)
        // Let the tail arrive (a failed push is retried by the next change or the minute pull).
        let end = Date.now.addingTimeInterval(8)
        while m.body != n.body, Date.now < end {
            if StubSupabase.body(n.id) != n.body { await phone.engine.sync(pulling: false) }
            try? await Task.sleep(for: .milliseconds(50))
        }
        running = false
        _ = await (r.value, watch.value)
        var lat: [Double] = []
        for (i, t) in typed.enumerated() {
            // The first time at least i+1 characters were showing.
            if let shown = shownAt.filter({ $0.key >= i + 1 }).map(\.value).min() { lat.append(shown.timeIntervalSince(t)) }
        }
        let p50 = Self.percentile(lat, 0.5), p95 = Self.percentile(lat, 0.95)
        print("PERF live sync, \(label): p50 \(Int(p50 * 1000)) ms, p95 \(Int(p95 * 1000)) ms over \(lat.count) characters, \(NetFault.started.count) requests")
        #expect(m.body == n.body, "the Mac ends with exactly what the phone typed")
        if fault == NetFault.Config() {
            #expect(p50 < 0.7, "about half a second")
            #expect(p95 < 1.0)
        }
        NetFault.config = .init()
        await phone.engine.stop(); await mac.engine.stop()
    }

    /// Realtime is down: nothing arrives by itself, and the next pull (the minute timer,
    /// foreground, reconnect) brings everything.
    @Test func withoutRealtimeThePullCatchesUp() async throws {
        let (n, m) = try await sharedNote("Plan\n")
        _ = await type("typed while the socket was down", into: n, on: phone)
        try await Task.sleep(for: .milliseconds(800))
        #expect(m.body == "Plan\n", "nothing arrives without realtime")
        await mac.engine.sync()
        #expect(m.body == "Plan\ntyped while the socket was down")
        await phone.engine.stop(); await mac.engine.stop()
    }

    /// Both type in the same note at the same time, in different places.
    @Test(arguments: [NetFault.Config(), NetFault.Config(delay: 0.3, jitter: 0.2)])
    func bothTypingAtOnce(_ fault: NetFault.Config) async throws {
        let (n, m) = try await sharedNote("Top\n\nBottom\n")
        NetFault.config = fault
        var running = true
        let r1 = relay(n.id, to: mac) { running }
        let r2 = relay(n.id, to: phone) { running }
        // Interleaved: the phone adds a word at the top while the Mac adds one at the bottom.
        for (w, x) in zip(["one", "two", "three", "four", "five"], ["a", "b", "c", "d", "e"]) {
            n.body = n.body.replacingOccurrences(of: "Top", with: "Top " + w)
            n.touch(); phone.engine.localChanged()
            try? await Task.sleep(for: .milliseconds(175))
            m.body = m.body.replacingOccurrences(of: "Bottom", with: "Bottom " + x)
            m.touch(); mac.engine.localChanged()
            try? await Task.sleep(for: .milliseconds(175))
        }
        try await Task.sleep(for: .seconds(1.5))
        NetFault.config = .init()
        await phone.engine.sync(); await mac.engine.sync()
        await phone.engine.sync(); await mac.engine.sync()
        running = false
        _ = await (r1.value, r2.value)
        let copies = (try phone.context.fetch(FetchDescriptor<Note>()) + mac.context.fetch(FetchDescriptor<Note>()))
            .filter { $0.body.contains("(conflicted copy)") }
        print("PERF both typing: phone \(n.body.debugDescription), mac \(m.body.debugDescription), \(copies.count) conflicted copies")
        #expect(n.body == m.body, "both devices end with the same note")
        // Different places in the note: both sides' typing merges, like Notes, with no copies.
        #expect(n.body == "Top five four three two one\n\nBottom e d c b a\n")
        #expect(copies.isEmpty)
        await phone.engine.stop(); await mac.engine.stop()
    }
}
}
