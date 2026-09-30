import LocalAuthentication
import Observation
import Supabase
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Connecting an AI to Amber Notes.
//
// ChatGPT and Claude sign in with OAuth: they send the person's browser to the MCP server's
// /authorize, which opens ambernotes.app/connect?request=<id>. That page hands over to the app,
// by https://ambernotes.app/open/connect?request=<id> or ambernotes://connect?request=<id>. The
// app (already signed in) shows who's asking, the person allows read-only or read and edit with
// Face ID or Touch ID, and the app sends the browser on to the AI with the result.
//
// The notes are end-to-end encrypted, so approving hands the AI a copy of the account's key: the
// app makes the authorization code itself and sends the server only its hash and the key wrapped
// under it. The server's answer is the AI's return address without a code; the app adds it.
// Claude Code and Codex get a pane_ token made here the same way, used only in a request header.

// MARK: Pure pieces (tested)

enum ConnectLink {
    static let scheme = "ambernotes"
    /// The site's universal link for the same thing: https://ambernotes.app/open/connect?request=<uuid>.
    static let webHosts: Set<String> = ["ambernotes.app", "www.ambernotes.app"]
    static let webPath = "/open/connect"

    /// The request id in ambernotes://connect?request=<uuid> or its universal link, if this is one.
    static func requestID(from url: URL) -> UUID? {
        let scheme = url.scheme?.lowercased(), host = url.host?.lowercased() ?? ""
        let custom = scheme == Self.scheme && host == "connect"
        let web = scheme == "https" && webHosts.contains(host) && url.path == webPath
        guard custom || web, let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let raw = comps.queryItems?.first(where: { $0.name == "request" })?.value else { return nil }
        return UUID(uuidString: raw)
    }
}

enum ConnectTrust {
    /// Where known AI apps receive their sign-in, host only: enough for a connection that already
    /// exists (the server kept where it was sent), never for a mark on the consent sheet.
    static let knownHosts: [String: String] = [
        "chatgpt.com": "ChatGPT",
        "chat.openai.com": "ChatGPT",
        "claude.ai": "Claude",
        "claude.com": "Claude",
    ]

    /// The exact addresses where ChatGPT and Claude receive their sign-in, as on the server
    /// (oauth.ts KNOWN_CALLBACKS) and the web consent page. Only a request that returns to one of
    /// these may show that AI's name and mark.
    static let knownCallbacks: [String: String] = [
        "https://chatgpt.com/connector_platform_oauth_redirect": "ChatGPT",
        "https://platform.openai.com/apps-manage/oauth": "ChatGPT",
        "https://claude.ai/api/mcp/auth_callback": "Claude",
        "https://claude.com/api/mcp/auth_callback": "Claude",
    ]

    /// Who will receive access, in words for the consent sheet.
    static func destination(host: String, loopback: Bool) -> String {
        if loopback { return "an app on this computer" }
        return host
    }

    /// The AI whose name and mark the consent sheet may show: decided only by the exact address the
    /// approval is sent to, never by the name a client registered. Anyone can call themselves
    /// "ChatGPT"; only ChatGPT receives answers at its callback. A server too old to send the
    /// address verifies nothing.
    static func verifiedAI(redirectURI: String?) -> String? {
        redirectURI.flatMap { knownCallbacks[$0] }
    }

    /// The AI behind an existing connection, by the exact host its approval went to.
    static func verifiedAI(host: String, loopback: Bool) -> String? {
        loopback ? nil : knownHosts[host.lowercased()]
    }
}

enum ConnectSnippets {
    static func claudeCode(url: String, token: String) -> String {
        "claude mcp add --scope user --transport http amber-notes \(url) --header \"Authorization: Bearer \(token)\""
    }

    static func codex(url: String, token: String) -> String {
        "[mcp_servers.amber_notes]\nurl = \"\(url)\"\nhttp_headers = { \"Authorization\" = \"Bearer \(token)\" }"
    }
}

/// Knowing when a guided connection worked, wherever the person approved it.
enum ConnectCompletion {
    /// The newest ChatGPT or Claude sign-in made since the guide opened, if any. Named by where
    /// its answers went, never by the name the client registered, like the consent sheet.
    static func newConnection(_ rows: [Connection], ai: String, since: Date) -> Connection? {
        rows.filter { c in
            c.isOAuth && c.revoked_at == nil && c.created_at >= since
                && ConnectTrust.verifiedAI(host: c.redirect_host ?? "", loopback: false) == ai
        }
        .max { $0.created_at < $1.created_at }
    }
}

// MARK: Server calls

struct ConnectRequest: Decodable, Identifiable, Equatable {
    let id: UUID
    let client_name: String
    let redirect_host: String
    /// The exact return address. It decides whether an AI's mark shows, and goes back to the
    /// server unchanged with the answer, so what you approved is where the code goes.
    var redirect_uri: String? = nil
    /// What an unverified app calls itself, made plain ASCII by the server; never a title.
    var claimed_name: String? = nil
    let loopback: Bool
    let wants_write: Bool
    /// Asked from a browser (anywhere) that waits for this account's devices to approve: the code
    /// goes to that page, sealed to its key, and this device opens nothing.
    var asked: Bool? = nil
    var started_at: Date? = nil
    /// What the page says it is, e.g. "Chrome on a Mac".
    var started_from: String? = nil
    /// The client's `state` and the issuer (`iss`) the server adds to the return address: a device
    /// that hands the code to a browser builds that address itself and seals it with the code.
    var state: String? = nil
    var iss: String? = nil

    var isAsked: Bool { asked == true }

    /// "Requested 2 minutes ago from Chrome on a Mac", for a request asked from a browser.
    func requestedLine(now: Date = .now) -> String? {
        guard isAsked else { return nil }
        let from = started_from.flatMap { $0.isEmpty ? nil : $0 } ?? "a web browser"
        guard let started_at else { return "Requested from \(from)" }
        let when = now.timeIntervalSince(started_at) < 60 ? "just now"
            : started_at.formatted(.relative(presentation: .numeric, unitsStyle: .wide))
        return "Requested \(when) from \(from)"
    }

    /// The AI this request provably comes from, if any. Never for a request asked from a
    /// browser: anyone can start one with ChatGPT's return address, and the page that waits for
    /// the answer is whoever asked, so only the number the page shows ties it to the person.
    var verifiedAI: String? { isAsked ? nil : ConnectTrust.verifiedAI(redirectURI: redirect_uri) }
    /// Who's asking, as the sheet names it: the verified AI, or else where access goes.
    var who: String { verifiedAI ?? ConnectTrust.destination(host: redirect_host, loopback: loopback) }
    /// The name an unverified app gave itself, shown only as a secondary claim, and only as the
    /// server's plain-ASCII version of it.
    var claimedName: String? { verifiedAI == nil ? claimed_name.flatMap { $0.isEmpty ? nil : $0 } : nil }

    /// Where the browser that asked goes with the code: the return address with `state` and
    /// `iss`, exactly as the server builds it. Nil when the server didn't say (too old).
    var handoffRedirect: String? {
        guard let redirect_uri, let iss else { return nil }
        return ConnectAPI.clientRedirect(redirect_uri, state: state, iss: iss)
    }
}

/// Number matching for a request asked from a browser, commit then reveal (`E2EE.matchCommit`,
/// `E2EE.matchNumber`). The page committed to its key and a nonce when it asked; this device writes
/// its own nonce (once), the page then reveals its nonce, and this device checks the reveal opens
/// the commit before it shows anything. The page shows two digits made from its key, both nonces
/// and the request; the person types what the page shows. A key swapped on the way (by anyone who
/// can write the ask) was committed before this device's nonce existed, so it can't be ground to
/// give the same digits.
enum ConnectMatch {
    enum Check: Equatable {
        /// This device's nonce isn't on the ask yet, or the page hasn't revealed its nonce.
        case waiting
        /// The ask carries another device's nonce: that device answers it.
        case otherDevice
        /// The page's reveal doesn't open its commit, or the ask is malformed. Never shows a number.
        case broken
        /// The two digits the page shows, if it's the page that committed.
        case number(String)
    }

    /// What the ask says now, checked against the nonce this device wrote.
    static func check(_ row: ConnectAskMatch, deviceNonce: Data, requestID: UUID) -> Check {
        guard let key = row.browserKey, key.count == 65, row.match_commit.count == 64 else { return .broken }
        guard let written = row.device_nonce else { return .waiting }
        guard written == E2EE.hex(deviceNonce) else { return .otherDevice }
        guard let revealed = row.page_nonce else { return .waiting }
        guard let pageNonce = E2EE.fromHex(revealed), pageNonce.count == 16,
              E2EE.commitOpens(row.match_commit, browserKey: key, pageNonce: pageNonce) else { return .broken }
        return .number(E2EE.matchNumber(browserKey: key, pageNonce: pageNonce, deviceNonce: deviceNonce, requestID: requestID))
    }

    /// The nonce this device writes for a request: made once, and the same when the sheet shows it
    /// again (the server takes the first one written).
    @MainActor static func deviceNonce(for request: UUID) -> Data {
        if let n = nonces[request] { return n }
        let n = E2EE.randomBytes(16)
        nonces[request] = n
        return n
    }

    @MainActor private static var nonces: [UUID: Data] = [:]

    /// Two digits typed on the keypad: a digit adds (up to two), delete takes the last one off.
    static func typing(_ typed: String, _ key: String) -> String {
        if key == "delete" { return String(typed.dropLast()) }
        guard key.count == 1, key.allSatisfy(\.isASCIIDigit), typed.count < 2 else { return typed }
        return typed + key
    }
}

/// What the sheet says about number matching.
enum ConnectMatchCopy {
    static let wrongNumber = "That isn't the number your browser shows, so the request was declined. "
        + "If you didn't start it, someone who knows your password tried to connect an AI. Change your password."
    static let broken = "Your browser's request changed after it was made, so it was declined. Start connecting again in your browser."
    static let otherDevice = "Another of your devices is answering this request. Finish it there."
    static let expired = "This request expired. Start connecting again in your browser."
    static let changed = "The page in your browser changed. Start connecting again in your browser."
}

private extension Character {
    var isASCIIDigit: Bool { ("0" ... "9").contains(self) }
}

enum ConnectAPI {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// One call to the MCP server's /connect endpoints: path, method, JSON body → response body.
    typealias Send = @Sendable (_ path: String, _ method: String, _ body: [String: Any]?) async throws -> Data

    /// The app's session goes in a header, never in the address.
    static func sender(_ client: SupabaseClient) -> Send {
        { path, method, body in
            guard let base = BackendConfig.mcpURL else { throw Failure(message: "Sync is off in this build.") }
            let jwt = try await client.auth.session.accessToken
            var req = URLRequest(url: URL(string: base.absoluteString + path)!)
            req.httpMethod = method
            req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
            if let body {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, response) = try await AppNetwork.session.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                throw Failure(message: message ?? "Couldn't reach Amber Notes. Check your connection.")
            }
            return data
        }
    }

    static func request(_ client: SupabaseClient, id: UUID) async throws -> ConnectRequest {
        try await request(id: id, send: sender(client))
    }

    static func request(id: UUID, send: Send) async throws -> ConnectRequest {
        let data = try await send("/connect/request?id=\(id.uuidString.lowercased())", "GET", nil)
        return try AnyJSON.decoder.decode(ConnectRequest.self, from: data)
    }

    /// What happens after an answer.
    enum Answer: Equatable {
        /// Send the browser here (the request came by link on this device).
        case open(URL)
        /// A browser elsewhere asked: it picks the answer up itself, and this device opens nothing.
        case handedOff

        var url: URL? { if case .open(let url) = self { url } else { nil } }
    }

    /// The client's return address with `state` (when there is one) and `iss` set, as the server
    /// writes it (`new URL(redirect_uri)`, then `searchParams.set`): the query is read as form
    /// data and written back form-encoded, every existing parameter included.
    static func clientRedirect(_ redirectURI: String, state: String?, iss: String) -> String {
        var base = redirectURI, fragment = ""
        if let hash = base.firstIndex(of: "#") {
            fragment = String(base[hash...])
            base = String(base[..<hash])
        }
        var query = ""
        if let q = base.firstIndex(of: "?") {
            query = String(base[base.index(after: q)...])
            base = String(base[..<q])
        }
        var params: [(String, String)] = query.split(separator: "&", omittingEmptySubsequences: true).map { pair in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            return (formDecode(String(parts[0])), parts.count > 1 ? formDecode(String(parts[1])) : "")
        }
        func set(_ name: String, _ value: String) {
            if let i = params.firstIndex(where: { $0.0 == name }) {
                params[i].1 = value
                var j = params.count - 1
                while j > i { if params[j].0 == name { params.remove(at: j) }; j -= 1 }
            } else {
                params.append((name, value))
            }
        }
        if let state { set("state", state) }
        set("iss", iss)
        return base + "?" + params.map { formEncode($0.0) + "=" + formEncode($0.1) }.joined(separator: "&") + fragment
    }

    /// application/x-www-form-urlencoded, as URLSearchParams writes it.
    static func formEncode(_ s: String) -> String {
        var out = ""
        for b in s.utf8 {
            switch b {
            case UInt8(ascii: "a") ... UInt8(ascii: "z"), UInt8(ascii: "A") ... UInt8(ascii: "Z"), UInt8(ascii: "0") ... UInt8(ascii: "9"),
                 UInt8(ascii: "*"), UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"):
                out.unicodeScalars.append(Unicode.Scalar(b))
            case UInt8(ascii: " "):
                out += "+"
            default:
                out += String(format: "%%%02X", b)
            }
        }
        return out
    }

    static func formDecode(_ s: String) -> String {
        var bytes: [UInt8] = []
        var u = Array(s.utf8)[...]
        while let b = u.popFirst() {
            if b == UInt8(ascii: "+") { bytes.append(UInt8(ascii: " ")); continue }
            if b == UInt8(ascii: "%"), u.count >= 2, let v = UInt8(String(decoding: u.prefix(2), as: UTF8.self), radix: 16) {
                bytes.append(v)
                u = u.dropFirst(2)
                continue
            }
            bytes.append(b)
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    /// Allow or deny. `redirect_uri` goes back exactly as /connect/request gave it. Allowing sends
    /// a code made here (`code`): only its hash and the account's key wrapped under it reach the
    /// server. A request asked from a browser (`browserKey`, the page's public key) also gets the
    /// code sealed to that page together with the address it goes to (`handoffRedirect`), so
    /// nobody on the way can send the page elsewhere; otherwise the code is added to the return
    /// address here.
    ///
    /// `wrongNumber`: declined because the person typed a number the page didn't show. The server
    /// then takes no asks for this account for an hour and tells every device.
    static func decide(id: UUID, redirectURI: String?, allow: Bool, write: Bool,
                       code: (code: String, hash: String, wrap: String)?, browserKey: Data? = nil, handoffRedirect: String? = nil,
                       wrongNumber: Bool = false, send: Send) async throws -> Answer {
        guard let redirectURI else { throw Failure(message: "Update Amber Notes to connect an AI.") }
        guard !allow || code != nil else { throw Failure(message: "Open Amber Notes and finish setting up encryption first.") }
        var body: [String: Any] = ["id": id.uuidString.lowercased(), "allow": allow, "write": write, "redirect_uri": redirectURI]
        if !allow, wrongNumber { body["wrong_number"] = true }
        if allow, let code {
            body["code_hash"] = code.hash
            body["code_wrap"] = code.wrap
            if let browserKey {
                guard let handoffRedirect, ConnectCenter.isReturnAddress(URL(string: handoffRedirect) ?? URL(fileURLWithPath: "/")),
                      let sealed = try? E2EE.sealHandoff(code: E2EE.handoffPayload(code: code.code, redirect: handoffRedirect),
                                                         browserKey: browserKey, requestID: id) else {
                    throw Failure(message: "Start connecting again in your browser.")
                }
                body["handoff"] = sealed
            }
        }
        let data = try await send("/connect/decide", "POST", body)
        let answer = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        // The browser that asked goes on by itself, allowed or not.
        if answer?["handoff"] as? Bool == true { return .handedOff }
        guard let s = answer?["redirect"] as? String, let url = URL(string: s) else {
            throw Failure(message: "Amber Notes gave an unexpected answer. Try connecting again.")
        }
        guard allow, let code else { return .open(url) }
        return .open(withCode(url, code.code))
    }

    /// This device's nonce for an asked request (16 random bytes, lowercase hex), written once
    /// before the page reveals its own.
    static func writeNonce(id: UUID, nonce: Data, send: Send) async throws {
        _ = try await send("/connect/nonce", "POST", ["id": id.uuidString.lowercased(), "nonce": E2EE.hex(nonce)])
    }

    /// The AI's return address with the code this device made, next to what the server put there.
    static func withCode(_ url: URL, _ code: String) -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.queryItems = (parts.queryItems ?? []).filter { $0.name != "code" } + [URLQueryItem(name: "code", value: code)]
        return parts.url ?? url
    }
}

/// Disconnecting an AI: its grant is revoked, and it loses access at once.
enum ConnectRevoke {
    static func revoke(_ client: SupabaseClient, id: UUID) async throws {
        try await client.from("mcp_tokens").update(["revoked_at": AnyJSON.string(Date.now.ISO8601Format())]).eq("id", value: id).execute()
    }
}

/// Access tokens for Claude Code and Codex, made on this device.
@MainActor
enum ConnectTokens {
    /// A new pane_ token: made here with the account's key wrapped under it, registered by its hash
    /// only. The token itself never leaves the device except in the AI's Authorization header.
    static func create(_ client: SupabaseClient, name: String, write: Bool,
                       make: () throws -> (token: String, hash: String, wrap: String)) async throws -> String {
        let made = try make()
        struct Params: Encodable { var token_name: String; var write_access: Bool; var token_hash: String; var dk_wrap: String }
        try await client.rpc("create_mcp_token", params: Params(token_name: name, write_access: write, token_hash: made.hash, dk_wrap: made.wrap)).execute()
        return made.token
    }
}

/// Face ID or Touch ID (or the device password) before an AI gets your notes.
enum ConnectApproval {
    /// Whether this device can ask for Face ID, Touch ID or its passcode. Without one, nobody is
    /// asked, so an AI can't be allowed from it.
    static var canConfirm: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    static func confirm(_ who: String) async -> Bool {
        let context = LAContext()
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "allow \(who) to read your notes")) ?? false
    }
}

// MARK: Receiving the link

/// Holds a connect request that arrived by link, or was asked from a browser, until the consent
/// sheet takes it. One sheet at a time; asks that arrive meanwhile wait their turn.
@MainActor
@Observable
final class ConnectCenter: NSObject {
    static let shared = ConnectCenter()
    var pending: UUID?
    /// Asks from a browser this device knows are waiting, by request id.
    private(set) var asks: [UUID: ConnectAsk] = [:]
    /// Asks and links waiting for the sheet, in the order they'll show. Nothing that arrives
    /// replaces the sheet that's showing: the person answers what they're looking at.
    private(set) var queue: [UUID] = []
    /// Requests in the queue that came by link on this device (not asks).
    private var links: Set<UUID> = []
    /// Asks that have been offered here: each opens the sheet by itself once.
    private var offered: Set<UUID> = []
    /// Answered on this device: the update saying so doesn't cut the sheet's "Allowed" short.
    private var answeredHere: Set<UUID> = []
    private var expiry: Task<Void, Never>?
    /// Between one sheet closing and the next opening.
    var nextDelay: Duration = .milliseconds(450)
    /// Mac: which AI the floating steps are for.
    var panelAI: String?
    /// The last approval made on this device, so an open guide can say it worked right away.
    var approved: (ai: String?, at: Date)?
    #if os(macOS)
    /// The browser the request showing came from, so the answer goes back to the same one.
    var browser: URL?
    /// The browser each queued link came from.
    private var browsers: [UUID: URL] = [:]
    /// Brings the app to the front for a link; tests keep it where it is.
    @ObservationIgnored var activate: () -> Void = { NSApp.activate() }
    private var installed = false

    /// Takes URL events ourselves so we can tell which app sent them (SwiftUI's
    /// onOpenURL doesn't say). Installed once the first window is up.
    func installHandler() {
        guard !installed else { return }
        installed = true
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handle(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    @objc private func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue, let url = URL(string: s) else { return }
        let pid = event.attributeDescriptor(forKeyword: AEKeyword(0x7370_6964))?.int32Value // 'spid': sender's process id
        let sender = pid.flatMap { NSRunningApplication(processIdentifier: $0)?.bundleURL }
        receive(url, from: sender)
    }
    #endif

    var askIDs: [UUID] { Array(asks.keys) }

    /// A browser asked this account's devices. Opens the sheet, or queues it behind the one showing.
    /// True when it's new here (the caller may notify); an expired or answered ask is ignored.
    @discardableResult
    func offer(_ ask: ConnectAsk, now: Date = .now) -> Bool {
        guard ask.isOpen(now: now) else { withdraw(ask.id); return false }
        asks[ask.id] = ask
        guard !offered.contains(ask.id) else { return false }
        offered.insert(ask.id)
        if pending == ask.id { return false }
        if pending == nil { show(ask.id) } else { queue.append(ask.id) }
        return true
    }

    /// An ask was answered on another device, or expired: its sheet closes.
    func withdraw(_ id: UUID) {
        asks[id] = nil
        queue.removeAll { $0 == id }
        guard pending == id, !answeredHere.contains(id) else { return }
        pending = nil
        showNextSoon()
    }

    /// The notification for an ask was tapped: it's next, or showing already.
    func showAsk(_ id: UUID) {
        guard pending != id else { return }
        if pending == nil { show(id); return }
        queue.removeAll { $0 == id }
        queue.insert(id, at: 0)
    }

    /// The sheet is answering this request; it closes itself.
    func answering(_ id: UUID) { answeredHere.insert(id) }

    /// The sheet closed, answered or not: the next ask shows.
    func sheetClosed() {
        if let id = pending { answeredHere.remove(id) }
        pending = nil
        expiry?.cancel()
        showNextSoon()
    }

    /// Signed out.
    func clearAsks() {
        if let id = pending, asks[id] != nil { pending = nil }
        asks = [:]
        queue = []
        links = []
        offered = []
        answeredHere = []
        expiry?.cancel()
    }

    private func show(_ id: UUID) {
        pending = id
        #if os(macOS)
        browser = browsers.removeValue(forKey: id)
        #endif
        expiry?.cancel()
        // An ask left unanswered closes when it expires.
        guard let ends = asks[id]?.expires_at else { return }
        expiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, ends.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            self?.withdraw(id)
        }
    }

    private func showNextSoon() {
        let delay = nextDelay
        Task { [weak self] in
            try? await Task.sleep(for: delay)
            self?.showNext()
        }
    }

    /// The next ask still waiting, if nothing is showing.
    func showNext(now: Date = .now) {
        guard pending == nil else { return }
        while let id = queue.first {
            queue.removeFirst()
            if links.remove(id) != nil { show(id); return }
            if asks[id]?.isOpen(now: now) == true { show(id); return }
            asks[id] = nil
        }
    }

    /// A request by link on this device. It shows now, or next when a sheet is showing: it never
    /// replaces what the person is looking at.
    func receive(_ url: URL, from sender: URL? = nil) {
        guard let id = ConnectLink.requestID(from: url) else { return }
        #if os(macOS)
        let from = sender.flatMap { Self.isBrowser($0) ? $0 : nil }
        if let from { browsers[id] = from } else { browsers[id] = nil }
        activate()
        #endif
        guard pending != id else { return }
        guard pending == nil else {
            // Queued asks keep their place behind the person's own link.
            if !queue.contains(id) { queue.insert(id, at: 0) }
            links.insert(id)
            return
        }
        show(id)
    }

    /// Sends the browser on to the AI with the result, in the browser it came from when known.
    /// Only ever a web address (the server allows nothing else; this checks again).
    func open(_ url: URL) {
        guard Self.isReturnAddress(url) else { return }
        #if os(macOS)
        if let browser {
            NSWorkspace.shared.open([url], withApplicationAt: browser, configuration: NSWorkspace.OpenConfiguration())
        } else {
            NSWorkspace.shared.open(url)
        }
        #else
        UIApplication.shared.open(url)
        #endif
    }

    /// https anywhere, or http back to this computer (native clients listen there).
    nonisolated static func isReturnAddress(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "https": return true
        case "http": return ["localhost", "127.0.0.1", "::1", "[::1]"].contains(url.host?.lowercased() ?? "")
        default: return false
        }
    }

    #if os(macOS)
    private static func isBrowser(_ app: URL) -> Bool {
        NSWorkspace.shared.urlsForApplications(toOpen: URL(string: "https://example.com")!).contains { $0.standardizedFileURL == app.standardizedFileURL }
    }
    #endif
}

/// Wires links and the consent sheet into the app's root view.
struct ConnectHandler: ViewModifier {
    let backend: Backend
    @State private var center = ConnectCenter.shared
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif

    func body(content: Content) -> some View {
        content
            .onOpenURL { center.receive($0) }
            // The site's universal link, https://ambernotes.app/open/connect?request=<id>.
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { center.receive(url) }
            }
            #if os(macOS)
            // Links land in the window that's already open instead of a new one.
            .handlesExternalEvents(preferring: [ConnectLink.scheme], allowing: ["*"])
            .onAppear { center.installHandler() }
            // Handoff from iPhone: carry on connecting ChatGPT or Claude here.
            .onContinueUserActivity(ConnectHandoff.activityType) { activity in
                guard let ai = activity.userInfo?[ConnectHandoff.key] as? String, WebConnectPlan.forAI(ai) != nil else { return }
                center.panelAI = ai
                openWindow(id: ConnectPanel.windowID)
            }
            #endif
            .onAppear { center.installNotifications() }
            .sheet(item: Binding(
                get: { backend.client != nil && isSignedIn ? center.pending.map(PendingID.init) : nil },
                set: { if $0 == nil { center.sheetClosed() } }
            )) { pending in
                if let client = backend.client {
                    ConsentSheet(client: client, requestID: pending.id, finish: { center.open($0) },
                                 allowed: { r in center.approved = (r.verifiedAI, .now) },
                                 answering: { center.answering($0) })
                }
            }
    }

    private var isSignedIn: Bool {
        if case .signedIn = backend.state { return true }
        return false
    }

    private struct PendingID: Identifiable { let id: UUID }
}

extension View {
    func connectHandler(backend: Backend) -> some View { modifier(ConnectHandler(backend: backend)) }
}

// MARK: Consent

struct ConsentSheet: View {
    let client: SupabaseClient
    let requestID: UUID
    /// Opens the AI's return address in the browser.
    let finish: (URL) -> Void
    /// Told when the person allowed the request.
    var allowed: (ConnectRequest) -> Void = { _ in }
    /// Told just before the answer is sent.
    var answering: (UUID) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss

    enum Phase: Equatable { case loading, asking(ConnectRequest), working, done(String), handedOff(String), failed(String) }
    @State private var phase: Phase
    @State private var write = true
    /// Asked from a browser: what the number was made from (the page's key, its commit and
    /// revealed nonce), and the number the page shows. Nil until the page has revealed its nonce
    /// and it opened the commit.
    struct Match: Equatable { var row: ConnectAskMatch; var key: Data; var number: String }
    @State private var match: Match?
    /// The two digits typed so far.
    @State private var typed = ""
    /// Allow and the keypad wait a moment after what the sheet shows changes, so a tap meant
    /// for what was there before doesn't land on what's there now.
    @State private var armed = false
    static let armDelay: Duration = .seconds(1)
    /// Face ID or Touch ID before allowing; tests and captures answer for it.
    var confirm: (String) async -> Bool = ConnectApproval.confirm
    var canConfirm: () -> Bool = { ConnectApproval.canConfirm }
    /// The ask's number-matching columns as they are now (nil once it's answered or expired).
    var askMatch: (SupabaseClient, UUID) async throws -> ConnectAskMatch? = { try await ConnectAsks.match($0, id: $1) }
    /// Writes this device's nonce on the ask.
    var writeNonce: (SupabaseClient, UUID, Data) async throws -> Void = { client, id, nonce in
        try await ConnectAPI.writeNonce(id: id, nonce: nonce, send: ConnectAPI.sender(client))
    }
    /// How often the ask is read again while the page hasn't revealed its nonce.
    var pollInterval: Duration = .seconds(1)

    init(client: SupabaseClient, requestID: UUID, initial: Phase = .loading, finish: @escaping (URL) -> Void,
         allowed: @escaping (ConnectRequest) -> Void = { _ in }, answering: @escaping (UUID) -> Void = { _ in }) {
        self.client = client
        self.requestID = requestID
        self.finish = finish
        self.allowed = allowed
        self.answering = answering
        _phase = State(initialValue: initial)
    }

    private struct Shown: Equatable { var phase: Phase; var match: Match? }

    var body: some View {
        VStack(spacing: 20) {
            header
            content
        }
        .padding(28)
        #if os(macOS)
        .frame(width: 420)
        #else
        .presentationDetents([.medium, .large])
        #endif
        .task {
            if phase == .loading { await load() }
            else if case .asking(let r) = phase, r.isAsked, match == nil { await loadMatch(r) }
        }
        .task(id: Shown(phase: phase, match: match)) {
            armed = false
            try? await Task.sleep(for: Self.armDelay)
            if !Task.isCancelled { armed = true }
        }
        .animation(.smooth(duration: 0.25), value: phase)
    }

    /// Who's asking, and for what: the AI's mark (only when its address proves it), a link, our icon.
    @ViewBuilder
    private var header: some View {
        if case .asking(let r) = phase {
            let ai = r.verifiedAI
            HStack(spacing: 14) {
                if let ai {
                    AITile(ai: ai, size: 56)
                } else {
                    // An app we can't vouch for: a plain glyph, never a borrowed mark.
                    Image(systemName: r.loopback ? "desktopcomputer" : "globe")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 56, height: 56)
                        .background(.fill.tertiary, in: .rect(cornerRadius: 56 * 0.3, style: .continuous))
                }
                Image(systemName: "link")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.tertiary)
                AppMark(size: 56)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(ai.map { "\($0) and Amber Notes" } ?? "An app and Amber Notes")
            .accessibilityIdentifier(ai == nil ? "connect.header.unknown" : "connect.header.\(ai!)")
        } else {
            AppMark(size: 56)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading, .working:
            ProgressView().controlSize(.large).frame(height: 120)
        case .asking(let r):
            asking(r)
        case .done(let name):
            VStack(spacing: 8) {
                Label("Connected", systemImage: "checkmark.circle.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.green)
                Text("Go back to \(name) to finish.").foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        case .handedOff:
            VStack(spacing: 8) {
                Label("Allowed", systemImage: "checkmark.circle.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.green)
                Text("It finishes connecting in your browser.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
        case .failed(let message):
            VStack(spacing: 14) {
                Text("Couldn't connect").font(.title3.weight(.semibold))
                Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    .accessibilityIdentifier("connect.failure")
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
    }

    /// The title. Asked from a browser, nothing about who's asking is confirmed: what it calls
    /// itself is only a claim.
    nonisolated static func title(_ r: ConnectRequest) -> String {
        guard r.isAsked else { return "Allow \(r.who) to use your notes?" }
        return r.claimedName.map { "An app that says it's \($0) wants to use your notes" } ?? "An app wants to use your notes"
    }

    private func asking(_ r: ConnectRequest) -> some View {
        let known = r.verifiedAI != nil
        return VStack(spacing: 18) {
            VStack(spacing: 6) {
                Text(Self.title(r))
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                Group {
                    if r.isAsked {
                        Text("It asks for access to go to \(Text(r.redirect_host).bold()). We can't confirm where access goes.")
                    } else if let claimed = r.claimedName {
                        Text("Access goes to \(Text(r.redirect_host).bold()). It calls itself \u{201C}\(claimed)\u{201D}.")
                    } else {
                        Text("Access goes to \(Text(r.redirect_host).bold()).")
                    }
                }
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("connect.destination")
                // Asked from a browser: when, and in what, so a request you didn't start stands out.
                if let line = r.requestedLine() {
                    Text(line)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("connect.requested")
                }
            }

            // An app that asked only to read can't be given more.
            let canEdit = Binding(get: { write && r.wants_write }, set: { write = $0 })
            Picker("Access", selection: canEdit) {
                Text("Read and Edit").tag(true)
                Text("Read Only").tag(false)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .disabled(!r.wants_write)
            .accessibilityIdentifier("connect.access")

            Text((canEdit.wrappedValue ? "It can read, create and change your notes. Every change keeps the previous version." : "It can read your notes, but not change them.")
                 + " While it's connected, it can read everything you keep here except locked notes.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(minHeight: 40, alignment: .top)

            if r.isAsked {
                numbers(r)
            } else {
                Label(known ? "Only allow this if you just started connecting \(r.who)." :
                        "Amber Notes doesn't recognize this app. Only allow it if you just started connecting it yourself.",
                      systemImage: known ? "info.circle" : "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(known ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
                    .multilineTextAlignment(.leading)

                HStack(spacing: 12) {
                    Button { Task { await decide(r, allow: false) } } label: {
                        Text("Don't Allow").frame(maxWidth: .infinity)
                    }
                    .keyboardShortcut(.cancelAction)
                    .controlSize(.large)
                    .accessibilityIdentifier("connect.deny")
                    Button { Task { await decide(r, allow: true) } } label: {
                        Text("Allow").frame(maxWidth: .infinity)
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!armed)
                    .accessibilityIdentifier("connect.allow")
                }
            }
        }
    }

    /// Asked from a browser: type the two digits the page shows. The right ones allow (after
    /// Face ID or Touch ID); any others decline.
    @ViewBuilder
    private func numbers(_ r: ConnectRequest) -> some View {
        VStack(spacing: 12) {
            Label(match == nil ? "Waiting for your browser to show a number\u{2026}" :
                    "Only continue if you just started connecting an AI in your browser. Type the number it shows.",
                  systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.orange)
                .multilineTextAlignment(.leading)
                .accessibilityIdentifier("connect.matchHint")
            if match != nil {
                typedDigits
                keypad
            } else {
                ProgressView().frame(height: 44)
            }
            HStack(spacing: 12) {
                Button { Task { await decide(r, allow: false) } } label: {
                    Text("Don't Allow").frame(maxWidth: .infinity)
                }
                .keyboardShortcut(.cancelAction)
                .controlSize(.large)
                .accessibilityIdentifier("connect.deny")
                Button { Task { await entered(r) } } label: {
                    Text("Allow").frame(maxWidth: .infinity)
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!armed || match == nil || typed.count < 2)
                .accessibilityIdentifier("connect.allow")
            }
        }
    }

    /// The two boxes the digits go in.
    private var typedDigits: some View {
        HStack(spacing: 10) {
            ForEach(0 ..< 2, id: \.self) { i in
                let digit = i < typed.count ? String(Array(typed)[i]) : ""
                Text(digit.isEmpty ? " " : digit)
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .frame(width: 48, height: 56)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 12, style: .continuous))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(typed.isEmpty ? "No digits typed" : "Typed \(typed.map(String.init).joined(separator: " "))")
        .accessibilityIdentifier("connect.typed")
    }

    /// A numeric keypad. On a Mac the number keys and Delete type too.
    private var keypad: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"]
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(keys, id: \.self) { key in
                if key.isEmpty {
                    Color.clear.frame(height: 44)
                } else {
                    Button { typed = ConnectMatch.typing(typed, key) } label: {
                        Group {
                            if key == "delete" {
                                Image(systemName: "delete.left").font(.title3)
                            } else {
                                Text(key).font(.title2.weight(.medium)).monospacedDigit()
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(key == "delete" ? KeyEquivalent.delete : KeyEquivalent(Character(key)), modifiers: [])
                    .disabled(!armed)
                    .accessibilityLabel(key == "delete" ? "Delete" : key)
                    .accessibilityIdentifier("connect.key.\(key)")
                }
            }
        }
    }

    private func load() async {
        do {
            let r = try await ConnectAPI.request(client, id: requestID)
            // An app Amber Notes can't vouch for starts at Read Only; the person can still pick more.
            write = r.wants_write && r.verifiedAI != nil
            phase = .asking(r)
            if r.isAsked { await loadMatch(r) }
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Writes this device's nonce on the ask, then reads the ask about every second until the page
    /// reveals its nonce, and shows the number only if the reveal opens the page's commit.
    private func loadMatch(_ r: ConnectRequest) async {
        let nonce = ConnectMatch.deviceNonce(for: r.id)
        do {
            guard var row = try await askMatch(client, r.id) else { phase = .failed(ConnectMatchCopy.expired); return }
            if row.device_nonce == nil {
                do { try await writeNonce(client, r.id, nonce) } catch {
                    // Another device may have written first; the ask says.
                    guard let again = try await askMatch(client, r.id) else { phase = .failed(ConnectMatchCopy.expired); return }
                    if again.device_nonce == nil { throw error }
                    row = again
                }
            }
            while !Task.isCancelled {
                switch ConnectMatch.check(row, deviceNonce: nonce, requestID: r.id) {
                case .number(let n):
                    guard let key = row.browserKey else { return }
                    match = Match(row: row, key: key, number: n)
                    return
                case .otherDevice:
                    phase = .failed(ConnectMatchCopy.otherDevice)
                    return
                case .broken:
                    // Whoever wrote this ask isn't the page that committed: no number, and no.
                    await decide(r, allow: false, declined: ConnectMatchCopy.broken)
                    return
                case .waiting:
                    break
                }
                try await Task.sleep(for: pollInterval)
                guard let next = try await askMatch(client, r.id) else { phase = .failed(ConnectMatchCopy.expired); return }
                row = next
            }
        } catch is CancellationError {
            return
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Allow, with two digits typed: the page's number allows; any other declines, and the server
    /// is told it was a wrong number.
    private func entered(_ r: ConnectRequest) async {
        guard armed, let match, typed.count == 2 else { return }
        guard typed == match.number else {
            typed = ""
            await decide(r, allow: false, declined: ConnectMatchCopy.wrongNumber, wrongNumber: true)
            return
        }
        await decide(r, allow: true)
    }

    private func decide(_ r: ConnectRequest, allow: Bool, declined: String? = nil, wrongNumber: Bool = false) async {
        // Handing over the key to your notes takes you, not just a click.
        if allow {
            guard armed else { return }
            guard canConfirm() else {
                phase = .failed("Turn on a passcode, Face ID or Touch ID on this device to connect an AI.")
                return
            }
            if !(await confirm(r.who)) { return }
        }
        phase = .working
        do {
            // The connection gets its own copy of the account's key, wrapped under a code made here.
            let code = allow ? try AccountCrypto.shared.connectionCode() : nil
            // Asked from a browser: the code goes to that page, sealed to its key, with the
            // address it goes to. The ask must still be what the number was made from.
            var key: Data?
            if allow, r.isAsked {
                guard let match else { throw ConnectAPI.Failure(message: ConnectMatchCopy.changed) }
                guard let now = try await askMatch(client, r.id) else { throw ConnectAPI.Failure(message: ConnectMatchCopy.expired) }
                guard now == match.row else { throw ConnectAPI.Failure(message: ConnectMatchCopy.changed) }
                key = match.key
            }
            answering(r.id)
            let answer = try await ConnectAPI.decide(id: r.id, redirectURI: r.redirect_uri, allow: allow, write: write && r.wants_write,
                                                     code: code, browserKey: key, handoffRedirect: r.handoffRedirect,
                                                     wrongNumber: wrongNumber, send: ConnectAPI.sender(client))
            // Only a request that came by link here is sent on from here.
            if let url = answer.url { finish(url) }
            if allow {
                allowed(r)
                phase = answer == .handedOff ? .handedOff(r.redirect_host) : .done(r.who)
                try? await Task.sleep(for: .seconds(answer == .handedOff ? 2.4 : 1.6))
            } else if let declined {
                phase = .failed(declined)
                return
            }
            dismiss()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }
}


// MARK: Settings

struct Connection: Decodable, Identifiable {
    let id: UUID
    let name: String
    let kind: String?
    let can_write: Bool
    let created_at: Date
    let last_used_at: Date?
    let revoked_at: Date?
    let redirect_host: String?
    /// From servers that took tokens in links; nothing sets it now.
    var url_used_at: Date? = nil

    var isOAuth: Bool { kind == "oauth" }
    /// What the list calls it. A sign-in the app can't vouch for is named by where access went,
    /// never by the name the app gave itself (grants from before 2026-09-30 still carry that name).
    var title: String { Self.title(name: name, kind: kind, host: redirect_host) }

    static func title(name: String, kind: String?, host: String?) -> String {
        guard kind == "oauth", let host, !host.isEmpty,
              ConnectTrust.verifiedAI(host: host, loopback: false) == nil else { return name }
        return ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host) ? "An app on this computer" : host
    }
}

/// Settings → Connect an AI: guided setup per app, and everything that's connected.
struct ConnectAISection: View {
    let client: SupabaseClient
    /// Captures: shows these instead of asking the server.
    var preview: [Connection]? = nil
    @State private var connections: [Connection] = []
    @State private var guide: Guide?
    @State private var removing: Connection?
    @State private var error: String?

    enum Guide: String, Identifiable, CaseIterable {
        case chatgpt, claude, claudeCode, codex
        var id: String { rawValue }
        var title: String {
            switch self {
            case .chatgpt: "ChatGPT"
            case .claude: "Claude"
            case .claudeCode: "Claude Code"
            case .codex: "Codex"
            }
        }
        var subtitle: String {
            switch self {
            case .chatgpt: "Added once in ChatGPT on the web, then works in its apps"
            case .claude: "Added once in Claude on the web or desktop, then works in its apps"
            case .claudeCode: "Adds Amber Notes to Claude Code on this Mac"
            case .codex: "Adds Amber Notes to Codex"
            }
        }
        /// Where it's done, in the AI's own words (as on the website).
        var hint: String {
            switch self {
            case .chatgpt: "Plugins → +"
            case .claude: "Add custom connector"
            case .claudeCode: "claude mcp add amber-notes"
            case .codex: "~/.codex/config.toml"
            }
        }
    }

    var body: some View {
        guides
        connected
    }

    /// One joined list of AIs, each with its mark, name and how it connects, and the promises under it.
    private var guides: some View {
        Section {
            ForEach(Guide.allCases) { g in
                Button { guide = g } label: {
                    HStack(spacing: 12) {
                        AITile(ai: g.title, size: 32)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(g.title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                            Text(g.hint).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 2)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Connect \(g.title)")
                .accessibilityHint(g.subtitle)
                .accessibilityIdentifier("connect.guide.\(g.rawValue)")
            }
        } header: {
            Text("Connect an AI")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                promise("You approve every AI.")
                promise("Disconnect anytime.")
                promise("Every change an AI makes can be undone.")
            }
            .padding(.top, 4)
        }
    }

    private func promise(_ text: String) -> some View {
        Label {
            Text(text).foregroundStyle(.primary)
        } icon: {
            Image(systemName: "checkmark").fontWeight(.bold).foregroundStyle(.tint)
        }
        .font(.callout.weight(.medium))
    }

    private var connected: some View {
        Section("Connected") {
            let active = connections.filter { $0.revoked_at == nil }
            if active.isEmpty {
                Text("Nothing is connected yet.").foregroundStyle(.secondary)
            }
            ForEach(active) { c in row(c) }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        }
        .task { await load() }
        .sheet(item: $guide, onDismiss: { Task { await load() } }) { g in
            GuideSheet(guide: g, client: client)
        }
        .confirmationDialog("Disconnect \(removing?.title ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { if let r = removing { Task { await revoke(r) } } }
        } message: {
            Text("It loses access to your notes right away.")
        }
    }

    private func row(_ c: Connection) -> some View {
        HStack(spacing: 10) {
            // The mark comes from where the approval went, never from the name.
            AITile(ai: ConnectTrust.verifiedAI(host: c.redirect_host ?? "", loopback: false) ?? "", size: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.title)
                Text(detail(c)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            // The name and details read as one; Disconnect stays its own button for VoiceOver.
            .accessibilityElement(children: .combine)
            Spacer()
            Button("Disconnect…") { removing = c }
                .buttonStyle(.borderless)
                .accessibilityLabel("Disconnect \(c.title)")
                .accessibilityIdentifier("connect.disconnect")
        }
    }

    private func detail(_ c: Connection) -> String {
        var parts = [c.isOAuth ? "Signed in" : "Access token", c.can_write ? "Read and edit" : "Read only"]
        // Where access went: the proof of who this is, whatever it calls itself.
        if c.isOAuth, let host = c.redirect_host, !host.isEmpty, host != c.title { parts.insert(host, at: 0) }
        parts.append(c.last_used_at.map { "Used \($0.formatted(.relative(presentation: .named)))" } ?? "Not used yet")
        return parts.joined(separator: " · ")
    }

    private func load() async {
        if let preview { connections = preview; return }
        do {
            connections = try await client.from("mcp_tokens").select().order("created_at", ascending: false).execute().value
            error = nil
        } catch {
            self.error = "Couldn't load connections. Check your connection."
        }
    }

    private func revoke(_ c: Connection) async {
        do {
            try await ConnectRevoke.revoke(client, id: c.id)
            removing = nil
            await load()
        } catch {
            self.error = "Couldn't disconnect \(c.name). Try again."
        }
    }
}

/// Step by step for one app. ChatGPT and Claude need only the address; Claude Code and
/// Codex get a fresh token that's used once here and never shown in a link.
private struct GuideSheet: View {
    let guide: ConnectAISection.Guide
    let client: SupabaseClient
    @Environment(\.dismiss) private var dismiss
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #endif
    @State private var copied: String?
    @State private var token: String?
    @State private var working = false
    @State private var result: String?
    @State private var failed = false
    @State private var readOnly = false

    private var server: String { BackendConfig.mcpPublicURL?.absoluteString ?? "" }

    var body: some View {
        NavigationStack {
            Form { content }
                .formStyle(.grouped)
                .navigationTitle("Connect \(guide.title)")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(width: 560, height: 560)
        #endif
    }

    @ViewBuilder
    private var content: some View {
        switch guide {
        case .chatgpt, .claude:
            if let plan = WebConnectPlan.forAI(guide.title) {
                #if os(macOS)
                WebConnectGuide(plan: plan, client: client, popOut: {
                    ConnectCenter.shared.panelAI = plan.ai
                    openWindow(id: ConnectPanel.windowID)
                    dismiss()
                })
                #else
                WebConnectGuide(plan: plan, client: client)
                #endif
            }
        case .claudeCode:
            tokenGuide(
                intro: "Claude Code gets its own access token, sent in a request header. It works in every project. If you connected Claude and use Claude Code with the same account, it already has Amber Notes.",
                snippet: token.map { ConnectSnippets.claudeCode(url: server, token: $0) },
                note: "Or run this in a terminal. It's shown once; keep it private.")
        case .codex:
            tokenGuide(
                intro: "Codex gets its own access token, sent in a request header.",
                snippet: token.map { ConnectSnippets.codex(url: server, token: $0) },
                note: "Add this to ~/.codex/config.toml. It's shown once; keep it private.")
        }
    }

    @ViewBuilder
    private func tokenGuide(intro: String, snippet: String?, note: String) -> some View {
        Section {
            Text(intro).foregroundStyle(.secondary)
            Toggle("Read only", isOn: $readOnly).disabled(token != nil)
        }
        #if os(macOS)
        // The TestFlight / App Store build is sandboxed and can't run your shell: it shows the command to copy instead.
        if guide == .claudeCode, ClaudeCodeInstaller.isAvailable {
            Section {
                Button(working ? "Adding…" : "Add to Claude Code", systemImage: "plus.circle") { Task { await addToClaudeCode() } }
                    .disabled(working)
                    .accessibilityIdentifier("connect.addClaudeCode")
                if let result {
                    Label(result, systemImage: failed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .foregroundStyle(failed ? .orange : .green)
                        .font(.callout)
                }
            }
        }
        #endif
        Section {
            if let snippet {
                Text(snippet).font(.system(.footnote, design: .monospaced)).textSelection(.enabled).lineLimit(8)
                copyButton("Copy", snippet)
            } else {
                Button("Create Access Token", systemImage: "key") { Task { await makeToken() } }
                    .disabled(working)
            }
        } footer: {
            Text(note)
        }
    }

    private func copyButton(_ title: String, _ value: String) -> some View {
        Button(copied == value ? "Copied" : title, systemImage: copied == value ? "checkmark" : "doc.on.doc") {
            #if os(iOS)
            UIPasteboard.general.string = value
            #else
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
            #endif
            withAnimation(.snappy) { copied = value }
        }
    }

    @discardableResult
    private func makeToken() async -> String? {
        if let token { return token }
        working = true
        defer { working = false }
        do {
            let t = try await ConnectTokens.create(client, name: guide.title, write: !readOnly) { try AccountCrypto.shared.accessToken() }
            token = t
            return t
        } catch {
            result = "Couldn't create a token. Check your connection."
            failed = true
            return nil
        }
    }

    #if os(macOS)
    /// Runs `claude mcp add` for the person, with the token passed through the environment.
    private func addToClaudeCode() async {
        working = true
        result = nil
        guard let t = await makeToken() else { working = false; return }
        let outcome = await ClaudeCodeInstaller.install(url: server, token: t)
        working = false
        failed = !outcome.ok
        result = outcome.message
    }
    #endif
}

#if os(macOS)
/// Finds the claude command and adds Amber Notes to it. A GUI app doesn't see the
/// person's shell PATH, so it asks their login shell.
enum ClaudeCodeInstaller {
    /// A sandboxed app can't start the person's login shell, so the button only exists outside the sandbox.
    static var isAvailable: Bool { ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] == nil }

    static func install(url: String, token: String) async -> (ok: Bool, message: String) {
        await Task.detached {
            let script = """
            command -v claude >/dev/null 2>&1 || { echo "not-found"; exit 127; }
            claude mcp remove --scope user amber-notes >/dev/null 2>&1
            claude mcp add --scope user --transport http amber-notes "$AMBER_URL" --header "Authorization: Bearer $AMBER_TOKEN"
            """
            let p = Process()
            p.executableURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
            p.arguments = ["-l", "-i", "-c", script]
            var env = ProcessInfo.processInfo.environment
            env["AMBER_URL"] = url
            env["AMBER_TOKEN"] = token
            p.environment = env
            let out = Pipe()
            p.standardOutput = out
            p.standardError = out
            p.standardInput = FileHandle.nullDevice
            do { try p.run() } catch { return (false, "Couldn't start your shell.") }
            p.waitUntilExit()
            let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            if p.terminationStatus == 0 { return (true, "Added. Start a new Claude Code session to use it.") }
            if text.contains("not-found") { return (false, "Claude Code isn't installed, or isn't on your PATH. Copy the command below instead.") }
            return (false, "Claude Code didn't accept it. Copy the command below instead.")
        }.value
    }
}
#endif
