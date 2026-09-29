import Foundation
import Supabase
@testable import Pane

/// A tiny in-memory stand-in for the Supabase REST API the sync engine uses (notes, folders,
/// attachments, and RPCs that just answer), so sync can be tested on a faulty network without
/// the local stack. Rows are JSON dictionaries; the "server" sets `version` and
/// `server_updated_at` the way the real triggers do.
final class StubSupabase: URLProtocol, @unchecked Sendable {
    static let url = URL(string: "https://stub.supabase.test")!
    private static let lock = NSLock()
    nonisolated(unsafe) private static var tables: [String: [[String: Any]]] = [:]
    nonisolated(unsafe) private static var clock = Date.now
    nonisolated(unsafe) private static var _requests: [String] = []

    nonisolated(unsafe) private static var _tooFast = false
    /// Writes are refused with PostgREST's "too many requests".
    static var tooFast: Bool {
        get { lock.withLock { _tooFast } }
        set { lock.withLock { _tooFast = newValue } }
    }

    static func reset() {
        lock.withLock { tables = [:]; _requests = []; _tooFast = false }
    }

    /// "METHOD /path?query" of every request that reached the server.
    static var requests: [String] { lock.withLock { _requests } }

    static func rows(_ table: String) -> [[String: Any]] { lock.withLock { tables[table] ?? [] } }

    static func note(_ id: UUID) -> [String: Any]? {
        rows("notes").first { ($0["id"] as? String)?.lowercased() == id.uuidString.lowercased() }
    }

    /// Another device (or an AI) changes a note on the server.
    static func edit(_ id: UUID, body: String, updatedAt: Date = .now, aiEditor: String? = nil) {
        lock.withLock {
            guard var list = tables["notes"], let i = list.firstIndex(where: { ($0["id"] as? String)?.lowercased() == id.uuidString.lowercased() }) else { return }
            var r = list[i]
            r["body"] = body
            r["updated_at"] = stamp(updatedAt)
            if let aiEditor { r["ai_editor"] = aiEditor; r["ai_edited_at"] = stamp(.now) }
            bump(&r)
            list[i] = r
            tables["notes"] = list
        }
    }

    /// A client whose requests go through the fault layer, then here.
    static func client() -> SupabaseClient {
        let forward = URLSessionConfiguration.ephemeral
        forward.protocolClasses = [StubSupabase.self]
        NetFault.forward = forward
        return SupabaseClient(
            supabaseURL: url,
            supabaseKey: "stub-key",
            options: SupabaseClientOptions(
                auth: .init(storage: MemoryAuthStorage(), emitLocalSessionAsInitialSession: true),
                global: .init(session: NetFault.session())
            )
        )
    }

    // MARK: Serving

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == url.host }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let (status, body) = Self.handle(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func handle(_ request: URLRequest) -> (Int, Data) {
        let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
        let method = request.httpMethod ?? "GET"
        lock.withLock { _requests.append("\(method) \(comps.path)?\(comps.query ?? "")") }
        let path = comps.path
        guard path.hasPrefix("/rest/v1/") else { return (404, Data("{}".utf8)) }
        let name = String(path.dropFirst("/rest/v1/".count))
        if name.hasPrefix("rpc/") { return (200, Data("null".utf8)) }
        let query = comps.queryItems ?? []
        var body = request.httpBody
        if body == nil, let s = request.httpBodyStream { body = NetFault.read(s) }
        if method != "GET", tooFast {
            return (429, Data(#"{"code":"PT429","message":"Too many changes too quickly."}"#.utf8))
        }
        return lock.withLock { () -> (Int, Data) in
            var list = tables[name] ?? []
            let matches = { (r: [String: Any]) in filters(query).allSatisfy { $0(r) } }
            switch method {
            case "GET":
                var out = list.filter(matches)
                out.sort { (($0["server_updated_at"] as? String) ?? "", ($0["id"] as? String) ?? "") < (($1["server_updated_at"] as? String) ?? "", ($1["id"] as? String) ?? "") }
                let offset = query.first { $0.name == "offset" }.flatMap { Int($0.value ?? "") } ?? 0
                let limit = query.first { $0.name == "limit" }.flatMap { Int($0.value ?? "") } ?? out.count
                out = Array(out.dropFirst(offset).prefix(limit))
                return (200, json(out))
            case "POST":
                let prefer = request.value(forHTTPHeaderField: "Prefer") ?? ""
                let incoming = decodeRows(body)
                var out: [[String: Any]] = []
                for var r in incoming {
                    r["id"] = (r["id"] as? String)?.lowercased()
                    if let i = list.firstIndex(where: { $0["id"] as? String == r["id"] as? String }) {
                        if prefer.contains("ignore-duplicates") { continue }
                        var merged = list[i]
                        for (k, v) in r { merged[k] = v }
                        bump(&merged)
                        list[i] = merged
                        out.append(merged)
                    } else {
                        r["version"] = 0
                        bump(&r)
                        list.append(r)
                        out.append(r)
                    }
                }
                tables[name] = list
                return (201, json(out))
            case "PATCH":
                let patch = decodeRows(body).first ?? [:]
                var out: [[String: Any]] = []
                for i in list.indices where matches(list[i]) {
                    for (k, v) in patch { list[i][k] = v }
                    bump(&list[i])
                    out.append(list[i])
                }
                tables[name] = list
                return (200, json(out))
            default:
                return (405, Data("{}".utf8))
            }
        }
    }

    private static func bump(_ r: inout [String: Any]) {
        r["version"] = ((r["version"] as? Int) ?? 0) + 1
        clock = max(clock.addingTimeInterval(0.001), .now)
        r["server_updated_at"] = stamp(clock)
    }

    static func stamp(_ d: Date) -> String {
        d.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    private static func filters(_ items: [URLQueryItem]) -> [([String: Any]) -> Bool] {
        items.compactMap { item in
            guard let v = item.value, !["select", "order", "offset", "limit", "on_conflict", "columns"].contains(item.name) else { return nil }
            let key = item.name
            if v.hasPrefix("eq.") {
                let want = String(v.dropFirst(3)).lowercased()
                return { r in
                    guard let x = r[key] else { return false }
                    return "\(x)".lowercased() == want
                }
            }
            if v.hasPrefix("gt.") {
                let raw = String(v.dropFirst(3))
                let want = parse(raw)
                return { r in
                    guard let s = r[key] as? String, let d = parse(s) else { return false }
                    return d > (want ?? .distantPast)
                }
            }
            return nil
        }
    }

    private static func parse(_ s: String) -> Date? {
        if let d = try? Date(s, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return d }
        return try? Date(s, strategy: Date.ISO8601FormatStyle())
    }

    private static func decodeRows(_ data: Data?) -> [[String: Any]] {
        guard let data, let o = try? JSONSerialization.jsonObject(with: data) else { return [] }
        if let a = o as? [[String: Any]] { return a }
        if let d = o as? [String: Any] { return [d] }
        return []
    }

    private static func json(_ rows: [[String: Any]]) -> Data {
        (try? JSONSerialization.data(withJSONObject: rows)) ?? Data("[]".utf8)
    }
}

/// Auth storage that forgets everything: tests never touch the Keychain.
final class MemoryAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private var values: [String: Data] = [:]
    private let lock = NSLock()
    func store(key: String, value: Data) throws { lock.withLock { values[key] = value } }
    func retrieve(key: String) throws -> Data? { lock.withLock { values[key] } }
    func remove(key: String) throws { lock.withLock { _ = values.removeValue(forKey: key) } }
}
