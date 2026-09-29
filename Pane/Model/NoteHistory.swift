import Foundation
import Supabase
import SwiftData

/// One version of a note: the text it had at some point, who wrote it and when.
///
/// The server keeps a note's earlier texts in `note_revisions` (thinned as they age, see
/// 20260929200000_version_history.sql). The current text is a version too, shown first.
struct NoteVersion: Identifiable, Hashable, Sendable {
    /// The note's version number when it had this text.
    var version: Int64
    var madeAt: Date
    var author: VersionAuthor
    /// Written by restoring an earlier version.
    var restored = false
    var isCurrent = false
    var id: Int64 { version }
}

/// Who wrote a version: you, on one of your devices, or an AI connection.
enum VersionAuthor: Equatable, Hashable, Sendable {
    case you(device: String?)
    case ai(String)

    static let devices: Set<String> = ["iPhone", "iPad", "Mac"]

    /// From the server's `source` ('app', 'mcp', 'restore', 'import') and `client` (a device or an AI's name).
    init(source: String?, client: String?) {
        let client = client?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        switch source {
        case "mcp":
            self = .ai(client ?? "An AI")
        case "restore" where client.map { !Self.devices.contains($0) } ?? false:
            // An AI restored it with its restore_revision tool.
            self = .ai(client!)
        default:
            self = .you(device: client.flatMap { Self.devices.contains($0) ? $0 : nil })
        }
    }

    /// "You on iPhone", "You", "ChatGPT".
    var name: String {
        switch self {
        case .you(let device?): "You on \(device)"
        case .you(nil): "You"
        case .ai(let name): name
        }
    }

    var isAI: Bool { if case .ai = self { true } else { false } }
}

/// One row in the history list: a version, or a burst of typing shown as its last version.
struct HistoryEntry: Identifiable, Equatable, Sendable {
    /// The newest version in the entry: the one previewed and restored.
    var version: NoteVersion
    /// How many versions it stands for.
    var count = 1
    var id: Int64 { version.version }
}

/// A day's entries in the list, newest first.
struct HistoryDay: Identifiable, Equatable, Sendable {
    var title: String
    var day: Date
    var entries: [HistoryEntry]
    var id: Date { day }
}

/// How the list is put together: bursts of typing collapse, AI edits never do, days group.
enum HistoryGrouping {
    /// Your edits on one device, each within this long of the next, are one entry.
    static let burst: TimeInterval = 5 * 60

    /// `versions` newest first. The current version always stands alone at the top.
    static func entries(_ versions: [NoteVersion]) -> [HistoryEntry] {
        var out: [HistoryEntry] = []
        var oldestInLast: Date?
        for v in versions {
            if let last = out.last, let oldest = oldestInLast, joins(v, last.version, oldest) {
                out[out.count - 1].count += 1
                oldestInLast = v.madeAt
            } else {
                out.append(HistoryEntry(version: v))
                oldestInLast = v.madeAt
            }
        }
        return out
    }

    private static func joins(_ v: NoteVersion, _ newest: NoteVersion, _ oldest: Date) -> Bool {
        guard !v.isCurrent, !newest.isCurrent, !v.restored, !newest.restored,
              case .you(let a) = v.author, case .you(let b) = newest.author, a == b else { return false }
        let gap = oldest.timeIntervalSince(v.madeAt)
        return gap >= 0 && gap <= burst
    }

    /// Entries under "Today", "Yesterday" or the date, newest day first.
    static func days(_ entries: [HistoryEntry], now: Date = .now, calendar: Calendar = .current) -> [HistoryDay] {
        var out: [HistoryDay] = []
        for e in entries {
            let day = calendar.startOfDay(for: e.version.madeAt)
            if out.last?.day == day { out[out.count - 1].entries.append(e); continue }
            out.append(HistoryDay(title: title(for: day, now: now, calendar: calendar), day: day, entries: [e]))
        }
        return out
    }

    static func title(for day: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        if calendar.isDate(day, inSameDayAs: now) { return "Today" }
        if let y = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(day, inSameDayAs: y) { return "Yesterday" }
        let sameYear = calendar.component(.year, from: day) == calendar.component(.year, from: now)
        var style = Date.FormatStyle(date: .omitted, time: .omitted).weekday(.wide).day().month(.wide)
        if !sameYear { style = style.year() }
        style.calendar = calendar
        style.timeZone = calendar.timeZone
        return day.formatted(style.locale(calendar.locale ?? .current))
    }
}

/// Which lines of an earlier version differ from the note as it is now.
enum HistoryDiff {
    /// The lines of `version` that aren't in `current` at that point (added or rewritten since),
    /// as UTF-16 ranges into `version`, without their line breaks. Blank lines are left out.
    static func changedLines(in version: String, comparedTo current: String) -> [NSRange] {
        let old = version.components(separatedBy: "\n")
        let now = current.components(separatedBy: "\n")
        var changed = IndexSet()
        for change in old.difference(from: now) {
            if case .insert(let offset, let line, _) = change, !line.trimmingCharacters(in: .whitespaces).isEmpty {
                changed.insert(offset)
            }
        }
        var ranges: [NSRange] = []
        var location = 0
        for (i, line) in old.enumerated() {
            let length = (line as NSString).length
            if changed.contains(i) { ranges.append(NSRange(location: location, length: length)) }
            location += length + 1
        }
        return ranges
    }

    /// "3 lines differ from the current note."
    static func summary(_ count: Int) -> String {
        switch count {
        case 0: "Same text as the current note."
        case 1: "1 line differs from the current note."
        default: "\(count) lines differ from the current note."
        }
    }
}

// MARK: Where versions come from

enum HistoryError: LocalizedError, Equatable {
    case offline
    case gone
    case other(String)

    var errorDescription: String? {
        switch self {
        case .offline: "You're offline. Connect to the internet to see this note's earlier versions."
        case .gone: "That version is no longer kept."
        case .other(let s): s
        }
    }

    static func from(_ error: Error) -> HistoryError {
        if let h = error as? HistoryError { return h }
        if error is URLError { return .offline }
        let text = (error as? PostgrestError)?.message ?? error.localizedDescription
        if text.contains("no longer kept") { return .gone }
        return .other("Something went wrong: \(text)")
    }
}

/// Reads a note's versions and restores one. The server in the app; a made-up history for
/// demos and tests.
@MainActor
protocol NoteHistoryStore: AnyObject {
    /// Every kept version, the current one first, newest first.
    func versions(of note: UUID) async throws -> [NoteVersion]
    func body(of note: UUID, version: Int64) async throws -> String
    /// Writes `version`'s text as the note's newest version. Returns the note as the server now
    /// has it, or nil when the store has no server (the text is then written here).
    func restore(note: UUID, version: Int64) async throws -> NoteDTO?
}

/// The history on the server, fetched when you open it. Nothing is cached.
@MainActor
final class SupabaseHistoryStore: NoteHistoryStore {
    let client: SupabaseClient
    private var bodies: [Int64: String] = [:]

    init(client: SupabaseClient) { self.client = client }

    struct RevisionRow: Decodable {
        var version: Int64
        var source: String
        var client: String?
        var created_at: Date
        var body_source: String?
        var body_client: String?
        var body_at: Date?
    }

    struct NoteRow: Decodable {
        var version: Int64
        var updated_at: Date
        var body_source: String?
        var body_client: String?
        var body_at: Date?
    }

    func versions(of note: UUID) async throws -> [NoteVersion] {
        do {
            let (revisions, current) = try await fetch(note, authors: true)
            return Self.versions(revisions: revisions, current: current)
        } catch let e as PostgrestError where e.code == "42703" || e.code == "PGRST204" {
            // A server without 20260929200000_version_history.sql: no authors yet.
            let (revisions, current) = try await fetch(note, authors: false)
            return Self.versions(revisions: revisions, current: current)
        }
    }

    private func fetch(_ note: UUID, authors: Bool) async throws -> ([RevisionRow], NoteRow?) {
        let extra = authors ? ",body_source,body_client,body_at" : ""
        async let revisions: [RevisionRow] = client.from("note_revisions")
            .select("version,source,client,created_at" + extra)
            .eq("note_id", value: note).order("version", ascending: false).limit(500)
            .execute().value
        async let current: [NoteRow] = client.from("notes")
            .select("version,updated_at" + extra).eq("id", value: note).execute().value
        return try await (revisions, current.first)
    }

    /// Puts rows together into versions. Rows written before authors were recorded take theirs
    /// from the revision just before: its `source`/`client` is the edit that wrote the next text.
    nonisolated static func versions(revisions: [RevisionRow], current: NoteRow?) -> [NoteVersion] {
        let byVersion = Dictionary(revisions.map { ($0.version, $0) }, uniquingKeysWith: { a, _ in a })
        func version(_ v: Int64, source: String?, client: String?, at: Date?, fallback: Date) -> NoteVersion {
            if let source, let at {
                return NoteVersion(version: v, madeAt: at, author: VersionAuthor(source: source, client: client), restored: source == "restore")
            }
            if let before = byVersion[v - 1] {
                return NoteVersion(version: v, madeAt: before.created_at, author: VersionAuthor(source: before.source, client: before.client), restored: before.source == "restore")
            }
            return NoteVersion(version: v, madeAt: fallback, author: .you(device: nil))
        }
        var out: [NoteVersion] = []
        if let c = current {
            var v = version(c.version, source: c.body_source, client: c.body_client, at: c.body_at, fallback: c.updated_at)
            v.isCurrent = true
            out.append(v)
        }
        for r in revisions.sorted(by: { $0.version > $1.version }) where r.version != current?.version {
            out.append(version(r.version, source: r.body_source, client: r.body_client, at: r.body_at, fallback: r.created_at))
        }
        return out
    }

    func body(of note: UUID, version: Int64) async throws -> String {
        if let b = bodies[version] { return b }
        struct Row: Decodable { var body: String }
        let rows: [Row] = try await client.from("note_revisions").select("body")
            .eq("note_id", value: note).eq("version", value: Int(version)).limit(1).execute().value
        guard let b = rows.first?.body else { throw HistoryError.gone }
        bodies[version] = b
        return b
    }

    func restore(note: UUID, version: Int64) async throws -> NoteDTO? {
        let rows: [NoteDTO] = try await client.rpc("restore_note_version", params: ["p_note": AnyJSON.string(note.uuidString), "p_version": AnyJSON.integer(Int(version))])
            .execute().value
        guard let row = rows.first else { throw HistoryError.gone }
        return row
    }
}

/// Signed out or local only: there is no history to show.
@MainActor
final class EmptyHistoryStore: NoteHistoryStore {
    func versions(of note: UUID) async throws -> [NoteVersion] { [] }
    func body(of note: UUID, version: Int64) async throws -> String { throw HistoryError.gone }
    func restore(note: UUID, version: Int64) async throws -> NoteDTO? { throw HistoryError.gone }
}

// MARK: Restoring

/// A note's version history: reading it, and putting an earlier version back.
///
/// `NoteHistory.restore(noteID:toVersion:)` is the one way the app restores a version. It never
/// throws anything away: the text it replaces is kept as a version of its own, on the server and
/// on every device. Undo for an AI's edit calls it with the version before that edit.
@MainActor
final class NoteHistory {
    /// The app's history, set up at launch.
    static var shared: NoteHistory?

    let store: NoteHistoryStore
    let context: ModelContext
    let sync: SyncEngine?

    init(store: NoteHistoryStore, context: ModelContext, sync: SyncEngine?) {
        self.store = store
        self.context = context
        self.sync = sync
    }

    func versions(of note: UUID) async throws -> [NoteVersion] {
        do { return try await store.versions(of: note) } catch { throw HistoryError.from(error) }
    }

    /// A version's text; the current version's is the note's own.
    func body(of note: Note, _ v: NoteVersion) async throws -> String {
        if v.isCurrent { return note.body }
        do { return try await store.body(of: note.id, version: v.version) } catch { throw HistoryError.from(error) }
    }

    /// See the type's comment. Uses the app's shared history.
    static func restore(noteID: UUID, toVersion version: Int64) async throws {
        guard let shared else { throw HistoryError.other("Version history isn't available.") }
        try await shared.restore(noteID: noteID, toVersion: version)
    }

    func restore(noteID: UUID, toVersion version: Int64) async throws {
        guard let note = context.note(noteID) else { throw HistoryError.gone }
        FeatureUse.mark(.versionHistory)
        // Your latest typing goes up first, so the server keeps it as the version being replaced.
        DebouncedSave.flushAll()
        if let sync, note.dirty {
            for attempt in 0..<8 {
                await sync.sync(pulling: false)
                if !note.dirty { break }
                if attempt == 7 { throw HistoryError.offline }
                try? await Task.sleep(for: .milliseconds(400))
            }
        }
        let row: NoteDTO?
        do {
            row = try await store.restore(note: noteID, version: version)
        } catch {
            throw HistoryError.from(error)
        }
        if let row {
            if let sync { sync.adopt(row) } else { note.body = row.body; try? context.save() }
        } else {
            // No server: the text is written here, like any edit.
            note.body = try await store.body(of: noteID, version: version)
            note.touch()
            try? context.save()
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
