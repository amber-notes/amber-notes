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
// /authorize, which hands over to ambernotes://connect?request=<id>. The app (already signed in)
// shows who's asking, the person allows read-only or read and edit, and the app sends the
// browser on to the AI with the result. Claude Code and Codex use an access token in a
// request header instead, created here and never shown in a link.

// MARK: Pure pieces (tested)

enum ConnectLink {
    static let scheme = "ambernotes"

    /// The request id in ambernotes://connect?request=<uuid>, if this is such a link.
    static func requestID(from url: URL) -> UUID? {
        guard url.scheme?.lowercased() == scheme, url.host?.lowercased() == "connect",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let raw = comps.queryItems?.first(where: { $0.name == "request" })?.value else { return nil }
        return UUID(uuidString: raw)
    }
}

enum ConnectTrust {
    /// Where known AI apps receive their sign-in. Anything else gets a stronger warning.
    static let knownHosts: [String: String] = [
        "chatgpt.com": "ChatGPT",
        "chat.openai.com": "ChatGPT",
        "claude.ai": "Claude",
        "claude.com": "Claude",
    ]

    /// Who will receive access, in words for the consent sheet.
    static func destination(host: String, loopback: Bool) -> String {
        if loopback { return "an app on this computer" }
        return host
    }

    static func isKnown(host: String, loopback: Bool) -> Bool {
        loopback ? false : knownHosts.keys.contains { host == $0 || host.hasSuffix("." + $0) }
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

// MARK: Server calls

struct ConnectRequest: Decodable, Identifiable, Equatable {
    let id: UUID
    let client_name: String
    let redirect_host: String
    let loopback: Bool
    let wants_write: Bool
}

enum ConnectAPI {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static func send(_ client: SupabaseClient, path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let base = BackendConfig.mcpURL else { throw Failure(message: "Sync is off in this build.") }
        let jwt = try await client.auth.session.accessToken
        var req = URLRequest(url: URL(string: base.absoluteString + path)!)
        req.httpMethod = method
        req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(message: message ?? "Couldn't reach Amber Notes. Check your connection.")
        }
        return data
    }

    static func request(_ client: SupabaseClient, id: UUID) async throws -> ConnectRequest {
        let data = try await send(client, path: "/connect/request?id=\(id.uuidString.lowercased())")
        return try JSONDecoder().decode(ConnectRequest.self, from: data)
    }

    /// Allow or deny; returns where to send the browser next.
    static func decide(_ client: SupabaseClient, id: UUID, allow: Bool, write: Bool) async throws -> URL {
        let data = try await send(client, path: "/connect/decide", method: "POST", body: ["id": id.uuidString.lowercased(), "allow": allow, "write": write])
        guard let s = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["redirect"] as? String, let url = URL(string: s) else {
            throw Failure(message: "Amber Notes gave an unexpected answer. Try connecting again.")
        }
        return url
    }
}

// MARK: Receiving the link

/// Holds a connect request that arrived by link until the consent sheet takes it.
@MainActor
@Observable
final class ConnectCenter: NSObject {
    static let shared = ConnectCenter()
    var pending: UUID?
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

    func body(content: Content) -> some View {
        content
            .onOpenURL { center.receive($0) }
            #if os(macOS)
            // Links land in the window that's already open instead of a new one.
            .handlesExternalEvents(preferring: [ConnectLink.scheme], allowing: ["*"])
            .onAppear { center.installHandler() }
            #endif
            .sheet(item: Binding(
                get: { backend.client != nil && isSignedIn ? center.pending.map(PendingID.init) : nil },
                set: { if $0 == nil { center.pending = nil } }
            )) { pending in
                if let client = backend.client {
                    ConsentSheet(client: client, requestID: pending.id, finish: { center.open($0) })
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
    @Environment(\.dismiss) private var dismiss

    enum Phase: Equatable { case loading, asking(ConnectRequest), working, done(String), failed(String) }
    @State private var phase: Phase
    @State private var write = true

    init(client: SupabaseClient, requestID: UUID, initial: Phase = .loading, finish: @escaping (URL) -> Void) {
        self.client = client
        self.requestID = requestID
        self.finish = finish
        _phase = State(initialValue: initial)
    }

    var body: some View {
        VStack(spacing: 20) {
            AppMark(size: 56)
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
        let known = ConnectTrust.isKnown(host: r.redirect_host, loopback: r.loopback)
        return VStack(spacing: 18) {
            VStack(spacing: 6) {
                Text("Allow \(r.client_name) to use your notes?")
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text("Access goes to \(Text(ConnectTrust.destination(host: r.redirect_host, loopback: r.loopback)).bold()).")
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

            Text(canEdit.wrappedValue ? "It can search, read, create and change notes. Every change keeps the previous version." : "It can search and read notes, but not change them.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(minHeight: 40, alignment: .top)

            Label(known ? "Only allow this if you just started connecting \(r.client_name)." :
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
            write = r.wants_write
            phase = .asking(r)
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func decide(_ r: ConnectRequest, allow: Bool) async {
        phase = .working
        do {
            let url = try await ConnectAPI.decide(client, id: r.id, allow: allow, write: write && r.wants_write)
            finish(url)
            if allow {
                phase = .done(r.client_name)
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
    let url_used_at: Date?

    var isOAuth: Bool { kind == "oauth" }
    /// A token that was sent inside a link: it may sit in logs or histories.
    var lessSecure: Bool { !isOAuth && url_used_at != nil }
}

/// Settings → Connect an AI: guided setup per app, and everything that's connected.
struct ConnectAISection: View {
    let client: SupabaseClient
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
            case .chatgpt: "Sign in from ChatGPT on the web"
            case .claude: "Sign in from Claude on the web or desktop"
            case .claudeCode: "Adds Amber Notes to Claude Code on this Mac"
            case .codex: "Adds Amber Notes to Codex"
            }
        }
        var icon: String {
            switch self {
            case .chatgpt, .claude: "bubble.left.and.text.bubble.right"
            case .claudeCode, .codex: "terminal"
            }
        }
    }

    var body: some View {
        Section {
            ForEach(Guide.allCases) { g in
                Button { guide = g } label: {
                    HStack(spacing: 12) {
                        Image(systemName: g.icon).foregroundStyle(.tint).frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.title).foregroundStyle(.primary)
                            Text(g.subtitle).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
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
            Text("ChatGPT and Claude sign in, and you approve them here. Nothing secret is pasted anywhere. Every change an AI makes keeps the previous version, so it can be undone.")
        }

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
        .confirmationDialog("Disconnect \(removing?.name ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { if let r = removing { Task { await revoke(r) } } }
        } message: {
            Text("It loses access to your notes right away.")
        }
    }

    private func row(_ c: Connection) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(c.name)
                    if c.lessSecure {
                        Text("Less secure")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.orange.opacity(0.18), in: .capsule)
                            .foregroundStyle(.orange)
                            .help("This token was sent inside a link, where it can end up in logs and browser history. Disconnect it and connect again.")
                    }
                }
                Text(detail(c)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            // The name and details read as one; Disconnect stays its own button for VoiceOver.
            .accessibilityElement(children: .combine)
            Spacer()
            Button("Disconnect…") { removing = c }
                .buttonStyle(.borderless)
                .accessibilityLabel("Disconnect \(c.name)")
                .accessibilityIdentifier("connect.disconnect")
        }
    }

    private func detail(_ c: Connection) -> String {
        var parts = [c.isOAuth ? "Signed in" : "Access token", c.can_write ? "Read and edit" : "Read only"]
        parts.append(c.last_used_at.map { "Used \($0.formatted(.relative(presentation: .named)))" } ?? "Not used yet")
        return parts.joined(separator: " · ")
    }

    private func load() async {
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
    @State private var copied: String?
    @State private var token: String?
    @State private var working = false
    @State private var result: String?
    @State private var failed = false
    @State private var readOnly = false

    private var server: String { BackendConfig.mcpURL?.absoluteString ?? "" }

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
        case .chatgpt:
            steps([
                "In ChatGPT on the web, open Apps in the sidebar, then Advanced settings, and turn on Developer mode.",
                "Back in Apps, choose Create app and name it Amber Notes.",
                "Paste the address below as the MCP server URL and choose OAuth as the authentication.",
                "Choose Create. Your browser asks to open Amber Notes: allow it, then choose Allow here.",
            ])
            addressSection
            Section { Text("Needs a ChatGPT Plus, Pro, Business, Enterprise or Edu plan.").font(.footnote).foregroundStyle(.secondary) }
        case .claude:
            steps([
                "In Claude, open Customize, then Connectors.",
                "Choose + and then Add custom connector. Name it Amber Notes.",
                "Paste the address below as the URL and choose Add. Leave Advanced settings empty.",
                "Choose Connect. Your browser asks to open Amber Notes: allow it, then choose Allow here.",
            ])
            addressSection
        case .claudeCode:
            tokenGuide(
                intro: "Claude Code gets its own access token, sent in a request header. It works in every project.",
                snippet: token.map { ConnectSnippets.claudeCode(url: server, token: $0) },
                note: "Or run this in a terminal. It's shown once; keep it private.")
        case .codex:
            tokenGuide(
                intro: "Codex gets its own access token, sent in a request header.",
                snippet: token.map { ConnectSnippets.codex(url: server, token: $0) },
                note: "Add this to ~/.codex/config.toml. It's shown once; keep it private.")
        }
    }

    private func steps(_ lines: [String]) -> some View {
        Section("Steps") {
            ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(i + 1)").font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(.tint).frame(width: 16)
                    Text(line)
                }
            }
        }
    }

    private var addressSection: some View {
        Section {
            Text(server).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            copyButton("Copy Address", server)
        } header: {
            Text("Server address")
        } footer: {
            Text("The address holds no password. Access is granted only when you choose Allow in Amber Notes, and you can disconnect it here any time.")
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
            let t: String = try await client.rpc("create_mcp_token", params: ["token_name": AnyJSON.string(guide.title), "write_access": AnyJSON.bool(!readOnly)]).execute().value
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
