import Foundation
import SwiftData
import Testing
@testable import Pane

/// Why editAfterTheLockLeavesNoPlaintext failed once (5 Oct): the scenario, run many times, alone
/// and with the stub server reset partway (what another test starting at the same moment did, as
/// every suite on StubSupabase reset the one shared server in its init).
/// Runs only with LOCK_PROBE set: LOCK_PROBE=50 scripts/qa-test.sh PaneTests/NetworkFaults/LockLeakProbeTests
extension NetworkFaults {
@MainActor @Suite(.sealedAccount, .serialized) struct LockLeakProbeTests {
    static let runs = Int(ProcessInfo.processInfo.environment["LOCK_PROBE"] ?? "") ?? 0

    /// The scenario of editAfterTheLockLeavesNoPlaintext, up to the first check. Returns what the
    /// server holds that the account's key opens, and every request body that reached it.
    func scenario(resetAfterLock: Bool, originalTiming: Bool = false) async throws -> (leaked: Bool, payload: String) {
        StubSupabase.reset()
        let suite = LockedNoteSyncTests()
        let mac = try suite.device(), phone = try suite.device()
        let n = mac.context.createNote(in: .all, body: "Bank\n\nPIN 1234")
        await mac.engine.sync()
        await phone.engine.sync()
        let p = try #require(phone.context.note(n.id))
        try await mac.vault.setUp(password: "pw", hint: nil)
        try mac.vault.lock(n)
        await mac.engine.sync()
        if resetAfterLock { StubSupabase.reset() }
        if originalTiming { try await Task.sleep(for: .milliseconds(20)) }
        p.body = "Bank\n\nPIN 1234\nPUK 5678"
        p.updatedAt = originalTiming ? .now : n.updatedAt.addingTimeInterval(1)
        p.dirty = true
        await phone.engine.sync(); await phone.engine.sync()
        let text = try suite.serverText()
        await mac.engine.stop(); await phone.engine.stop()
        let leaked = text.contains("PUK") || text.contains("1234")
        let payload = StubSupabase.requests.joined(separator: "\n") + "\n--- opened with the account's key ---\n" + text
        return (leaked, payload)
    }

    @Test func theScenarioNeverLeaksOnItsOwn() async throws {
        guard Self.runs > 0 else { return }
        var leaks = 0
        for i in 0..<Self.runs {
            let r = try await scenario(resetAfterLock: false)
            if r.leaked {
                leaks += 1
                try? r.payload.write(toFile: NSTemporaryDirectory() + "lock-leak-\(i).txt", atomically: true, encoding: .utf8)
            }
        }
        print("LOCK-PROBE alone: \(leaks) of \(Self.runs) leaked")
        #expect(leaks == 0)
    }

    /// The same with the test's own timing (a 20 ms sleep, then now as the edit time).
    @Test func withTheTestsOwnTiming() async throws {
        guard Self.runs > 0 else { return }
        var leaks = 0
        for i in 0..<Self.runs {
            let r = try await scenario(resetAfterLock: false, originalTiming: true)
            if r.leaked {
                leaks += 1
                try? r.payload.write(toFile: NSTemporaryDirectory() + "lock-leak-timing-\(i).txt", atomically: true, encoding: .utf8)
            }
        }
        print("LOCK-PROBE original timing: \(leaks) of \(Self.runs) leaked")
        #expect(leaks == 0)
    }

    /// The server losing the locked row (another test's reset) makes the phone, which never saw
    /// the lock, push its own unlocked edit: that is the only way the text gets there.
    @Test func aServerThatForgotTheLockIsTheOnlyWayIn() async throws {
        guard Self.runs > 0 else { return }
        let r = try await scenario(resetAfterLock: true)
        try? r.payload.write(toFile: NSTemporaryDirectory() + "lock-leak-reset.txt", atomically: true, encoding: .utf8)
        print("LOCK-PROBE with a reset after the lock: leaked=\(r.leaked)\n\(r.payload)")
        #expect(r.leaked)
    }
}
}
