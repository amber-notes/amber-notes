import SwiftUI
import SwiftData
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
    /// The library, for the readable copy an encrypted account publishes (see SharePublisher).
    var container: ModelContainer?

    private struct Row: Decodable {
        var slug: String
        var include_subnotes: Bool
    }

    func current(note: UUID) async throws -> (slug: String, includesSubNotes: Bool)? {
        let rows: [Row] = try await client.from("note_shares")
            .select("slug, include_subnotes")
            .eq("note_id", value: note.uuidString.lowercased())
            .is("revoked_at", value: nil)
            .limit(1)
            .execute().value
        return rows.first.map { ($0.slug, $0.include_subnotes) }
    }

    func share(note: UUID, includeSubNotes: Bool) async throws -> String {
        // An encrypted account's note can't be read by the server: the page shows a copy made here.
        if E2EE.sealer != nil, let container {
            let made = await MainActor.run { SharePublisher.copy(of: note, includeSubNotes: includeSubNotes, in: container.mainContext) }
            guard let made else { throw SharePublisher.Failure() }
            struct Params: Encodable { var p_note: String; var p_include_subnotes: Bool; var p_copy: SharePublisher.Copy }
            let slug: String = try await client.rpc("share_note", params: Params(p_note: note.uuidString.lowercased(), p_include_subnotes: includeSubNotes, p_copy: made.copy)).execute().value
            await SharePublisher.upload(made.files, slug: slug, client: client)
            return slug
        }
        return try await client.rpc("share_note", params: ["p_note": AnyJSON.string(note.uuidString.lowercased()),
                                                            "p_include_subnotes": AnyJSON.bool(includeSubNotes)]).execute().value
    }

    func unshare(note: UUID) async throws {
        let slug = try? await current(note: note)?.slug
        try await client.rpc("unshare_note", params: ["p_note": note.uuidString.lowercased()]).execute()
        // The readable file copies go with the link.
        if let slug { await SharePublisher.removeFiles(slug: slug, client: client) }
    }
}

/// The readable copy of a shared note that an encrypted account publishes: the note, the sub-notes
/// the link includes (any depth, never locked or deleted ones), and the files they link to.
@MainActor
enum SharePublisher {
    struct Failure: LocalizedError { var errorDescription: String? { "This note couldn't be published. Try again." } }

    struct Page: Encodable, Sendable { var id: String; var parent_id: String; var title: String; var body: String }
    struct File: Encodable, Sendable { var id: String; var filename: String; var content_type: String; var size: Int64 }
    struct Copy: Encodable, Sendable { var title: String; var body: String; var pages: [Page]; var files: [File] }
    /// A file's readable bytes on this device, to go up next to the page.
    struct Upload: Sendable { var id: UUID; var url: URL; var mime: String }

    static func copy(of id: UUID, includeSubNotes: Bool, in context: ModelContext) -> (copy: Copy, files: [Upload])? {
        guard let root = context.note(id), root.lockedBody == nil, root.deletedAt == nil else { return nil }
        var pages: [Page] = []
        var bodies = [root.body]
        if includeSubNotes {
            let all = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.deletedAt == nil && $0.trashedAt == nil && $0.lockedBody == nil }
            var queue = [root.id]
            var seen: Set<UUID> = [root.id]
            while let parent = queue.first, pages.count < 500 {
                queue.removeFirst()
                for child in all where child.parentID == parent && !seen.contains(child.id) {
                    seen.insert(child.id)
                    queue.append(child.id)
                    bodies.append(child.body)
                    pages.append(Page(id: child.id.uuidString.lowercased(), parent_id: parent.uuidString.lowercased(), title: child.title, body: child.body))
                }
            }
        }
        var files: [Attachment] = []
        for body in bodies {
            for m in body.matches(of: /pane-file:([0-9a-fA-F-]{36})/) {
                if let fid = UUID(uuidString: String(m.1)), let a = context.attachment(fid), a.deletedAt == nil, !files.contains(where: { $0.id == fid }) {
                    files.append(a)
                }
            }
        }
        let copy = Copy(title: root.title, body: root.body, pages: pages,
                        files: files.map { File(id: $0.id.uuidString.lowercased(), filename: $0.filename, content_type: $0.contentType, size: $0.size) })
        let uploads = files.filter { FileStore.exists($0) }.map {
            Upload(id: $0.id, url: FileStore.url(for: $0.id, filename: $0.filename), mime: $0.type.preferredMIMEType ?? "application/octet-stream")
        }
        return (copy, uploads)
    }

    /// The files' readable copies, next to the page: shared/<slug>/<attachment id>.
    nonisolated static func upload(_ files: [Upload], slug: String, client: SupabaseClient) async {
        for f in files {
            guard let data = try? Data(contentsOf: f.url) else { continue }
            _ = try? await client.storage.from("shared").upload("\(slug)/\(f.id.uuidString.lowercased())", data: data,
                                                               options: FileOptions(contentType: f.mime, upsert: true))
        }
    }

    nonisolated static func removeFiles(slug: String, client: SupabaseClient) async {
        guard let listed = try? await client.storage.from("shared").list(path: slug), !listed.isEmpty else { return }
        _ = try? await client.storage.from("shared").remove(paths: listed.map { "\(slug)/\($0.name)" })
    }

    /// A shared note (or an included sub-note) changed: its page's copy is written again.
    static func republish(root: UUID, includeSubNotes: Bool, client: SupabaseClient, context: ModelContext) async {
        guard let made = copy(of: root, includeSubNotes: includeSubNotes, in: context) else { return }
        struct Params: Encodable { var p_note: String; var p_copy: Copy }
        guard let slug: String? = try? await client.rpc("publish_share", params: Params(p_note: root.uuidString.lowercased(), p_copy: made.copy)).execute().value,
              let slug else { return }
        await upload(made.files, slug: slug, client: client)
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
            FeatureUse.mark(.shareLink)
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

    static func message(for error: Error) -> String {
        let text = String(describing: error).lowercased()
        if text.contains("no such note") { return "Couldn’t share yet. Try again once the note has synced." }
        if text.contains("note_locked") || text.contains("locked note") { return "Locked notes can’t be shared." }
        if text.contains("not signed in") || text.contains("jwt") { return "Sign in to share notes." }
        return "Couldn’t reach Amber Notes. Check your connection."
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
                    Button("Share Link…", systemImage: "link") { store.confirming = .createLink }
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
                    Button("Create Public Link") { Task { await store.shareAndCopy() } }
                        .keyboardShortcut(.defaultAction)
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
                    Text("Anyone with the link can read this note without signing in, and it may be passed on. Sharing publishes a readable copy of it, and of the files in it, outside your encryption. The page shows your name and photo, and your email unless Apple hides it. Edits show as soon as they sync. Stop Sharing deletes the copy."
                         + (profileIncomplete ? "\n\nAdd your name and photo so people know the page is from you." : ""))
                case .includeSubNotes:
                    Text("The sub-notes linked from this note are published as readable copies too, for anyone with the link.")
                }
            }
            #if os(iOS)
            .sheet(isPresented: $showProfile) {
                if let backend, let sync { SettingsView(backend: backend, sync: sync) }
            }
            #endif
            .task(id: note.id) {
                await store.load(note: note.id, service: backend?.client.map { SupabaseShareLinks(client: $0, container: context.container) })
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
