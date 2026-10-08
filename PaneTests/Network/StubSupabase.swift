import CryptoKit
import Foundation
import Supabase
import Testing
@testable import Pane

/// A test's own account key, for the sync engine and whatever it starts (see `Wire.testSealer`).
/// Task-local, so suites running side by side never share one.
struct SealedAccount: SuiteTrait, TestTrait, TestScoping {
    static let user = UUID(uuidString: "5E1F0000-0000-4000-8000-00000000A11C")!
    var isRecursive: Bool { true }

    func provideScope(for test: Test, testCase: Test.Case?, performing function: @Sendable () async throws -> Void) async throws {
        // The suite's scope is entered too; the key is made per test (or test case).
        guard testCase != nil || !test.isSuite else { try await function(); return }
        try await Wire.$testSealer.withValue(Sealer(key: SymmetricKey(size: .bits256), user: Self.user)) {
            // And its own memory of stopped links.
            try await RevokedShares.$testStore.withValue(MemoryStoppedShares()) { try await function() }
        }
    }
}

extension Trait where Self == SealedAccount {
    /// Sync with an account key of its own: everything on the wire is sealed with it.
    static var sealedAccount: Self { .init() }
}

/// A tiny in-memory stand-in for the Supabase REST API the sync engine uses (notes, folders,
/// attachments, RPCs and the files bucket), so sync can be tested on a faulty network without
/// the local stack. Rows are JSON dictionaries; the "server" sets `version` and
/// `server_updated_at` the way the real triggers do. Text columns hold sealed boxes, as on the
/// real server.
final class StubSupabase: URLProtocol, @unchecked Sendable {
    static let url = URL(string: "https://stub.supabase.test")!
    private static let lock = NSLock()
    nonisolated(unsafe) private static var tables: [String: [[String: Any]]] = [:]
    nonisolated(unsafe) private static var clock = Date.now
    nonisolated(unsafe) private static var _requests: [String] = []
    nonisolated(unsafe) private static var _requestTimes: [Date] = []
    nonisolated(unsafe) private static var _bodies: [String] = []
    nonisolated(unsafe) private static var _objects: [String: Data] = [:]
    nonisolated(unsafe) private static var _rpcCalls: [(name: String, params: [String: Any])] = []
    nonisolated(unsafe) private static var _rpcAnswers: [String: @Sendable ([String: Any]) -> Any] = [:]

    nonisolated(unsafe) private static var _tooFast = false
    /// Writes are refused with PostgREST's "too many requests".
    static var tooFast: Bool {
        get { lock.withLock { _tooFast } }
        set { lock.withLock { _tooFast = newValue } }
    }

    nonisolated(unsafe) private static var _account: String?
    /// Row-level security, for tests that switch accounts: the account making the requests sees and
    /// changes only its own rows, and writing over another account's row is refused (42501), as on
    /// the real server. Nil (the default): one account, every row visible.
    static var account: UUID? {
        get { lock.withLock { _account.flatMap(UUID.init(uuidString:)) } }
        set { lock.withLock { _account = newValue?.uuidString.lowercased() } }
    }

    nonisolated(unsafe) private static var _sessionLifetime: TimeInterval = 3600
    nonisolated(unsafe) private static var _refusesRefresh = false
    nonisolated(unsafe) private static var _failing: [(method: String, path: String, skip: Int, applied: Bool)] = []

    /// How long a session from the auth endpoint lasts; below zero it's expired as it's handed out.
    static var sessionLifetime: TimeInterval {
        get { lock.withLock { _sessionLifetime } }
        set { lock.withLock { _sessionLifetime = newValue } }
    }

    /// The auth server refuses a refresh token (signed out elsewhere, or it expired).
    static var refusesRefresh: Bool {
        get { lock.withLock { _refusesRefresh } }
        set { lock.withLock { _refusesRefresh = newValue } }
    }

    /// The next request with this method whose path ends with `path` (after `skip` of them) fails
    /// as the connection drops: after the server applied it and before the answer came back, or
    /// (`applied: false`) before it reached the server.
    static func loseAnswer(_ method: String, _ path: String, skip: Int = 0, applied: Bool = true) {
        lock.withLock { _failing.append((method, path, skip, applied)) }
    }

    static func reset() {
        lock.withLock {
            tables = [:]; _requests = []; _requestTimes = []; _bodies = []; _objects = [:]; _rpcCalls = []; _rpcAnswers = [:]; _tooFast = false
            _sessionLifetime = 3600; _refusesRefresh = false; _failing = []; _account = nil
        }
    }

    /// Forgets the requests and bodies seen so far; the tables stay.
    static func resetLog() { lock.withLock { _requests = []; _bodies = [] } }

    /// "METHOD /path?query" of every request that reached the server.
    static var requests: [String] { lock.withLock { _requests } }
    /// Each request with when it reached the server, in order.
    static var timedRequests: [(request: String, at: Date)] { lock.withLock { Array(zip(_requests, _requestTimes)) } }
    /// Every request body that reached the server, as text (bytes that aren't text come out as
    /// replacement characters).
    static var bodies: [String] { lock.withLock { _bodies } }
    /// The files bucket: path → bytes, as uploaded.
    static var objects: [String: Data] { lock.withLock { _objects } }
    /// RPCs called, with their parameters.
    static var rpcCalls: [(name: String, params: [String: Any])] { lock.withLock { _rpcCalls } }

    /// What an RPC answers (JSON-serializable); unset ones answer null.
    static func answer(_ rpc: String, with body: @escaping @Sendable ([String: Any]) -> Any) {
        lock.withLock { _rpcAnswers[rpc] = body }
    }

    static func rows(_ table: String) -> [[String: Any]] { lock.withLock { tables[table] ?? [] } }

    /// Puts a row in a table as the server would have it (for tables the app only reads).
    static func insert(_ table: String, _ row: [String: Any]) { lock.withLock { tables[table, default: []].append(row) } }

    static func note(_ id: UUID) -> [String: Any]? {
        rows("notes").first { ($0["id"] as? String)?.lowercased() == id.uuidString.lowercased() }
    }

    /// A note's text on the server, opened with the test's key.
    static func body(_ id: UUID) -> String? {
        (note(id)?["body_ct"] as? String).flatMap { Wire.sealer?.open($0, context: E2EE.body(id)) }
    }

    /// Another device (or an AI) changes a note on the server, sealing it with the test's key.
    static func edit(_ id: UUID, body: String, updatedAt: Date = .now, aiEditor: String? = nil) {
        let box = Wire.sealer?.seal(body, context: E2EE.body(id))
        let head = Wire.sealer?.sealHead(.of(body), note: id)
        lock.withLock {
            guard var list = tables["notes"], let i = list.firstIndex(where: { ($0["id"] as? String)?.lowercased() == id.uuidString.lowercased() }) else { return }
            var r = list[i]
            r["body_ct"] = box
            r["head_ct"] = head
            r["updated_at"] = stamp(updatedAt)
            if let aiEditor { r["ai_editor"] = aiEditor; r["ai_edited_at"] = stamp(.now) }
            bump(&r)
            list[i] = r
            tables["notes"] = list
        }
    }

    /// A client whose requests go through the fault layer, then here.
    /// `storage`: where the session is kept; pass the same one to a second client to launch again.
    static func client(storage: AuthLocalStorage = MemoryAuthStorage()) -> SupabaseClient {
        let forward = URLSessionConfiguration.ephemeral
        forward.protocolClasses = [StubSupabase.self]
        NetFault.forward = forward
        return SupabaseClient(
            supabaseURL: url,
            supabaseKey: "stub-key",
            options: SupabaseClientOptions(
                auth: .init(storage: storage, autoRefreshToken: false, emitLocalSessionAsInitialSession: true),
                global: .init(session: NetFault.session())
            )
        )
    }

    // MARK: Serving

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == url.host }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let path = request.url?.path ?? ""
        let lost = Self.lock.withLock { () -> (applied: Bool, Void)? in
            guard let i = Self._failing.firstIndex(where: { $0.method == (request.httpMethod ?? "GET") && path.hasSuffix($0.path) }) else { return nil }
            if Self._failing[i].skip > 0 { Self._failing[i].skip -= 1; return nil }
            return (Self._failing.remove(at: i).applied, ())
        }
        if let lost {
            if lost.applied { _ = Self.handle(request) }
            client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            return
        }
        let (status, body) = Self.handle(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func handle(_ request: URLRequest) -> (Int, Data) {
        let comps = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
        let method = request.httpMethod ?? "GET"
        var body = request.httpBody
        if body == nil, let s = request.httpBodyStream { body = NetFault.read(s) }
        lock.withLock {
            _requests.append("\(method) \(comps.path)?\(comps.query ?? "")")
            _requestTimes.append(.now)
            if let body { _bodies.append(String(decoding: body, as: UTF8.self)) }
        }
        let path = comps.path
        if path == "/auth/v1/token" { return token(grant: comps.queryItems?.first { $0.name == "grant_type" }?.value) }
        if path.hasPrefix("/storage/v1/object/") { return storage(method, String(path.dropFirst("/storage/v1/object/".count)), request, body) }
        guard path.hasPrefix("/rest/v1/") else { return (404, Data("{}".utf8)) }
        let name = String(path.dropFirst("/rest/v1/".count))
        if name.hasPrefix("rpc/") {
            let rpc = String(name.dropFirst(4))
            let params = (body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
            let answer = lock.withLock { () -> (@Sendable ([String: Any]) -> Any)? in
                _rpcCalls.append((rpc, params))
                return _rpcAnswers[rpc]
            }
            guard let answer else { return (200, Data("null".utf8)) }
            let value = answer(params)
            return (200, (try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)) ?? Data("null".utf8))
        }
        let query = comps.queryItems ?? []
        if method != "GET", tooFast {
            return (429, Data(#"{"code":"PT429","message":"Too many changes too quickly."}"#.utf8))
        }
        return lock.withLock { () -> (Int, Data) in
            var list = tables[name] ?? []
            let mine = { (r: [String: Any]) in _account == nil || r["_owner"] as? String == _account }
            let matches = { (r: [String: Any]) in mine(r) && filters(query).allSatisfy { $0(r) } }
            // As the server's triggers do (pane_over('not_yours')): a row can only point at a folder
            // or a parent note the server already has.
            if method == "POST" || method == "PATCH", let missing = danglingReference(name, decodeRows(body)) {
                return (400, Data(#"{"code":"PT413","message":"That folder or note doesn't exist.","hint":"not_yours","details":"\#(missing)"}"#.utf8))
            }
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
                        if !mine(list[i]) {
                            return (403, Data(#"{"code":"42501","message":"new row violates row-level security policy"}"#.utf8))
                        }
                        if prefer.contains("ignore-duplicates") { continue }
                        var merged = list[i]
                        for (k, v) in r { merged[k] = v }
                        bump(&merged)
                        list[i] = merged
                        out.append(merged)
                    } else {
                        r["version"] = 0
                        if let owner = _account { r["_owner"] = owner }
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

    /// Auth: a password sign-in or a refresh hands out a session for the test's account.
    private static func token(grant: String?) -> (Int, Data) {
        if grant == "refresh_token", refusesRefresh {
            return (400, Data(#"{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}"#.utf8))
        }
        let lifetime = sessionLifetime
        let expires = Date.now.addingTimeInterval(lifetime)
        func b64(_ o: [String: Any]) -> String {
            (try! JSONSerialization.data(withJSONObject: o)).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }
        let user = SealedAccount.user.uuidString.lowercased()
        let jwt = b64(["alg": "HS256", "typ": "JWT"]) + "." + b64(["sub": user, "exp": Int(expires.timeIntervalSince1970), "role": "authenticated"]) + ".sig"
        let now = stamp(.now)
        let session: [String: Any] = [
            "access_token": jwt, "token_type": "bearer", "expires_in": Int(lifetime), "expires_at": expires.timeIntervalSince1970,
            "refresh_token": "refresh-\(UUID().uuidString)",
            "user": ["id": user, "aud": "authenticated", "role": "authenticated", "email": "qa@example.com",
                     "app_metadata": [:] as [String: Any], "user_metadata": [:] as [String: Any], "created_at": now, "updated_at": now],
        ]
        return (200, (try? JSONSerialization.data(withJSONObject: session)) ?? Data("{}".utf8))
    }

    /// The first folder or parent note a row points at that the server doesn't have. Under `lock`.
    private static func danglingReference(_ table: String, _ rows: [[String: Any]]) -> String? {
        func has(_ t: String, _ id: Any?) -> Bool {
            guard let id = (id as? String)?.lowercased() else { return true }   // none, or null
            return (tables[t] ?? []).contains { ($0["id"] as? String)?.lowercased() == id && (_account == nil || $0["_owner"] as? String == _account) }
                || rows.contains { ($0["id"] as? String)?.lowercased() == id && t == table }
        }
        for r in rows {
            if table == "notes" || table == "attachments" || table == "folders" {
                let folderKey = table == "folders" ? "parent_id" : "folder_id"
                if !has("folders", r[folderKey]) { return "folder" }
            }
            if table == "notes", !has("notes", r["parent_id"]) { return "parent" }
        }
        return nil
    }

    /// The files bucket: uploads (multipart) and downloads by path.
    private static func storage(_ method: String, _ rest: String, _ request: URLRequest, _ body: Data?) -> (Int, Data) {
        guard rest.hasPrefix("files/") else { return (404, Data("{}".utf8)) }
        let key = String(rest.dropFirst("files/".count))
        switch method {
        case "POST", "PUT":
            guard let bytes = fileBytes(request, body) else { return (400, Data(#"{"statusCode":"400","message":"no file"}"#.utf8)) }
            lock.withLock { _objects[key] = bytes }
            return (200, Data(#"{"Key":"files/\#(key)","Id":"\#(UUID().uuidString)"}"#.utf8))
        case "GET":
            guard let bytes = lock.withLock({ _objects[key] }) else { return (400, Data(#"{"statusCode":"404","message":"Object not found"}"#.utf8)) }
            return (200, bytes)
        default:
            return (405, Data("{}".utf8))
        }
    }

    /// The file part of a multipart upload.
    private static func fileBytes(_ request: URLRequest, _ body: Data?) -> Data? {
        guard let body, let type = request.value(forHTTPHeaderField: "Content-Type"),
              let b = type.components(separatedBy: "boundary=").last?.trimmingCharacters(in: CharacterSet(charactersIn: "\"")) else { return nil }
        let boundary = Data("--\(b)".utf8), gap = Data("\r\n\r\n".utf8)
        var parts: [Data] = []
        var start = body.startIndex
        while let r = body.range(of: boundary, in: start ..< body.endIndex) {
            if r.lowerBound > start { parts.append(body.subdata(in: start ..< r.lowerBound)) }
            start = r.upperBound
        }
        for part in parts {
            guard let g = part.range(of: gap) else { continue }
            let head = String(decoding: part.subdata(in: part.startIndex ..< g.lowerBound), as: UTF8.self)
            guard head.contains("filename=") else { continue }
            var content = part.subdata(in: g.upperBound ..< part.endIndex)
            if content.suffix(2) == Data("\r\n".utf8) { content.removeLast(2) }
            return content
        }
        return nil
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
            if v.hasPrefix("in.("), v.hasSuffix(")") {
                let want = Set(v.dropFirst(4).dropLast().split(separator: ",").map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")).lowercased() })
                return { r in r[key].map { want.contains("\($0)".lowercased()) } ?? false }
            }
            if v.lowercased() == "is.null" {
                return { r in r[key] == nil || r[key] is NSNull }
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
