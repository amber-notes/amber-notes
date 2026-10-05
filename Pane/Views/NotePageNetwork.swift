import Foundation
import Observation
import Security
import SwiftUI

/// The network for a note that is an app (prototype; see NotePage). The page's web view stays fully
/// blocked; a page asks the app with amber.fetch(url, { key }) and the app makes the request:
///
/// - only to hosts the page declared, each approved by you once ("This app wants to reach …");
/// - with an API key from Settings only when the page declared that key and the host is one of the
///   key's hosts; the page never sees the key's value;
/// - and every request goes into the app's log with what was sent (keys redacted), marked when it
///   carries text from the note.
///
/// A page declares what it needs in its HTML:
///     <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"],
///       "keys": [{"name": "OpenWeather", "hosts": ["api.openweathermap.org"], "query": "appid={key}",
///                 "help": "Make a free key at openweathermap.org, under API keys."}]}'>
enum NotePageNetwork {
    struct KeyNeed: Codable, Equatable, Identifiable {
        var name: String
        var hosts: [String]
        /// "Authorization: Bearer {key}" or "X-Api-Key: {key}"
        var header: String?
        /// "appid={key}"
        var query: String?
        var help: String?
        var id: String { name }
    }

    struct Needs: Codable, Equatable {
        var hosts: [String] = []
        var keys: [KeyNeed] = []

        init(hosts: [String] = [], keys: [KeyNeed] = []) { self.hosts = hosts; self.keys = keys }

        /// Either list may be left out.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            hosts = try c.decodeIfPresent([String].self, forKey: .hosts) ?? []
            keys = try c.decodeIfPresent([KeyNeed].self, forKey: .keys) ?? []
        }
    }

    static func needs(of stored: String) -> Needs {
        let html = NotePageProject.entryHTML(stored)
        guard let r = html.range(of: #"<meta[^>]*name=["']amber-needs["'][^>]*>"#, options: .regularExpression) else { return Needs() }
        let tag = String(html[r])
        guard let c = tag.range(of: #"content=(['"])([\s\S]*)\1"#, options: .regularExpression) else { return Needs() }
        var value = String(tag[c].dropFirst("content=".count))
        value = String(value.dropFirst().dropLast()).replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&#39;", with: "'")
        guard let n = try? JSONDecoder().decode(Needs.self, from: Data(value.utf8)) else { return Needs() }
        return Needs(hosts: n.hosts.map { $0.lowercased() }.filter { !$0.isEmpty }.prefix(20).map { $0 },
                     keys: n.keys.prefix(10).map { k in KeyNeed(name: String(k.name.prefix(60)), hosts: k.hosts.map { $0.lowercased() }, header: k.header, query: k.query, help: k.help.map { String($0.prefix(600)) }) })
    }

    /// host[:port], as approvals and keys name it.
    /// A declared host, or "*.example.org" for every server under example.org (whole labels; never
    /// a bare top-level domain like "*.org", and not example.org itself).
    static func matches(_ pattern: String, _ host: String) -> Bool {
        guard pattern.hasPrefix("*.") else { return pattern == host }
        let base = pattern.dropFirst(2)
        return base.contains(".") && !base.contains("*") && host.hasSuffix("." + base)
    }

    /// The declared host or pattern a host falls under (an exact one first).
    static func rule(for host: String, in declared: [String]) -> String? {
        declared.first { $0 == host } ?? declared.first { matches($0, host) }
    }

    /// How a host or pattern is named when asking: "archive.org and its servers".
    static func shown(_ rule: String) -> String { rule.hasPrefix("*.") ? "\(rule.dropFirst(2)) and its servers" : rule }

    static func hostKey(_ url: URL) -> String? {
        guard let h = url.host?.lowercased() else { return nil }
        return url.port.map { "\(h):\($0)" } ?? h
    }

    /// Plain http only to this device's own address (a local server while developing).
    static func allowedScheme(_ url: URL) -> Bool {
        let s = url.scheme?.lowercased()
        return s == "https" || (s == "http" && ["localhost", "127.0.0.1"].contains(url.host?.lowercased() ?? ""))
    }

    /// The request with the key filled in, or why not.
    static func inject(_ key: KeyNeed, value: String, into request: inout URLRequest) throws {
        if let header = key.header, let colon = header.firstIndex(of: ":") {
            let name = header[..<colon].trimmingCharacters(in: .whitespaces)
            let v = header[header.index(after: colon)...].trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "{key}", with: value)
            request.setValue(v, forHTTPHeaderField: name)
        } else if let query = key.query, let eq = query.firstIndex(of: "="), let url = request.url, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            let name = String(query[..<eq])
            let v = String(query[query.index(after: eq)...]).replacingOccurrences(of: "{key}", with: value)
            c.queryItems = (c.queryItems ?? []).filter { $0.name != name } + [URLQueryItem(name: name, value: v)]
            request.url = c.url
        } else {
            throw NotePage.OpError("The key \(key.name) says neither a header nor a query parameter.")
        }
    }

    /// Text from the note in what's being sent: any of its lines of 6 characters or more.
    static func carriesNoteText(_ sent: String, note: String) -> Bool {
        let hay = (sent.removingPercentEncoding ?? sent).lowercased()
        return note.components(separatedBy: "\n")
            .map { NoteText.stripMarkup($0).lowercased() }
            .contains { $0.count >= 6 && hay.contains($0) }
    }
}

/// Which hosts each app may reach, and what it sent. Approvals are kept per note, on this device.
@MainActor
@Observable
final class NotePageNetLog {
    struct Entry: Codable, Identifiable, Equatable {
        var id = UUID()
        var at: Date
        var method: String
        /// With any key value replaced by •••.
        var url: String
        var sent: String
        var status: Int?
        var error: String?
        var key: String?
        var carriesNoteText: Bool
    }

    static let shared = NotePageNetLog(defaults: ProcessInfo.processInfo.arguments.contains("-uitest") || PaneApp.isUnitTestHost ? nil : .standard)

    private(set) var approved: [UUID: Set<String>] = [:]
    private(set) var entries: [UUID: [Entry]] = [:]
    @ObservationIgnored private let defaults: UserDefaults?

    init(defaults: UserDefaults?) {
        self.defaults = defaults
        if let d = defaults?.data(forKey: "notePageApprovedHosts"), let a = try? JSONDecoder().decode([UUID: Set<String>].self, from: d) { approved = a }
        if let d = defaults?.data(forKey: "notePageNetLog"), let e = try? JSONDecoder().decode([UUID: [Entry]].self, from: d) { entries = e }
    }

    func isApproved(_ host: String, for id: UUID) -> Bool { approved[id]?.contains(host) == true }

    func approve(_ host: String, for id: UUID) {
        approved[id, default: []].insert(host)
        defaults?.set(try? JSONEncoder().encode(approved), forKey: "notePageApprovedHosts")
    }

    func forget(_ id: UUID) {
        approved[id] = nil
        defaults?.set(try? JSONEncoder().encode(approved), forKey: "notePageApprovedHosts")
    }

    func add(_ e: Entry, for id: UUID) {
        entries[id, default: []].append(e)
        entries[id] = Array(entries[id]!.suffix(200))
        defaults?.set(try? JSONEncoder().encode(entries), forKey: "notePageNetLog")
    }
}

/// API keys for apps, in the Keychain (synced with iCloud Keychain, like the account's key): never
/// in a note, never in an app's data, never sent anywhere but their own hosts.
@MainActor
@Observable
final class APIKeyStore {
    struct Key: Codable, Equatable, Identifiable {
        var name: String
        var hosts: [String]
        var header: String?
        var query: String?
        var id: String { name }
    }

    static let shared = APIKeyStore(memory: ProcessInfo.processInfo.arguments.contains("-uitest") || PaneApp.isUnitTestHost)
    private static let service = "dev.emilwagman.pane.apikey"

    private(set) var keys: [Key] = []
    @ObservationIgnored private let memory: Bool
    @ObservationIgnored private var values: [String: String] = [:]

    init(memory: Bool) {
        self.memory = memory
        if !memory { load() }
    }

    func has(_ name: String) -> Bool { keys.contains { $0.name == name } }

    /// The server row for a key's name (api_key_names): the same on every device.
    nonisolated static func rowID(_ name: String) -> UUID {
        let c = Array(E2EE.sha256Hex("api-key|" + name).prefix(32))
        return UUID(uuidString: [c[0..<8], c[8..<12], c[12..<16], c[16..<20], c[20..<32]].map { String($0) }.joined(separator: "-")) ?? UUID()
    }

    func key(_ name: String) -> Key? { keys.first { $0.name == name } }

    func value(_ name: String) -> String? {
        if memory { return values[name] }
        var q = base(name)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    func save(_ key: Key, value: String) {
        defer { SyncSignal.changed() }
        keys.removeAll { $0.name == key.name }
        keys.append(key)
        keys.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        if memory { values[key.name] = value; return }
        SecItemDelete(base(key.name) as CFDictionary)
        var q = base(key.name)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrGeneric as String] = try? JSONEncoder().encode(key)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    func remove(_ name: String) {
        defer { SyncSignal.changed() }
        keys.removeAll { $0.name == name }
        if memory { values[name] = nil; return }
        SecItemDelete(base(name) as CFDictionary)
    }

    private func base(_ name: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: name,
         kSecAttrSynchronizable as String: true]
    }

    private func load() {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
                                kSecAttrSynchronizable as String: kSecAttrSynchronizableAny, kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return }
        keys = items.compactMap { ($0[kSecAttrGeneric as String] as? Data).flatMap { try? JSONDecoder().decode(Key.self, from: $0) } }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}

extension NotePageNetwork {
    /// amber.fetch: the request an app asked for, made by the app (see the type's notes).
    /// `ask` shows "This app wants to reach …" once per host; `needKey` shows the card for a key
    /// that isn't set up.
    @MainActor
    static func fetch(_ m: [String: Any], note: Note, html: String, ask: (String) async -> Bool, needKey: (KeyNeed) async -> Void) async throws -> [String: Any] {
        guard let s = m["url"] as? String, let url = URL(string: s), allowedScheme(url), let host = hostKey(url) else {
            throw NotePage.OpError("amber.fetch takes an https address.")
        }
        let needs = needs(of: html)
        let store = APIKeyStore.shared
        var key: (need: KeyNeed, stored: APIKeyStore.Key, value: String)?
        if let name = m["key"] as? String {
            guard let need = needs.keys.first(where: { $0.name == name }) else { throw NotePage.OpError("This app didn't declare a key named \(name).") }
            guard let stored = store.key(name), let value = store.value(name) else {
                await needKey(need)
                throw NotePage.OpError("This app needs the \(name) API key. Add it in Settings › API Keys.")
            }
            guard rule(for: host, in: need.hosts) != nil, rule(for: host, in: stored.hosts) != nil else { throw NotePage.OpError("The \(name) key isn't sent to \(host).") }
            key = (need, stored, value)
        } else if rule(for: host, in: needs.hosts) == nil {
            throw NotePage.OpError("This app didn't declare \(host). Add it to <meta name=\"amber-needs\">.")
        }
        let log = NotePageNetLog.shared
        // Approved once per declared host or pattern.
        let approval = rule(for: host, in: needs.hosts) ?? host
        if key == nil, !log.isApproved(approval, for: note.id) {
            guard await ask(shown(approval)) else { throw NotePage.OpError("You didn't allow this app to reach \(host).") }
            log.approve(approval, for: note.id)
        } else if key != nil, !log.isApproved(host, for: note.id) {
            guard await ask(host) else { throw NotePage.OpError("You didn't allow this app to reach \(host).") }
            log.approve(host, for: note.id)
        }
        var request = URLRequest(url: url, timeoutInterval: 20)
        let method = ((m["method"] as? String) ?? "GET").uppercased()
        guard ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(method) else { throw NotePage.OpError("Method \(method) isn't allowed.") }
        request.httpMethod = method
        for (k, v) in (m["headers"] as? [String: String] ?? [:]).prefix(20) where !["cookie", "host"].contains(k.lowercased()) { request.setValue(v, forHTTPHeaderField: k) }
        let body = (m["body"] as? String) ?? ""
        guard body.utf8.count <= 1_000_000 else { throw NotePage.OpError("A request body can be at most 1 MB.") }
        if !body.isEmpty { request.httpBody = Data(body.utf8) }
        if let key {
            var format = key.need
            format.header = key.stored.header ?? key.need.header
            format.query = key.stored.query ?? key.need.query
            try inject(format, value: key.value, into: &request)
        }
        func redact(_ s: String) -> String { key.map { s.replacingOccurrences(of: $0.value, with: "•••") } ?? s }
        let shownURL = redact(request.url?.absoluteString ?? s)
        var entry = NotePageNetLog.Entry(at: .now, method: method, url: shownURL, sent: redact(body), key: key?.need.name,
                                         carriesNoteText: carriesNoteText(shownURL + "\n" + body, note: note.body))
        // Redirects go only where the request itself could: a declared, approved host (or, with a
        // key, one of the key's hosts). Each hop is logged.
        var allowed = needs.hosts.filter { log.isApproved($0, for: note.id) }
        if let key { allowed = key.need.hosts.filter { h in key.stored.hosts.contains(h) } }
        let guard_ = RedirectGuard(allowed: allowed)
        do {
            let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request, delegate: guard_)
            let http = response as? HTTPURLResponse
            entry.status = http?.statusCode
            log.add(entry, for: note.id)
            for hop in guard_.hops {
                log.add(.init(at: .now, method: method, url: redact(hop), sent: "", status: http?.statusCode, key: key?.need.name, carriesNoteText: carriesNoteText(hop, note: note.body)), for: note.id)
            }
            if let refused = guard_.refused {
                log.add(.init(at: .now, method: method, url: redact(refused), sent: "", error: "Not followed: not a declared, allowed address", key: key?.need.name, carriesNoteText: false), for: note.id)
                throw NotePage.OpError("The service sent the request on to \(URL(string: refused)?.host ?? refused), which this app didn't declare. It wasn't followed.")
            }
            guard data.count <= 5 * 1024 * 1024 else { throw NotePage.OpError("The answer was over 5 MB.") }
            var out: [String: Any] = ["status": http?.statusCode ?? 0, "contentType": http?.value(forHTTPHeaderField: "Content-Type") ?? ""]
            if let text = String(data: data, encoding: .utf8) { out["body"] = text } else { out["body"] = data.base64EncodedString(); out["base64"] = true }
            return out
        } catch let e as NotePage.OpError {
            throw e
        } catch {
            entry.error = error.localizedDescription
            log.add(entry, for: note.id)
            throw NotePage.OpError("The request failed: \(error.localizedDescription)")
        }
    }
}

/// Settings › API Keys: keys that apps can use, by name. Values go to the Keychain and are never
/// shown again.
struct APIKeysSection: View {
    @State private var editing: APIKeyForm.Draft?
    private var store: APIKeyStore { .shared }

    var body: some View {
        Section {
            ForEach(store.keys) { k in
                VStack(alignment: .leading, spacing: 2) {
                    Text(k.name)
                    Text(k.hosts.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                }
                .swipeActions { Button("Delete", role: .destructive) { store.remove(k.name) } }
                .contextMenu { Button("Delete", role: .destructive) { store.remove(k.name) } }
            }
            Button("Add API Key…") { editing = APIKeyForm.Draft() }
                .accessibilityIdentifier("settings.addAPIKey")
        } header: {
            Text("API Keys")
        } footer: {
            Text("A note that is an app can use these to reach a service, only at the addresses you list. The app never sees the key; Amber Notes adds it to the request.")
        }
        .sheet(item: $editing) { d in APIKeyForm(draft: d) }
    }
}

struct APIKeyForm: View {
    struct Draft: Identifiable {
        var name = ""
        var hosts = ""
        var asHeader = true
        var format = "Authorization: Bearer {key}"
        var help: String?
        var id: String { name }

        init() {}
        init(_ need: NotePageNetwork.KeyNeed) {
            name = need.name
            hosts = need.hosts.joined(separator: ", ")
            asHeader = need.query == nil
            format = need.query ?? need.header ?? "Authorization: Bearer {key}"
            help = need.help
        }
    }

    @State var draft: Draft
    @State private var value = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $draft.name).accessibilityIdentifier("apikey.name")
                    TextField("Addresses, like api.example.com", text: $draft.hosts).accessibilityIdentifier("apikey.hosts")
                        #if os(iOS)
                        .textInputAutocapitalization(.never).keyboardType(.URL)
                        #endif
                } footer: { Text("The key is only ever sent to these addresses.") }
                Section {
                    Picker("Send it as", selection: $draft.asHeader) {
                        Text("A header").tag(true)
                        Text("Part of the address").tag(false)
                    }
                    TextField(draft.asHeader ? "Authorization: Bearer {key}" : "appid={key}", text: $draft.format)
                        .font(.body.monospaced())
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                } footer: { Text("{key} is replaced with the key.") }
                Section {
                    SecureField("Key", text: $value).accessibilityIdentifier("apikey.value")
                } footer: {
                    if let help = draft.help { Text(help) } else { Text("Kept in your Keychain, and in iCloud Keychain on your other devices.") }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("API Key")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let hosts = draft.hosts.split(whereSeparator: { $0 == "," || $0 == " " }).map { $0.lowercased() }.filter { !$0.isEmpty }
                        APIKeyStore.shared.save(.init(name: draft.name.trimmingCharacters(in: .whitespaces), hosts: hosts,
                                                      header: draft.asHeader ? draft.format : nil, query: draft.asHeader ? nil : draft.format), value: value)
                        dismiss()
                    }
                    .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty || draft.hosts.isEmpty || value.isEmpty || !draft.format.contains("{key}"))
                    .accessibilityIdentifier("apikey.save")
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 420)
        #endif
    }
}

/// What an app sent, newest first: the address and body as they left (keys hidden), and whether
/// they carried text from the note.
struct NotePageNetLogView: View {
    let noteID: UUID
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let entries = (NotePageNetLog.shared.entries[noteID] ?? []).reversed()
        let hosts = NotePageNetLog.shared.approved[noteID] ?? []
        NavigationStack {
            List {
                Section("Allowed") {
                    if hosts.isEmpty { Text("None yet").foregroundStyle(.secondary) }
                    ForEach(hosts.sorted(), id: \.self) { Text($0) }
                    if !hosts.isEmpty { Button("Forget These", role: .destructive) { NotePageNetLog.shared.forget(noteID) } }
                }
                Section("Requests") {
                    if entries.isEmpty { Text("This app hasn't sent anything.").foregroundStyle(.secondary) }
                    ForEach(Array(entries)) { e in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(e.method).font(.caption.monospaced().weight(.semibold))
                                Text(e.status.map(String.init) ?? e.error ?? "").font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Text(e.at, style: .time).font(.caption).foregroundStyle(.secondary)
                            }
                            Text(e.url).font(.caption.monospaced()).textSelection(.enabled)
                            if !e.sent.isEmpty { Text(e.sent).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(6) }
                            if let k = e.key { Label("Used the \(k) key (hidden here)", systemImage: "key").font(.caption).foregroundStyle(.secondary) }
                            if e.carriesNoteText {
                                Label("Includes text from this note", systemImage: "text.quote").font(.caption.weight(.semibold)).foregroundStyle(Color.amberInk)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .navigationTitle("Network Activity")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 480)
        #endif
    }
}

/// Follows a redirect only to an allowed host, and remembers each hop.
private final class RedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let allowed: [String]
    private let lock = NSLock()
    private var _hops: [String] = []
    private var _refused: String?
    var hops: [String] { lock.withLock { _hops } }
    var refused: String? { lock.withLock { _refused } }

    init(allowed: [String]) { self.allowed = allowed }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        guard let url = request.url else { completionHandler(nil); return }
        if NotePageNetwork.allowedScheme(url), let host = NotePageNetwork.hostKey(url), NotePageNetwork.rule(for: host, in: allowed) != nil {
            lock.withLock { _hops.append(url.absoluteString) }
            completionHandler(request)
        } else {
            lock.withLock { _refused = url.absoluteString }
            completionHandler(nil)
        }
    }
}
