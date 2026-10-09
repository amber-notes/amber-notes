import SwiftUI
import SwiftData
import Security
import Supabase
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Where share pages live (the Amber Notes site on Vercel), from the build settings.
enum ShareLinkConfig {
    static var baseURL: URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "PaneShareURL") as? String,
              let u = URL(string: s) else { return nil }
        return usable(u, backend: BackendConfig.url) ? u : nil
    }

    /// A link has to open for whoever gets it: a synced account never hands out a localhost link.
    static func usable(_ share: URL, backend: URL?) -> Bool {
        guard share.scheme == "https" || share.scheme == "http" else { return false }
        let local: (URL?) -> Bool = { ["localhost", "127.0.0.1"].contains($0?.host ?? "") }
        return local(share) ? local(backend) : true
    }

    static func url(slug: String, base: URL? = baseURL) -> URL? { base?.appending(path: "n").appending(path: slug) }
}

/// A note's link, as the menu and the indicator see it. Pure, so it's unit-tested.
struct ShareLinkState: Equatable {
    enum Phase: Equatable {
        /// Not looked up yet (or no account).
        case unknown
        case notShared
        case shared(slug: String, includesSubNotes: Bool)
    }

    enum Feedback: Equatable {
        case working(String)
        case done(String)
        case failed(String)
    }

    var phase: Phase = .unknown
    var feedback: Feedback?

    var slug: String? {
        if case .shared(let s, _) = phase { return s }
        return nil
    }

    var includesSubNotes: Bool {
        if case .shared(_, let i) = phase { return i }
        return false
    }

    var isWorking: Bool {
        if case .working = feedback { return true }
        return false
    }

    // The steps of each action: press → working → done (or failed).

    mutating func begin(_ message: String) { feedback = .working(message) }

    mutating func shared(slug: String, includesSubNotes: Bool, copied: Bool) {
        let wasShared = self.slug != nil
        phase = .shared(slug: slug, includesSubNotes: includesSubNotes)
        feedback = .done(copied ? (wasShared ? "Link copied" : "Link created and copied") : (includesSubNotes ? "Sub-notes included" : "Sub-notes left out"))
    }

    mutating func stopped() {
        phase = .notShared
        feedback = .done("Sharing stopped")
    }

    mutating func failed(_ message: String) { feedback = .failed(message) }

    mutating func clearFeedback() { feedback = nil }
}

/// Talks to Supabase for one note's link.
protocol ShareLinkService: Sendable {
    func current(note: UUID) async throws -> (slug: String, includesSubNotes: Bool)?
    func share(note: UUID, includeSubNotes: Bool) async throws -> String
    func unshare(note: UUID) async throws
}

struct SupabaseShareLinks: ShareLinkService {
    let client: SupabaseClient
    /// The library the readable copy is made from (see SharePublisher).
    var container: ModelContainer?
    /// Told when sharing changes, so edits are published to the page from then on.
    var sync: SyncEngine?
    /// The signed-in account (the session's, when not given).
    var account: UUID?

    private var user: UUID? { account ?? client.auth.currentUser?.id }

    /// The note's live link, only when this account's key made it (its tag verifies): a share row
    /// planted or changed without the key reads as not shared.
    func current(note: UUID) async throws -> (slug: String, includesSubNotes: Bool)? {
        guard let user,
              let live = try await SharePublisher.liveShare(note: note, client: client),
              SharePublisher.verifies(live, note: note, sealer: Wire.sealer, account: user) else { return nil }
        return (live.slug, live.include_subnotes)
    }

    func share(note: UUID, includeSubNotes: Bool) async throws -> String {
        guard let container, let user else { throw SharePublisher.Failure() }
        let slug = try await SharePublisher.share(note: note, includeSubNotes: includeSubNotes, client: client, container: container, user: user)
        await MainActor.run { sync?.shareChanged(note, includesSubNotes: includeSubNotes) }
        return slug
    }

    func unshare(note: UUID) async throws {
        let live = try? await SharePublisher.liveShare(note: note, client: client)
        // The server deletes the page's copy and its files with the link.
        try await client.rpc("unshare_note", params: ["p_note": note.uuidString.lowercased()]).execute()
        // Stopped for good: this device never publishes to it again, whatever the table says later.
        if let live, let user { RevokedShares.remember([live.slug], account: user) }
        await MainActor.run { sync?.shareChanged(note, includesSubNotes: nil) }
    }
}

/// The readable copy a shared page shows. The server can't read the notes, so this device
/// publishes one: the note, the sub-notes the link includes (any depth, only live, unlocked ones),
/// and the files they embed. It's written again as the notes change (SyncEngine) and deleted with
/// the link.
///
/// Only for a share this account made: every share carries a tag (`E2EE.shareTag`, an HMAC under
/// a subkey of the data key over the note, the slug and whether sub-notes are included), and
/// before anything is published the live share is read and its tag checked. A share row planted
/// or changed by anyone without the key publishes nothing, and neither does a link this account
/// stopped (`RevokedShares`). The sub-notes a page includes are the notes linked from their
/// parent's own (sealed) text whose `parent_id` is that parent: the server can't add a note by
/// changing `parent_id`, and a link alone doesn't pull in a note that lives elsewhere.
@MainActor
enum SharePublisher {
    struct Failure: LocalizedError { var errorDescription: String? { "This note couldn't be published. Try again." } }

    struct Page: Encodable, Sendable, Equatable { var id: String; var parent_id: String; var title: String; var body: String }
    /// `files`: the ids of the files the note and its pages embed.
    struct Copy: Encodable, Sendable, Equatable { var title: String; var body: String; var pages: [Page]; var files: [String] }
    struct Published: Decodable { var slug: String; var missing_files: [UUID]? }
    /// A live row of note_shares, as the server has it.
    struct LiveShare: Decodable, Equatable, Sendable { var slug: String; var include_subnotes: Bool; var share_tag: String? }

    /// Files over this aren't published (the server's limit); the page shows them as unavailable.
    static let maxFileBytes = 10 * 1024 * 1024
    /// At most this many sub-notes on one page.
    static let maxPages = 500

    nonisolated static func slugIsValid(_ slug: String) -> Bool { slug.wholeMatch(of: /[A-Za-z0-9_-]{24,64}/) != nil }

    /// The note's live share, whoever made it.
    nonisolated static func liveShare(note: UUID, client: SupabaseClient) async throws -> LiveShare? {
        let rows: [LiveShare] = try await client.from("note_shares")
            .select("slug,include_subnotes,share_tag")
            .eq("note_id", value: note.uuidString.lowercased())
            .is("revoked_at", value: nil)
            .limit(1)
            .execute().value
        return rows.first
    }

    /// Whether a share was made by this account (its tag is the one the account's key makes) and
    /// isn't a link this account stopped (`RevokedShares`).
    nonisolated static func verifies(_ share: LiveShare, note: UUID, sealer: Sealer?, account: UUID) -> Bool {
        guard let sealer, slugIsValid(share.slug), !RevokedShares.contains(share.slug, account: account) else { return false }
        return sealer.shareTagMatches(note: note, slug: share.slug, includeSubNotes: share.include_subnotes, tag: share.share_tag)
    }

    /// The notes a body links to (`pane-note:<id>`), in order, each once.
    nonisolated static func linkedNotes(in body: String) -> [UUID] {
        var out: [UUID] = []
        for m in body.matches(of: /pane-note:([0-9a-fA-F-]{36})/) {
            if let id = UUID(uuidString: String(m.1)), !out.contains(id) { out.append(id) }
        }
        return out
    }

    /// The sub-notes a page of `root` includes, with the note that links each: breadth first
    /// through the links in the (local, readable) text. A locked, trashed or deleted note, and
    /// one this device doesn't have, is left out with everything only it links to.
    static func subNotes(of root: Note, in context: ModelContext) -> [(note: Note, parent: UUID)] {
        var out: [(Note, UUID)] = []
        var queue = [root]
        var seen: Set<UUID> = [root.id]
        while !queue.isEmpty, out.count < maxPages {
            let parent = queue.removeFirst()
            for id in linkedNotes(in: parent.body) where seen.insert(id).inserted {
                // Both halves: the parent's own (sealed) text links it, and the child says it's
                // under that parent. A link to a note that lives elsewhere, or a parent_id alone,
                // puts nothing on the page.
                guard let child = context.note(id), child.parentID == parent.id,
                      child.deletedAt == nil, child.trashedAt == nil, child.lockedBody == nil else { continue }
                queue.append(child)
                out.append((child, parent.id))
                if out.count >= maxPages { break }
            }
        }
        return out
    }

    static func copy(of id: UUID, includeSubNotes: Bool, in context: ModelContext) -> Copy? {
        guard let root = context.note(id), root.lockedBody == nil, root.deletedAt == nil, root.trashedAt == nil else { return nil }
        var pages: [Page] = []
        var bodies = [root.body]
        if includeSubNotes {
            for (child, parent) in subNotes(of: root, in: context) {
                bodies.append(child.body)
                pages.append(Page(id: child.id.uuidString.lowercased(), parent_id: parent.uuidString.lowercased(), title: child.title, body: child.body))
            }
        }
        var files: [String] = []
        for body in bodies {
            for m in body.matches(of: /pane-file:([0-9a-fA-F-]{36})/) {
                guard let fid = UUID(uuidString: String(m.1)), let a = context.attachment(fid), a.deletedAt == nil else { continue }
                let key = fid.uuidString.lowercased()
                if !files.contains(key) { files.append(key) }
            }
        }
        return Copy(title: root.title, body: root.body, pages: pages, files: files)
    }

    /// Creates the note's link (or keeps the live one this account made) with its copy and tag,
    /// then the files it still needs. A live share that doesn't verify was never this account's:
    /// it's stopped first, and a new link is made.
    static func share(note: UUID, includeSubNotes: Bool, client: SupabaseClient, container: ModelContainer, user: UUID) async throws -> String {
        let context = container.mainContext
        guard let sealer = Wire.sealer, let copy = copy(of: note, includeSubNotes: includeSubNotes, in: context) else { throw Failure() }
        let id = note.uuidString.lowercased()
        if let live = try await liveShare(note: note, client: client), !verifies(live, note: note, sealer: sealer, account: user) {
            try await client.rpc("unshare_note", params: ["p_note": id]).execute()
            RevokedShares.remember([live.slug], account: user)
        }
        // A link this account stopped is never tagged again: a slug handed out that's one of
        // them is refused, and asked for once more.
        var slug: String = try await client.rpc("share_slug", params: ["p_note": id]).execute().value
        if RevokedShares.contains(slug, account: user) {
            slug = try await client.rpc("share_slug", params: ["p_note": id]).execute().value
            guard !RevokedShares.contains(slug, account: user) else { throw Failure() }
        }
        guard slugIsValid(slug) else { throw Failure() }
        let tag = sealer.shareTag(note: note, slug: slug, includeSubNotes: includeSubNotes)
        struct Params: Encodable { var p_note: String; var p_slug: String; var p_include_subnotes: Bool; var p_tag: String; var p_copy: Copy }
        let published: Published = try await client.rpc("share_note", params: Params(p_note: id, p_slug: slug, p_include_subnotes: includeSubNotes,
                                                                                    p_tag: tag, p_copy: copy)).execute().value
        guard published.slug == slug else { throw Failure() }
        await upload(published.missing_files ?? [], slug: slug, client: client, context: context, user: user)
        return slug
    }

    /// A shared note (or a note in its page tree) changed: its page's copy is written again, under
    /// the live link only if that link verifies, and with the sub-notes it says. Returns the slug
    /// published to, or nil when nothing was.
    @discardableResult
    static func republish(root: UUID, client: SupabaseClient, context: ModelContext, user: UUID) async -> String? {
        guard let live = try? await liveShare(note: root, client: client), verifies(live, note: root, sealer: Wire.sealer, account: user),
              let copy = copy(of: root, includeSubNotes: live.include_subnotes, in: context) else { return nil }
        struct Params: Encodable { var p_note: String; var p_slug: String; var p_copy: Copy }
        // Null when the link isn't live any more.
        guard let published: Published? = try? await client.rpc("publish_share", params: Params(p_note: root.uuidString.lowercased(), p_slug: live.slug, p_copy: copy)).execute().value,
              let published, published.slug == live.slug else { return nil }
        await upload(published.missing_files ?? [], slug: live.slug, client: client, context: context, user: user)
        return live.slug
    }

    /// Readable copies of the files the page embeds and the server doesn't have yet.
    static func upload(_ ids: [UUID], slug: String, client: SupabaseClient, context: ModelContext, user: UUID) async {
        struct Params: Encodable { var p_slug: String; var p_attachment: String; var p_filename: String; var p_content_type: String; var p_content: String }
        for id in ids {
            guard let a = context.attachment(id), a.deletedAt == nil, a.size <= maxFileBytes else { continue }
            let name = a.filename, mime = a.type.preferredMIMEType ?? "application/octet-stream"
            var data = try? Data(contentsOf: FileStore.url(for: a.id, filename: a.filename))
            if data == nil, let sealer = Wire.sealer {
                data = try? await SyncEngine.fetchFile(client: client, user: user, id: id, sealer: sealer)
            }
            guard let data, data.count <= maxFileBytes else { continue }
            _ = try? await client.rpc("publish_share_file", params: Params(p_slug: slug, p_attachment: id.uuidString.lowercased(), p_filename: name,
                                                                          p_content_type: mime, p_content: data.base64EncodedString())).execute()
        }
    }
}

/// Links this account stopped, remembered per account in a synced iCloud Keychain item (every
/// device of the account knows them, the server can't touch them): from Stop Sharing and from
/// share rows seen stopped. Nothing is published to one again and none is tagged again, whatever
/// the table says later: a stopped row brought back by whoever can write the table (with a tag
/// they kept from before) would otherwise verify and go live again.
///
/// Each write merges into what the item holds (another device's entries included), so two
/// devices don't lose each other's. Lists from before this was synced (UserDefaults) are read too,
/// and folded into the item on the next write.
enum RevokedShares {
    /// Tests keep theirs apart; tasks they start inherit it.
    @TaskLocal static var testStore: (any StoppedShareStore)?
    static let keychain: any StoppedShareStore = KeychainStoppedShares()
    private static var store: any StoppedShareStore { testStore ?? keychain }
    /// The newest this many are kept.
    static let remembered = 3000
    private static let lock = NSLock()

    private static func legacyKey(_ account: UUID) -> String { "share.revoked.\(account.uuidString.lowercased())" }
    /// This device's list from before the synced item (never in tests).
    private static func legacy(_ account: UUID) -> [String] {
        testStore == nil ? UserDefaults.standard.stringArray(forKey: legacyKey(account)) ?? [] : []
    }

    static func slugs(account: UUID) -> Set<String> {
        lock.withLock { Set(store.load(account: account)).union(legacy(account)) }
    }

    static func contains(_ slug: String, account: UUID) -> Bool { slugs(account: account).contains(slug) }

    static func remember(_ slugs: some Sequence<String>, account: UUID) {
        let adding = Array(slugs)
        lock.withLock {
            let stored = store.load(account: account), old = legacy(account)
            let merged = merge(stored, old + adding)
            guard merged != stored else { return }
            if store.save(merged, account: account), !old.isEmpty {
                UserDefaults.standard.removeObject(forKey: legacyKey(account))
            }
        }
    }

    /// `adding` after what's there, each slug once, the newest `remembered` kept.
    static func merge(_ existing: [String], _ adding: [String]) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for s in existing + adding where seen.insert(s).inserted { out.append(s) }
        return Array(out.suffix(remembered))
    }
}

/// Where the stopped links are kept: one list of slugs per account.
protocol StoppedShareStore: Sendable {
    func load(account: UUID) -> [String]
    @discardableResult func save(_ slugs: [String], account: UUID) -> Bool
}

/// In-memory runs (tests). Stores made with the same `Item` are one account's devices sharing
/// the synced item.
final class MemoryStoppedShares: StoppedShareStore, @unchecked Sendable {
    final class Item: @unchecked Sendable {
        fileprivate var lists: [UUID: [String]] = [:]
        fileprivate let lock = NSLock()
        init() {}
    }

    let item: Item
    init(item: Item = Item()) { self.item = item }
    func load(account: UUID) -> [String] { item.lock.withLock { item.lists[account] ?? [] } }
    func save(_ slugs: [String], account: UUID) -> Bool { item.lock.withLock { item.lists[account] = slugs }; return true }
}

/// The stopped links in the Keychain: a synchronizable item (iCloud Keychain, end-to-end
/// encrypted by Apple), readable after the first unlock so sync works in the background, in the
/// default access group like the data key (`KeychainAccountKeyStore`). Its value is a JSON list of
/// slugs. Builds without the data protection keychain keep it on this device only, as they keep
/// the data key.
struct KeychainStoppedShares: StoppedShareStore {
    static let service = AppIdentity.keychainPrefix + ".stopped-shares"

    private static func query(_ account: UUID) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account.uuidString.lowercased(),
         kSecUseDataProtectionKeychain as String: true,
         kSecAttrSynchronizable as String: kSecAttrSynchronizableAny]
    }

    private static let fallback = SessionStorage()
    private static func fallbackName(_ account: UUID) -> String { "stopped-shares-\(account.uuidString.lowercased())" }

    func load(account: UUID) -> [String] {
        let data: Data?
        if KeychainAccountKeyStore.dataProtectionAvailable {
            var q = Self.query(account)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            data = SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
        } else {
            data = try? Self.fallback.retrieve(key: Self.fallbackName(account))
        }
        return data.flatMap { try? JSONDecoder().decode([String].self, from: $0) } ?? []
    }

    func save(_ slugs: [String], account: UUID) -> Bool {
        guard let data = try? JSONEncoder().encode(slugs) else { return false }
        guard KeychainAccountKeyStore.dataProtectionAvailable else {
            return (try? Self.fallback.store(key: Self.fallbackName(account), value: data)) != nil
        }
        let updated = SecItemUpdate(Self.query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        guard updated == errSecItemNotFound else { return updated == errSecSuccess }
        var q = Self.query(account)
        q[kSecAttrSynchronizable as String] = true
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        q[kSecAttrLabel as String] = "Amber Notes stopped share links"
        q[kSecValueData as String] = data
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
}

/// One note's share link: looks it up, creates, copies and stops it, with feedback for each step.
@MainActor
@Observable
final class ShareLinkStore {
    private(set) var state = ShareLinkState()
    private(set) var noteID: UUID?
    private var service: ShareLinkService?
    private var feedbackTask: Task<Void, Never>?
    /// Puts the link on the clipboard (tests swap it so they never touch yours).
    @ObservationIgnored var copyURL: @MainActor (URL?) -> Void = { ShareLinkStore.copy($0) }
    /// The share site; tests set their own.
    @ObservationIgnored var baseURL: URL? = ShareLinkConfig.baseURL

    init(state: ShareLinkState = ShareLinkState(), noteID: UUID? = nil, service: ShareLinkService? = nil) {
        self.state = state
        self.noteID = noteID
        self.service = service
    }

    var isAvailable: Bool { service != nil && baseURL != nil }

    /// What making something public is waiting on: you confirm before anything becomes readable by link.
    enum PublicStep: Equatable { case createLink, includeSubNotes }
    var confirming: PublicStep?
    /// Where "you've been told what sharing publishes" is kept, per note. Tests use their own.
    @ObservationIgnored var defaults: UserDefaults = .standard
    /// "You used Share Link" (its tip goes, here and on your other devices). Tests leave it out:
    /// it reaches TipKit and the app-wide settings.
    @ObservationIgnored var markUsed: (Feature) -> Void = { FeatureUse.mark($0) }

    nonisolated static func askedKey(_ note: UUID) -> String { "share.asked.\(note.uuidString.lowercased())" }

    /// Share Link…: asks once per note (sharing publishes a readable copy), then just shares. The
    /// sharing, when it starts, is returned so a caller can wait for it.
    @discardableResult
    func requestShare() -> Task<Void, Never>? {
        guard let note = noteID else { return nil }
        // No network: said at once, not after reading what sharing publishes.
        if !NetworkPath.shared.isUp {
            state.failed(Self.offline)
            settleFeedback()
            return nil
        }
        if defaults.bool(forKey: Self.askedKey(note)) {
            return Task { await shareAndCopy() }
        }
        confirming = .createLink
        return nil
    }

    /// You read what sharing publishes and went ahead.
    func confirmedShare() async {
        if let note = noteID { defaults.set(true, forKey: Self.askedKey(note)) }
        await shareAndCopy()
    }

    /// Called when the note on screen changes.
    func load(note: UUID, service: ShareLinkService?) async {
        // Same note, same account situation: keep what's shown.
        if noteID == note, (service == nil) == (self.service == nil) { return }
        noteID = note
        self.service = service
        state = ShareLinkState()
        guard let service else { return }
        do {
            let found = try await service.current(note: note)
            guard noteID == note else { return }
            state.phase = found.map { .shared(slug: $0.slug, includesSubNotes: $0.includesSubNotes) } ?? .notShared
        } catch {
            // Offline or signed out: the menu still offers Share Link and reports what goes wrong.
            if noteID == note { state.phase = .notShared }
        }
    }

    /// The note was locked: the server stops its link when that syncs.
    func forgetLink() {
        if state.slug != nil { state.phase = .notShared }
    }

    /// Creates the link (or reuses the live one) and copies it.
    func shareAndCopy() async {
        guard let service, let note = noteID else { return }
        state.begin(state.slug == nil ? "Creating link…" : "Copying link…")
        do {
            let slug = try await service.share(note: note, includeSubNotes: state.includesSubNotes)
            guard noteID == note else { return }
            copyURL(ShareLinkConfig.url(slug: slug, base: baseURL))
            state.shared(slug: slug, includesSubNotes: state.includesSubNotes, copied: true)
            markUsed(.shareLink)
        } catch {
            state.failed(Self.message(for: error))
        }
        settleFeedback()
    }

    func setIncludesSubNotes(_ include: Bool) async {
        guard let service, let note = noteID else { return }
        state.begin(include ? "Including sub-notes…" : "Leaving out sub-notes…")
        do {
            let slug = try await service.share(note: note, includeSubNotes: include)
            guard noteID == note else { return }
            state.shared(slug: slug, includesSubNotes: include, copied: false)
        } catch {
            state.failed(Self.message(for: error))
        }
        settleFeedback()
    }

    func stopSharing() async {
        guard let service, let note = noteID else { return }
        state.begin("Stopping…")
        do {
            try await service.unshare(note: note)
            guard noteID == note else { return }
            state.stopped()
        } catch {
            state.failed(Self.message(for: error))
        }
        settleFeedback()
    }

    var url: URL? { state.slug.flatMap { ShareLinkConfig.url(slug: $0, base: baseURL) } }

    /// "Done" and errors show briefly, then go.
    private func settleFeedback() {
        feedbackTask?.cancel()
        let delay: Duration = { if case .failed = state.feedback { return .seconds(4) } else { return .seconds(1.8) } }()
        feedbackTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { self?.state.clearFeedback() }
        }
    }

    static let offline = OfflineCopy.needsNetwork("share this note")

    static func message(for error: Error) -> String {
        if let u = error as? URLError, SyncEngine.reach(after: u) == .offline { return offline }
        let text = String(describing: error).lowercased()
        if text.contains("no such note") { return "Couldn’t share yet. Try again once the note has synced." }
        if text.contains("note_locked") || text.contains("locked note") { return "Locked notes can’t be shared." }
        if text.contains("not signed in") || text.contains("jwt") { return "Sign in to share notes." }
        return "Couldn’t reach Pinto Notes. Check your connection."
    }

    static func copy(_ url: URL?) {
        guard let url else { return }
        #if os(iOS)
        UIPasteboard.general.url = url
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
        #endif
    }
}

/// The note menu's sharing items: Share Link… before a note is shared; Copy Link, sub-notes and
/// Stop Sharing once it is.
struct ShareLinkMenuSection: View {
    let store: ShareLinkStore
    let note: Note

    var body: some View {
        if store.isAvailable {
            Section {
                if store.state.slug == nil {
                    Button("Share Link…", systemImage: "link") { store.requestShare() }
                        .disabled(store.state.isWorking)
                        .accessibilityIdentifier("share.create")
                } else {
                    Button("Copy Link", systemImage: "link") { Task { await store.shareAndCopy() } }
                        .accessibilityIdentifier("share.copy")
                    if let url = store.url {
                        Link(destination: url) { Label("Open Shared Page", systemImage: "safari") }
                    }
                    Toggle(isOn: Binding(get: { store.state.includesSubNotes },
                                         set: { v in
                                             // Turning sub-notes on makes more public: ask first. Leaving them out needs no warning.
                                             if v { store.confirming = .includeSubNotes } else { Task { await store.setIncludesSubNotes(false) } }
                                         })) {
                        Label("Include Sub-notes", systemImage: "doc.on.doc")
                    }
                    .accessibilityIdentifier("share.subnotes")
                    Button("Stop Sharing", systemImage: "xmark.circle", role: .destructive) { Task { await store.stopSharing() } }
                        .accessibilityIdentifier("share.stop")
                }
            }
        }
    }
}

/// The quiet "Shared" marker at the top of a shared note, and the feedback for each action.
private struct ShareLinkChrome: ViewModifier {
    let store: ShareLinkStore
    let note: Note
    @Environment(Backend.self) private var backend: Backend?
    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @State private var profile = ProfileStore.shared
    #if os(macOS)
    @Environment(\.openSettings) private var openSettings
    #else
    @State private var showProfile = false
    #endif

    /// A shared page says who it's from. Without a name or photo it falls back to your email
    /// (or "Amber Notes user"), so sharing is the moment to suggest filling them in.
    private var profileIncomplete: Bool { profile.name == nil || profile.photo == nil }

    private func editProfile() {
        SettingsRoute.shared.open(.account)
        #if os(macOS)
        openSettings()
        #else
        showProfile = true
        #endif
    }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                VStack(spacing: 6) {
                    if let feedback = store.state.feedback { toast(feedback).transition(.opacity.combined(with: .offset(y: 6))) }
                }
                .padding(.bottom, 20)
                .animation(.snappy(duration: 0.22), value: store.state.feedback)
            }
            .overlay(alignment: .topTrailing) {
                if store.state.slug != nil, store.state.feedback == nil, !note.isLocked {
                    Button { Task { await store.shareAndCopy() } } label: {
                        Label("Shared", systemImage: "link")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 9)
                            .frame(minHeight: 24)
                            .background(.fill.tertiary, in: .capsule)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .help("Anyone with the link can read this note. Click to copy the link.")
                    .accessibilityLabel("Shared. Copy link")
                    .accessibilityIdentifier("share.indicator")
                    .padding(.top, 10)
                    .padding(.trailing, 14)
                    .transition(.opacity)
                }
            }
            .alert(alertTitle, isPresented: Binding(get: { store.confirming != nil }, set: { if !$0 { store.confirming = nil } }), presenting: store.confirming) { step in
                switch step {
                case .createLink:
                    Button("Create Public Link") { Task { await store.confirmedShare() } }
                        // Not the default button on iPhone: iOS fills it system blue under the
                        // app's amber label, which can't be read.
                        #if os(macOS)
                        .keyboardShortcut(.defaultAction)
                        #endif
                        .accessibilityIdentifier("share.confirm")
                    if profileIncomplete {
                        Button("Add Name and Photo First", action: editProfile)
                            .accessibilityIdentifier("share.profile")
                    }
                case .includeSubNotes:
                    Button("Include Sub-notes") { Task { await store.setIncludesSubNotes(true) } }
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier("share.confirm")
                }
                Button("Cancel", role: .cancel) {}
            } message: { step in
                switch step {
                case .createLink:
                    Text("Sharing puts a readable copy of this note and its files on ambernotes.app, outside your encryption, until you stop sharing. Anyone with the link can read it without signing in, and it may be passed on. The page shows your name and photo, and your email unless Apple hides it. Your edits show there as they sync."
                         + (profileIncomplete ? "\n\nAdd your name and photo so people know the page is from you." : ""))
                case .includeSubNotes:
                    Text("Readable copies of the sub-notes in this note go on ambernotes.app too, for anyone with the link, until you stop sharing. Locked sub-notes are never included.")
                }
            }
            #if os(iOS)
            .sheet(isPresented: $showProfile) {
                if let backend, let sync { SettingsView(backend: backend, sync: sync) }
            }
            #endif
            .task(id: note.id) {
                await store.load(note: note.id, service: backend?.client.map { SupabaseShareLinks(client: $0, container: context.container, sync: sync) })
            }
    }

    private var alertTitle: String {
        let title = note.title.isEmpty ? "this note" : "“\(note.title)”"
        return store.confirming == .includeSubNotes ? "Make sub-notes public too?" : "Share \(title) publicly?"
    }

    @ViewBuilder
    private func toast(_ f: ShareLinkState.Feedback) -> some View {
        HStack(spacing: 8) {
            switch f {
            case .working(let text):
                ProgressView().controlSize(.small)
                Text(text)
            case .done(let text):
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                Text(text)
            case .failed(let text):
                Image(systemName: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
                Text(text)
            }
        }
        .font(.callout.weight(.medium))
        .foregroundStyle(.primary)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.bar, in: .capsule)
        .overlay(Capsule().strokeBorder(.separator, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("share.feedback")
    }
}

extension View {
    func shareLinkChrome(_ store: ShareLinkStore, note: Note) -> some View {
        modifier(ShareLinkChrome(store: store, note: note))
    }
}
