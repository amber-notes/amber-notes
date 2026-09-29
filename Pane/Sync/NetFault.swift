import Foundation

/// The session every request of the app goes through. Debug builds can put a fault layer in
/// front of it (NetFault), to try the app on a slow or broken connection.
enum AppNetwork {
    static let session: URLSession = {
        #if DEBUG || QA
        if let s = NetFault.sessionFromLaunchArguments() { return s }
        #endif
        return .shared
    }()
}

#if DEBUG || QA
/// Debug-only network faults, set by launch arguments, so the app can be tried on a bad
/// connection without touching the Mac's or the simulator's network settings:
///
///     -netDelay 800        every request waits 800 ms before it goes out
///     -netJitter 400       plus up to 400 ms more, at random
///     -netFailRate 0.3     30 % of requests fail as if the connection dropped
///     -netOffline          every request fails at once: not connected
///     -netTimeoutAfter 5000  a request that would take longer than this fails as timed out
///                          (on its own: every request hangs, then times out)
///
/// Realtime's WebSocket doesn't go through URLProtocol; `-netOffline` keeps it from starting.
final class NetFault: URLProtocol, @unchecked Sendable {
    struct Config: Equatable, Sendable {
        var delay: TimeInterval = 0
        var jitter: TimeInterval = 0
        var failRate: Double = 0
        var offline = false
        var timeoutAfter: TimeInterval?

        var isActive: Bool { delay > 0 || jitter > 0 || failRate > 0 || offline || timeoutAfter != nil }

        static func parse(_ args: [String]) -> Config {
            func number(_ flag: String) -> Double? {
                guard let i = args.firstIndex(of: flag), args.indices.contains(i + 1) else { return nil }
                return Double(args[i + 1])
            }
            var c = Config()
            c.delay = max(0, number("-netDelay") ?? 0) / 1000
            c.jitter = max(0, number("-netJitter") ?? 0) / 1000
            c.failRate = min(1, max(0, number("-netFailRate") ?? 0))
            c.offline = args.contains("-netOffline")
            c.timeoutAfter = number("-netTimeoutAfter").map { max(0, $0) / 1000 }
            return c
        }
    }

    /// What happens to one request.
    enum Outcome: Equatable {
        case pass(after: TimeInterval)
        case fail(URLError.Code, after: TimeInterval)
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var _config = Config.parse(ProcessInfo.processInfo.arguments)
    nonisolated(unsafe) private static var _forward = URLSessionConfiguration.default
    nonisolated(unsafe) private static var _inner: URLSession?
    nonisolated(unsafe) private static var _started: [(Date, String)] = []

    static var config: Config {
        get { lock.withLock { _config } }
        set { lock.withLock { _config = newValue } }
    }

    /// Where requests that get through are sent: the real network, or a stub server in tests.
    static var forward: URLSessionConfiguration {
        get { lock.withLock { _forward } }
        set { lock.withLock { _forward = newValue; _inner = nil } }
    }

    /// When each request started, and its path: to check nothing retries in a tight loop.
    static var started: [(Date, String)] { lock.withLock { _started } }
    static func resetLog() { lock.withLock { _started = [] } }

    /// Requests per second over the last `window` seconds.
    static func rate(over window: TimeInterval) -> Double {
        let since = Date.now.addingTimeInterval(-window)
        return Double(started.filter { $0.0 >= since }.count) / window
    }

    static func sessionFromLaunchArguments() -> URLSession? {
        config.isActive ? session() : nil
    }

    /// A session whose requests go through the fault layer.
    static func session() -> URLSession {
        let c = URLSessionConfiguration.default
        c.protocolClasses = [NetFault.self] + (c.protocolClasses ?? [])
        return URLSession(configuration: c)
    }

    /// Rolls the dice for one request. `random` is in 0..<1.
    static func outcome(_ c: Config, random: () -> Double = { Double.random(in: 0..<1) }) -> Outcome {
        if c.offline { return .fail(.notConnectedToInternet, after: 0) }
        let latency = c.delay + (c.jitter > 0 ? c.jitter * random() : 0)
        if let limit = c.timeoutAfter, c.delay == 0 && c.jitter == 0 || latency > limit {
            return .fail(.timedOut, after: limit)
        }
        if c.failRate > 0, random() < c.failRate { return .fail(.networkConnectionLost, after: latency) }
        return .pass(after: latency)
    }

    private static var inner: URLSession {
        lock.withLock {
            if let s = _inner { return s }
            let s = URLSession(configuration: _forward)
            _inner = s
            return s
        }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let scheme = request.url?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private let state = NSLock()
    private var stopped = false
    private var inFlight: URLSessionDataTask?

    override func startLoading() {
        Self.lock.withLock { Self._started.append((.now, request.url?.path ?? "")) }
        let outcome = Self.outcome(Self.config)
        let wait: TimeInterval
        switch outcome {
        case .pass(let t), .fail(_, let t): wait = t
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + wait) { [self] in
            guard !state.withLock({ stopped }) else { return }
            switch outcome {
            case .fail(let code, _):
                client?.urlProtocol(self, didFailWithError: URLError(code))
            case .pass:
                send()
            }
        }
    }

    private func send() {
        // Streamed bodies (uploads) arrive as a stream; the inner session needs them as data.
        var req = request
        if req.httpBody == nil, let stream = req.httpBodyStream {
            req.httpBodyStream = nil
            req.httpBody = Self.read(stream)
        }
        let t = Self.inner.dataTask(with: req) { [self] data, response, error in
            guard !state.withLock({ stopped }) else { return }
            if let error {
                client?.urlProtocol(self, didFailWithError: error)
                return
            }
            if let response { client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed) }
            if let data { client?.urlProtocol(self, didLoad: data) }
            client?.urlProtocolDidFinishLoading(self)
        }
        state.withLock { inFlight = t }
        t.resume()
    }

    override func stopLoading() {
        state.withLock {
            stopped = true
            inFlight?.cancel()
        }
    }

    static func read(_ stream: InputStream) -> Data {
        var data = Data()
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
#endif
