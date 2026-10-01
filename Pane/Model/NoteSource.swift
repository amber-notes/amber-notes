import Foundation
import SwiftData

// "Use this template" and "Use this note": the website links to a note the app can add to your
// notes. A template is a note structure from ambernotes.app/templates (with the prompt that has
// an AI fill it in); a shared page (ambernotes.app/n/<slug>) can be copied the same way.
//
//     https://ambernotes.app/open/template/<slug>    ambernotes://template/<slug>
//     https://ambernotes.app/open/copy/<share slug>  ambernotes://copy/<share slug>
//
// The site's apple-app-site-association claims /open/*, so the https links open the app.

// MARK: Pure pieces (tested)

/// A link to a note the app can add: a template or a shared page.
struct NoteSourceLink: Hashable, Identifiable, Sendable {
    enum Kind: String, Sendable { case template, copy }
    let kind: Kind
    let slug: String
    var id: String { "\(kind.rawValue):\(slug)" }

    static let scheme = "ambernotes"
    static let webHosts: Set<String> = ["ambernotes.app", "www.ambernotes.app"]

    /// Template slugs, as the site names them: lowercase words joined by hyphens.
    static func validTemplateSlug(_ s: String) -> Bool {
        s.count <= 64 && s.range(of: #"^[a-z0-9]+(-[a-z0-9]+)*$"#, options: .regularExpression) != nil
    }

    /// Share slugs, as the site checks them (web/lib/shared.ts).
    static func validShareSlug(_ s: String) -> Bool {
        s.range(of: #"^[A-Za-z0-9_-]{24,64}$"#, options: .regularExpression) != nil
    }

    /// The slug is one the site could have made. A link that isn't never reaches the network.
    var isValid: Bool { kind == .template ? Self.validTemplateSlug(slug) : Self.validShareSlug(slug) }

    /// The template or copy link in `url`, if it is one (its slug may still be invalid).
    static func parse(_ url: URL) -> NoteSourceLink? {
        let scheme = url.scheme?.lowercased(), host = url.host?.lowercased() ?? ""
        var parts = url.path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if parts.first == "" { parts.removeFirst() }
        if parts.last == "", parts.count > 1 { parts.removeLast() }
        let route: (kind: String, slug: String)?
        if scheme == Self.scheme {
            // ambernotes://template/<slug>: the kind is the host.
            route = parts.count <= 1 ? (host, parts.first ?? "") : nil
        } else if scheme == "https", webHosts.contains(host), parts.count == 3, parts[0] == "open" {
            route = (parts[1], parts[2])
        } else if scheme == "https", webHosts.contains(host), parts.count == 2, parts[0] == "open" {
            route = (parts[1], "")
        } else {
            route = nil
        }
        guard let route, let kind = Kind(rawValue: route.kind) else { return nil }
        return NoteSourceLink(kind: kind, slug: route.slug)
    }
}

/// A template as ambernotes.app/templates/<slug>.json serves it. Read tolerantly: unknown keys
/// are ignored and a newer version still gives the fields this build knows.
struct NoteTemplate: Decodable, Equatable, Sendable {
    struct Instruction: Decodable, Equatable, Identifiable, Sendable {
        let client: String
        let name: String
        let prompt: String
        var id: String { client }
    }

    var version: Int
    var slug: String
    var title: String
    var category: String?
    var audience: String?
    var description: String?
    var folder: String?
    var note: String
    var instructions: [Instruction]
    var example: String?
    var url: URL?

    private enum Keys: String, CodingKey { case version, slug, title, category, audience, description, folder, note, instructions, example, url }

    /// One instruction that doesn't read is left out, not the whole template.
    private struct Lossy: Decodable {
        let value: Instruction?
        init(from decoder: Decoder) throws { value = try? Instruction(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? 1
        slug = try c.decode(String.self, forKey: .slug)
        title = try c.decode(String.self, forKey: .title)
        note = try c.decode(String.self, forKey: .note)
        category = try? c.decodeIfPresent(String.self, forKey: .category)
        audience = try? c.decodeIfPresent(String.self, forKey: .audience)
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        folder = (try? c.decodeIfPresent(String.self, forKey: .folder))?.trimmingCharacters(in: .whitespacesAndNewlines)
        if folder?.isEmpty == true { folder = nil }
        instructions = ((try? c.decodeIfPresent([Lossy].self, forKey: .instructions)) ?? []).compactMap(\.value)
        example = try? c.decodeIfPresent(String.self, forKey: .example)
        url = try? c.decodeIfPresent(URL.self, forKey: .url)
    }
}

/// What the sheet offers to add, from a template or a shared page.
struct NoteDraft: Equatable, Sendable {
    let link: NoteSourceLink
    var title: String
    var body: String
    var description: String?
    /// The folder the template suggests; a shared page suggests none.
    var folder: String?
    var instructions: [NoteTemplate.Instruction] = []
    /// Photos and files in a shared page: they belong to its owner and don't come along.
    var leftOut = 0

    init(template t: NoteTemplate, link: NoteSourceLink) {
        self.link = link
        title = t.title
        body = t.note
        description = t.description
        folder = t.folder
        instructions = t.instructions
    }

    init(link: NoteSourceLink, title: String, body: String, leftOut: Int) {
        self.link = link
        self.title = title
        self.body = body
        self.leftOut = leftOut
    }
}

/// Why a template or shared page couldn't be shown.
enum NoteSourceError: Error, Equatable, Sendable {
    case badLink(NoteSourceLink.Kind)
    case notFound(NoteSourceLink.Kind)
    case offline
    case unavailable

    var title: String {
        switch self {
        case .badLink: "This link isn't complete"
        case .notFound(.template): "Template not found"
        case .notFound(.copy): "This note isn't shared anymore"
        case .offline: "You're offline"
        case .unavailable: "Couldn't load it"
        }
    }

    var message: String {
        switch self {
        case .badLink(.template): "Open the template again from ambernotes.app/templates."
        case .badLink(.copy): "Ask for the link again, or open the shared page and choose Use this note."
        case .notFound(.template): "It may have been renamed. Find it again at ambernotes.app/templates."
        case .notFound(.copy): "The person who shared it stopped sharing, or the link has changed."
        case .offline: "Connect to the internet, then try again."
        case .unavailable: "Something went wrong on the way. Try again in a moment."
        }
    }

    /// Worth another try without a new link.
    var canRetry: Bool { self == .offline || self == .unavailable }

    static func from(_ error: Error) -> NoteSourceError {
        if let e = error as? NoteSourceError { return e }
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost,
                 .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff:
                return .offline
            default: return .unavailable
            }
        }
        return .unavailable
    }
}

/// A shared page's text, made into a note of your own: its photos and files stay with its owner
/// (they're dropped, and counted), and links to its sub-notes become their plain names.
enum SharedCopy {
    private static let id = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"

    static func clean(_ body: String) -> (body: String, leftOut: Int) {
        var text = body
        var leftOut = 0
        // Photos (![…](pane-file:…)) and file chips ([…](pane-file:…)).
        let file = try! NSRegularExpression(pattern: #"!?\[[^\]\n]*\]\(pane-file:"# + id + #"\)"#)
        leftOut = file.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
        text = file.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
        // Sub-note links keep their names.
        let sub = try! NSRegularExpression(pattern: #"\[([^\]\n]*)\]\(pane-note:"# + id + #"\)"#)
        text = sub.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "$1")
        // A line that held only a photo or a file goes, without leaving a gap of blank lines.
        let lines = text.components(separatedBy: "\n")
        var out: [String] = []
        for line in lines {
            let blank = line.trimmingCharacters(in: .whitespaces).isEmpty
            if blank, let last = out.last, last.trimmingCharacters(in: .whitespaces).isEmpty { continue }
            out.append(blank ? "" : line)
        }
        while out.last == "" { out.removeLast() }
        return (out.joined(separator: "\n"), leftOut)
    }
}

// MARK: Fetching

protocol NoteSourceFetching: Sendable {
    func draft(for link: NoteSourceLink) async throws -> NoteDraft
}

/// Templates from the website, shared pages from the public share RPC (as the website reads them).
struct WebNoteSource: NoteSourceFetching {
    var site = URL(string: "https://ambernotes.app")!
    var supabaseURL: URL? = BackendConfig.url
    var anonKey: String? = BackendConfig.key
    var session: URLSession = .shared
    var timeout: TimeInterval = 15

    func draft(for link: NoteSourceLink) async throws -> NoteDraft {
        guard link.isValid else { throw NoteSourceError.badLink(link.kind) }
        do {
            switch link.kind {
            case .template: return try await template(link)
            case .copy: return try await copy(link)
            }
        } catch {
            throw NoteSourceError.from(error)
        }
    }

    private func template(_ link: NoteSourceLink) async throws -> NoteDraft {
        var req = URLRequest(url: site.appendingPathComponent("templates/\(link.slug).json"), timeoutInterval: timeout)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { throw NoteSourceError.notFound(.template) }
        guard (200..<300).contains(status), let t = try? JSONDecoder().decode(NoteTemplate.self, from: data),
              !t.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw NoteSourceError.unavailable }
        return NoteDraft(template: t, link: link)
    }

    private struct Shared: Decodable { let title: String?; let body: String }

    private func copy(_ link: NoteSourceLink) async throws -> NoteDraft {
        guard let supabaseURL, let anonKey else { throw NoteSourceError.unavailable }
        var req = URLRequest(url: supabaseURL.appendingPathComponent("rest/v1/rpc/shared_note"), timeoutInterval: timeout)
        req.httpMethod = "POST"
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["p_slug": link.slug, "p_sub": NSNull()])
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw NoteSourceError.unavailable }
        // A page that's no longer shared (or was locked) answers null.
        let decoded: Shared?
        do { decoded = try JSONDecoder().decode(Shared?.self, from: data) } catch { throw NoteSourceError.unavailable }
        guard let shared = decoded else { throw NoteSourceError.notFound(.copy) }
        let cleaned = SharedCopy.clean(shared.body)
        let title = shared.title.flatMap { $0.isEmpty ? nil : $0 } ?? NoteText.title(of: cleaned.body)
        return NoteDraft(link: link, title: title, body: cleaned.body, leftOut: cleaned.leftOut)
    }
}

// MARK: Remembering what was added

/// Which note each template or shared page became, per account, so adding the same one twice
/// asks first. Kept on this device; a note added elsewhere isn't known here.
struct NoteSourceLedger {
    let defaults: UserDefaults
    let account: String

    init(defaults: UserDefaults = .standard, account: UUID?) {
        self.defaults = defaults
        self.account = account?.uuidString.lowercased() ?? "local"
    }

    private var key: String { "noteSources.\(account)" }
    private var map: [String: String] { defaults.dictionary(forKey: key) as? [String: String] ?? [:] }

    func note(for link: NoteSourceLink) -> UUID? { map[link.id].flatMap(UUID.init(uuidString:)) }

    func record(_ link: NoteSourceLink, note: UUID) {
        var m = map
        m[link.id] = note.uuidString
        defaults.set(m, forKey: key)
    }

    /// The note this link already made, if it's still in your notes (not deleted, not in Recently Deleted).
    @MainActor func existing(_ link: NoteSourceLink, in context: ModelContext) -> Note? {
        guard let id = note(for: link), let n = context.note(id), n.deletedAt == nil, n.trashedAt == nil else { return nil }
        return n
    }
}

// MARK: Adding

/// Where the note goes: a folder you have, or a new one by name.
enum FolderChoice: Hashable {
    case existing(UUID)
    case new(String)
}

@MainActor
extension ModelContext {
    /// A folder's place in the list, as "Work/Clients".
    func folderPath(_ f: Folder) -> String {
        var names = [f.name]
        var p = f.parent
        while let up = p, names.count < 20 { names.insert(up.name, at: 0); p = up.parent }
        return names.joined(separator: "/")
    }

    /// Where a draft goes unless you choose: the folder it suggests (one you have by that name,
    /// or a new one), else your first folder.
    func suggestedFolder(for draft: NoteDraft) -> FolderChoice {
        let folders = allFolders()
        if let name = draft.folder {
            if let f = folders.first(where: { $0.parent == nil && $0.name.compare(name, options: .caseInsensitive) == .orderedSame }) { return .existing(f.id) }
            return .new(name)
        }
        if let f = folders.filter({ $0.parent == nil }).min(by: { $0.sortIndex < $1.sortIndex }) { return .existing(f.id) }
        return .new("Notes")
    }

    /// Adds the draft as a note of your own, the way a new note is made (it syncs, sealed, like any other).
    @discardableResult
    func addNote(from draft: NoteDraft, to choice: FolderChoice) -> Note {
        let folder: Folder
        switch choice {
        case .existing(let id):
            folder = self.folder(id).flatMap { $0.deletedAt == nil ? $0 : nil } ?? defaultFolder()
        case .new(let name):
            let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if let f = allFolders().first(where: { $0.parent == nil && $0.name.compare(clean, options: .caseInsensitive) == .orderedSame }) {
                folder = f
            } else {
                folder = createFolder(named: clean.isEmpty ? "Notes" : clean)
            }
        }
        return createNote(in: .folder(folder.id), body: draft.body)
    }
}

// MARK: The sheet's state

/// One link's sheet: loading, the draft to add, a failure, or added.
@MainActor
@Observable
final class NoteSourceModel {
    enum Phase: Equatable {
        case loading
        case failed(NoteSourceError)
        case ready(NoteDraft)
        case added(NoteDraft, note: UUID, folder: String)
    }

    let link: NoteSourceLink
    private(set) var phase: Phase = .loading
    var folder: FolderChoice?
    /// Set when this link already made a note you still have: the sheet asks before adding another.
    var duplicate: UUID?
    @ObservationIgnored private let source: NoteSourceFetching
    @ObservationIgnored private let ledger: NoteSourceLedger

    init(link: NoteSourceLink, source: NoteSourceFetching, ledger: NoteSourceLedger) {
        self.link = link
        self.source = source
        self.ledger = ledger
    }

    var draft: NoteDraft? {
        switch phase {
        case .ready(let d), .added(let d, _, _): d
        default: nil
        }
    }

    func load(context: ModelContext) async {
        guard link.isValid else { phase = .failed(.badLink(link.kind)); return }
        phase = .loading
        do {
            let d = try await source.draft(for: link)
            if folder == nil { folder = context.suggestedFolder(for: d) }
            phase = .ready(d)
        } catch {
            phase = .failed(NoteSourceError.from(error))
        }
    }

    /// Adds the note. The second time for the same link, it asks first (`duplicate`) unless `again`.
    func add(context: ModelContext, again: Bool = false) {
        guard case .ready(let d) = phase else { return }
        if !again, let n = ledger.existing(link, in: context) { duplicate = n.id; return }
        duplicate = nil
        let note = context.addNote(from: d, to: folder ?? context.suggestedFolder(for: d))
        ledger.record(link, note: note.id)
        phase = .added(d, note: note.id, folder: note.folder.map(context.folderPath) ?? "Notes")
    }
}

/// The link waiting for its sheet. Links arrive before the notes are open (signed out, or the
/// key not here yet); the sheet shows once they are.
@MainActor
@Observable
final class NoteSourceCenter {
    static let shared = NoteSourceCenter()
    var pending: NoteSourceLink?

    /// True when `url` is a template or copy link (taken, even if its slug is bad: the sheet says so).
    @discardableResult
    func receive(_ url: URL) -> Bool {
        guard let link = NoteSourceLink.parse(url) else { return false }
        pending = link
        return true
    }
}
