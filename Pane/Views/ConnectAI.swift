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

    /// The AI this request provably comes from, if any.
    var verifiedAI: String? { ConnectTrust.verifiedAI(redirectURI: redirect_uri) }
    /// Who's asking, as the sheet names it: the verified AI, or else where access goes.
    var who: String { verifiedAI ?? ConnectTrust.destination(host: redirect_host, loopback: loopback) }
    /// The name an unverified app gave itself, shown only as a secondary claim, and only as the
    /// server's plain-ASCII version of it.
    var claimedName: String? { verifiedAI == nil ? claimed_name.flatMap { $0.isEmpty ? nil : $0 } : nil }
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
        return try JSONDecoder().decode(ConnectRequest.self, from: data)
    }

    /// Allow or deny; returns where to send the browser next. `redirect_uri` goes back exactly as
    /// /connect/request gave it. Allowing sends a code made here (`code`): only its hash and the
    /// account's key wrapped under it reach the server, and the code is added to the answer here.
    static func decide(id: UUID, redirectURI: String?, allow: Bool, write: Bool,
                       code: (code: String, hash: String, wrap: String)?, send: Send) async throws -> URL {
        guard let redirectURI else { throw Failure(message: "Update Amber Notes to connect an AI.") }
        guard !allow || code != nil else { throw Failure(message: "Open Amber Notes and finish setting up encryption first.") }
        var body: [String: Any] = ["id": id.uuidString.lowercased(), "allow": allow, "write": write, "redirect_uri": redirectURI]
        if allow, let code {
            body["code_hash"] = code.hash
            body["code_wrap"] = code.wrap
        }
        let data = try await send("/connect/decide", "POST", body)
        guard let s = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["redirect"] as? String, let url = URL(string: s) else {
            throw Failure(message: "Amber Notes gave an unexpected answer. Try connecting again.")
        }
        guard allow, let code else { return url }
        return withCode(url, code.code)
    }

    /// The AI's return address with the code this device made, next to what the server put there.
    static func withCode(_ url: URL, _ code: String) -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.queryItems = (parts.queryItems ?? []).filter { $0.name != "code" } + [URLQueryItem(name: "code", value: code)]
        return parts.url ?? url
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

/// Holds a connect request that arrived by link until the consent sheet takes it.
@MainActor
@Observable
final class ConnectCenter: NSObject {
    static let shared = ConnectCenter()
    var pending: UUID?
    /// Mac: which AI the floating steps are for.
    var panelAI: String?
    /// The last approval made on this device, so an open guide can say it worked right away.
    var approved: (ai: String?, at: Date)?
    #if os(macOS)
    /// The browser the request came from, so the answer goes back to the same one.
    var browser: URL?
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

    func receive(_ url: URL, from sender: URL? = nil) {
        guard let id = ConnectLink.requestID(from: url) else { return }
        #if os(macOS)
        browser = sender.flatMap { Self.isBrowser($0) ? $0 : nil }
        NSApp.activate()
        #endif
        pending = id
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
    static func isReturnAddress(_ url: URL) -> Bool {
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
            .sheet(item: Binding(
                get: { backend.client != nil && isSignedIn ? center.pending.map(PendingID.init) : nil },
                set: { if $0 == nil { center.pending = nil } }
            )) { pending in
                if let client = backend.client {
                    ConsentSheet(client: client, requestID: pending.id, finish: { center.open($0) },
                                 allowed: { r in center.approved = (r.verifiedAI, .now) })
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
    @Environment(\.dismiss) private var dismiss

    enum Phase: Equatable { case loading, asking(ConnectRequest), working, done(String), failed(String) }
    @State private var phase: Phase
    @State private var write = true
    /// Face ID or Touch ID before allowing; tests and captures answer for it.
    var confirm: (String) async -> Bool = ConnectApproval.confirm
    var canConfirm: () -> Bool = { ConnectApproval.canConfirm }

    init(client: SupabaseClient, requestID: UUID, initial: Phase = .loading, finish: @escaping (URL) -> Void, allowed: @escaping (ConnectRequest) -> Void = { _ in }) {
        self.client = client
        self.requestID = requestID
        self.finish = finish
        self.allowed = allowed
        _phase = State(initialValue: initial)
    }

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
        .task { if phase == .loading { await load() } }
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
        case .failed(let message):
            VStack(spacing: 14) {
                Text("Couldn't connect").font(.title3.weight(.semibold))
                Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
    }

    private func asking(_ r: ConnectRequest) -> some View {
        let known = r.verifiedAI != nil
        return VStack(spacing: 18) {
            VStack(spacing: 6) {
                Text("Allow \(r.who) to use your notes?")
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                Group {
                    if let claimed = r.claimedName {
                        Text("Access goes to \(Text(r.who).bold()). It calls itself \u{201C}\(claimed)\u{201D}.")
                    } else {
                        Text("Access goes to \(Text(r.redirect_host).bold()).")
                    }
                }
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
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
                .accessibilityIdentifier("connect.allow")
            }
        }
    }

    private func load() async {
        do {
            let r = try await ConnectAPI.request(client, id: requestID)
            // An app Amber Notes can't vouch for starts at Read Only; the person can still pick more.
            write = r.wants_write && r.verifiedAI != nil
            phase = .asking(r)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func decide(_ r: ConnectRequest, allow: Bool) async {
        // Handing over the key to your notes takes you, not just a click.
        if allow {
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
            let url = try await ConnectAPI.decide(id: r.id, redirectURI: r.redirect_uri, allow: allow, write: write && r.wants_write,
                                                  code: code, send: ConnectAPI.sender(client))
            finish(url)
            if allow {
                allowed(r)
                phase = .done(r.who)
                try? await Task.sleep(for: .seconds(1.6))
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
    var title: String {
        guard isOAuth, let host = redirect_host, !host.isEmpty,
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
            try await client.from("mcp_tokens").update(["revoked_at": AnyJSON.string(Date.now.ISO8601Format())]).eq("id", value: c.id).execute()
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
