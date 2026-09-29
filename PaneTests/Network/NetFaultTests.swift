import Foundation
import Testing
@testable import Pane

/// Suites that set the (global) network faults run one at a time.
@Suite(.serialized) enum NetworkFaults {}

extension NetworkFaults {
/// The debug network fault layer itself: launch arguments, and what each fault does to a request.
@Suite struct NetFaultTests {
    @Test func launchArgumentsSetTheFaults() {
        let c = NetFault.Config.parse(["Pane", "-netDelay", "800", "-netJitter", "200", "-netFailRate", "0.3", "-netTimeoutAfter", "5000", "-netOffline"])
        #expect(c.delay == 0.8 && c.jitter == 0.2 && c.failRate == 0.3 && c.offline && c.timeoutAfter == 5)
        #expect(NetFault.Config.parse(["Pane"]) == NetFault.Config())
        #expect(!NetFault.Config.parse(["Pane", "-uitest"]).isActive)
        // Nonsense is clamped, never a crash.
        #expect(NetFault.Config.parse(["Pane", "-netFailRate", "7", "-netDelay", "-5"]).failRate == 1)
        #expect(NetFault.Config.parse(["Pane", "-netDelay"]).delay == 0)
    }

    @Test func outcomes() {
        var c = NetFault.Config()
        #expect(NetFault.outcome(c) == .pass(after: 0))
        c.delay = 1; c.jitter = 0.5
        #expect(NetFault.outcome(c, random: { 0.5 }) == .pass(after: 1.25))
        c.failRate = 0.3
        #expect(NetFault.outcome(c, random: { 0.1 }) == .fail(.networkConnectionLost, after: 1.05))
        c.timeoutAfter = 1.1
        #expect(NetFault.outcome(c, random: { 0.9 }) == .fail(.timedOut, after: 1.1))
        c = NetFault.Config(timeoutAfter: 2)
        #expect(NetFault.outcome(c) == .fail(.timedOut, after: 2), "a timeout on its own hangs every request")
        c.offline = true
        #expect(NetFault.outcome(c) == .fail(.notConnectedToInternet, after: 0))
    }

    enum Got: Equatable { case status(Int), failed(URLError.Code) }

    private func get() async -> (Got, TimeInterval) {
        _ = StubSupabase.client() // points the layer at the stub server
        let session = NetFault.session()
        let start = Date.now
        var req = URLRequest(url: StubSupabase.url.appending(path: "rest/v1/notes"))
        req.httpMethod = "POST"
        req.httpBody = Data(#"{"id":"A","body":"x"}"#.utf8)
        do {
            let (_, r) = try await session.data(for: req)
            return (.status((r as? HTTPURLResponse)?.statusCode ?? 0), Date.now.timeIntervalSince(start))
        } catch let e as URLError {
            return (.failed(e.code), Date.now.timeIntervalSince(start))
        } catch {
            return (.failed(.unknown), Date.now.timeIntervalSince(start))
        }
    }

    @Test func requestsPassWithTheirBodiesAfterTheDelay() async {
        StubSupabase.reset()
        NetFault.config = .init(delay: 0.3)
        defer { NetFault.config = .init() }
        let (r, t) = await get()
        #expect(r == .status(201))
        #expect(t >= 0.3)
        #expect(StubSupabase.rows("notes").first?["body"] as? String == "x")
    }

    @Test func offlineFailsAtOnce() async {
        NetFault.config = .init(offline: true)
        defer { NetFault.config = .init() }
        let (r, t) = await get()
        #expect(r == .failed(.notConnectedToInternet))
        #expect(t < 0.5)
    }

    @Test func failuresAndTimeouts() async {
        StubSupabase.reset()
        NetFault.config = .init(failRate: 1)
        let (dropped, _) = await get()
        #expect(dropped == .failed(.networkConnectionLost))
        NetFault.config = .init(timeoutAfter: 0.2)
        let (hung, t) = await get()
        NetFault.config = .init()
        #expect(hung == .failed(.timedOut))
        #expect(t >= 0.2)
        #expect(StubSupabase.rows("notes").isEmpty, "nothing that failed reached the server")
    }

    @Test func everyRequestIsLogged() async {
        NetFault.config = .init(offline: true)
        defer { NetFault.config = .init() }
        NetFault.resetLog()
        for _ in 0..<3 { _ = await get() }
        #expect(NetFault.started.count == 3)
        #expect(NetFault.rate(over: 10) == 0.3)
    }
}
}
