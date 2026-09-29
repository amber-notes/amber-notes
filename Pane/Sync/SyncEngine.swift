import Foundation
import Observation
import Supabase
import SwiftData
import os

private let log = Logger(subsystem: "dev.emilwagman.pane", category: "sync")

/// Keeps the local library and Supabase in step.
///
/// Local-first: edits land in SwiftData immediately and are marked dirty. The engine
/// pushes dirty rows (guarded by the server version they were based on), then pulls
/// everything changed on the server since its cursor. Realtime events trigger a pull,
/// so edits from another device or an AI client show up within a second.
/// If both sides changed a note, the newer edit wins and the other is kept as a
/// "conflicted copy", so nothing is ever lost (the server also keeps every revision).
@MainActor
@Observable
final class SyncEngine {
    enum Status: Equatable { case idle, syncing, offline(String), synced(Date) }

    private(set) var status: Status = .idle
    /// True once a sync has completed since launch.
    private(set) var hasSynced = false
    /// Bumps when a pull changed a note, so an open editor can refresh.
    private(set) var remoteChangeTick = 0

    private let backend: Backend
    private let context: ModelContext
    private var pending: Task<Void, Never>?
    private var running = false
    private var again = false
    private var channel: RealtimeChannelV2?
    private var realtimeTasks: [Task<Void, Never>] = []
    /// Rows the server refused (too big, over a limit), keyed by id with the edit time that
    /// was refused. They're skipped until they change again, so one bad row never blocks
    /// the rest of the library.
    private var refused: [UUID: Date] = [:]
    /// The last refusal's message, shown as the sync status.
    private(set) var problem: String?
    /// The account the local library belongs to.
    private var ownerKey: String { "syncOwner" }

    private var cursorKey: String { "syncCursor.\(backend.userID?.uuidString ?? "none")" }
    private var cursor: Date {
        get { UserDefaults.standard.object(forKey: cursorKey) as? Date ?? .distantPast }
        set { UserDefaults.standard.set(newValue, forKey: cursorKey) }
    }

    init(backend: Backend, context: ModelContext) {
        self.backend = backend
        self.context = context
        SyncSignal.onChange = { [weak self] in self?.schedule(after: 1.2) }
    }

    // MARK: Scheduling

    func schedule(after delay: TimeInterval = 0) {
        guard backend.client != nil, case .signedIn = backend.state else { return }
        pending?.cancel()
        pending = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    func sync() async {
        guard let client = backend.client, case .signedIn = backend.state else { return }
        if running { again = true; return }
        running = true
        status = .syncing
        defer { running = false }
        do {
            let slowedDown = try await push(client)
            try await pull(client)
            hasSynced = true
            if slowedDown {
                // The server asked us to slow down: the rest goes up in a little while.
                status = .offline("Syncing a lot of changes, continuing shortly")
                schedule(after: 20)
            } else if let problem {
                status = .offline(problem)
            } else {
                status = .synced(.now)
            }
        } catch {
            log.error("sync failed: \(String(describing: error), privacy: .public)")
            status = .offline(Self.describe(error))
        }
        if again { again = false; await sync() }
    }

    /// Starts realtime and a first sync after sign-in.
    func start() async {
        guard let client = backend.client, case .signedIn = backend.state else { return }
        adoptLibrary()
        await sync()
        guard channel == nil else { return }
        let ch = client.channel("pane-sync")
        let notes = ch.postgresChange(AnyAction.self, schema: "public", table: "notes")
        let folders = ch.postgresChange(AnyAction.self, schema: "public", table: "folders")
        let files = ch.postgresChange(AnyAction.self, schema: "public", table: "attachments")
        try? await ch.subscribeWithError()
        channel = ch
        for stream in [notes, folders, files] {
            realtimeTasks.append(Task { [weak self] in
                for await _ in stream { self?.schedule(after: 0.25) }
            })
        }
    }

    /// This device's library was synced for one account. When a different account signs
    /// in, that library (and its unsynced edits) must never be pushed into the new one, so
    /// it's cleared and the new account's notes are pulled fresh.
    private func adoptLibrary() {
        guard let uid = backend.userID?.uuidString.lowercased() else { return }
        let previous = UserDefaults.standard.string(forKey: ownerKey)
        defer { UserDefaults.standard.set(uid, forKey: ownerKey) }
        guard let previous, previous != uid else { return }
        log.notice("a different account signed in: clearing this device's library")
        for n in (try? context.fetch(FetchDescriptor<Note>())) ?? [] { context.delete(n) }
        for f in (try? context.fetch(FetchDescriptor<Folder>())) ?? [] { context.delete(f) }
        for a in (try? context.fetch(FetchDescriptor<Attachment>())) ?? [] { context.delete(a) }
        try? context.save()
        try? FileManager.default.removeItem(at: FileStore.root)
        UserDefaults.standard.removeObject(forKey: "syncCursor.\(previous)")
        refused = [:]
        problem = nil
    }

    func stop() async {
        realtimeTasks.forEach { $0.cancel() }
        realtimeTasks = []
        if let channel { await channel.unsubscribe() }
        channel = nil
    }

    // MARK: Push

    /// Pushes dirty rows. Returns true when the server said "too fast" and the rest should
    /// wait; rows it refuses outright are set aside instead of failing the whole sync.
    private func push(_ client: SupabaseClient) async throws -> Bool {
        problem = nil
        if try await pushFiles(client) { return true }
        let folders = ((try? context.fetch(FetchDescriptor<Folder>(predicate: #Predicate { $0.dirty }))) ?? [])
            .sorted { depth($0) < depth($1) } // parents first, for the foreign key
        for f in folders where !isRefused(f.id, f.updatedAt) {
            let row = FolderDTO(f)
            do {
                let saved: [FolderDTO] = try await client.from("folders").upsert(row).select().execute().value
                if !saved.isEmpty, f.updatedAt <= row.updated_at {
                    f.serverVersion = 1
                    f.dirty = false
                }
            } catch {
                switch Self.refusal(error) {
                case .tooFast?: try? context.save(); return true
                case .refused(let why)?: refuse(f.id, f.updatedAt, "A folder couldn't sync: \(why)")
                case nil: throw error
                }
            }
        }

        let notes = (try? context.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.dirty }))) ?? []
        for n in notes where !isRefused(n.id, n.updatedAt) {
            let sentAt = n.updatedAt
            let row = NoteDTO(n)
            var saved: [NoteDTO]
            do {
                if n.serverVersion == 0 {
                    saved = try await client.from("notes").upsert(row, ignoreDuplicates: true).select().execute().value
                    if saved.isEmpty {
                        // Already on the server (e.g. created there first): treat as an update.
                        saved = try await client.from("notes").update(row.patch).eq("id", value: n.id).select().execute().value
                    }
                } else {
                    saved = try await client.from("notes").update(row.patch)
                        .eq("id", value: n.id).eq("version", value: Int(n.serverVersion))
                        .select().execute().value
                    if saved.isEmpty {
                        saved = try await resolveConflict(client, local: n, row: row)
                    }
                }
            } catch {
                switch Self.refusal(error) {
                case .tooFast?: try? context.save(); return true
                case .refused(let why)?:
                    refuse(n.id, n.updatedAt, "“\(n.title)” couldn't sync: \(why)")
                    continue
                case nil: throw error
                }
            }
            if let s = saved.first {
                n.serverVersion = s.version ?? n.serverVersion
                // Stay dirty if you typed more while this was in flight.
                if n.updatedAt <= sentAt { n.dirty = false }
            }
        }
        try? context.save()
        return false
    }

    private func isRefused(_ id: UUID, _ edited: Date) -> Bool { refused[id] == edited }

    private func refuse(_ id: UUID, _ edited: Date, _ message: String) {
        log.error("server refused \(id, privacy: .public): \(message, privacy: .public)")
        refused[id] = edited
        problem = message
    }

    enum Refusal: Equatable, Sendable { case tooFast, refused(String) }

    /// Sorts a failed write: "too fast" (try again later), "refused" (this row as it stands
    /// can never go up: too big, over a limit, bad data), or nil (network and the like).
    nonisolated static func refusal(_ error: Error) -> Refusal? {
        if let p = error as? PostgrestError {
            switch p.code {
            case "PT429": return .tooFast
            case "PT413", "PT403", "23514", "23503", "23505", "22001", "22P02", "22P05", "22021", "54000", "42501":
                return .refused(p.message)
            default: return nil
            }
        }
        if let s = error as? StorageError {
            switch s.statusCode {
            case "429": return .tooFast
            case "400", "403", "409", "413", "415", "422": return .refused(s.message)
            default: return nil
            }
        }
        return nil
    }

    private func storagePath(_ a: Attachment) -> String? {
        guard let uid = backend.userID else { return nil }
        return "\(uid.uuidString.lowercased())/\(a.id.uuidString.lowercased())/\(Self.storageName(a.filename))"
    }

    /// Uploads new files, then their metadata. Returns true when the server said "too fast".
    private func pushFiles(_ client: SupabaseClient) async throws -> Bool {
        let files = (try? context.fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.dirty || !$0.uploaded }))) ?? []
        for a in files where !isRefused(a.id, a.createdAt) {
            guard let path = storagePath(a) else { continue }
            do {
                if !a.uploaded, a.deletedAt == nil {
                    guard FileStore.exists(a) else { continue }
                    let data = try Data(contentsOf: FileStore.url(for: a.id, filename: a.filename))
                    try await client.storage.from("files").upload(path, data: data, options: FileOptions(contentType: a.type.preferredMIMEType ?? "application/octet-stream", upsert: true))
                    a.uploaded = true
                }
                let row = AttachmentDTO(id: a.id, filename: String(a.filename.prefix(255)), content_type: a.contentType, size: a.size, storage_path: path, created_at: a.createdAt, updated_at: .now, deleted_at: a.deletedAt)
                try await client.from("attachments").upsert(row).execute()
                a.dirty = false
            } catch {
                switch Self.refusal(error) {
                case .tooFast?: return true
                case .refused(let why)?: refuse(a.id, a.createdAt, "“\(a.filename)” couldn't sync: \(why)")
                case nil: throw error
                }
            }
        }
        return false
    }

    /// A file name as one safe storage key segment. Ordinary names pass through unchanged
    /// (so files already uploaded keep their paths); separators, control characters and
    /// dot-only names are replaced, and very long names are shortened.
    nonisolated static func storageName(_ filename: String) -> String {
        var name = String(filename.unicodeScalars.map { c -> Character in
            if c == "/" || c == "\\" || c.properties.generalCategory == .control || c.properties.generalCategory == .format { return "_" }
            return Character(c)
        })
        if name.trimmingCharacters(in: CharacterSet(charactersIn: ". ")).isEmpty { name = "file" }
        if name.utf8.count > 200 {
            let ext = (name as NSString).pathExtension
            var stem = (name as NSString).deletingPathExtension
            while (stem + "." + ext).utf8.count > 200, !stem.isEmpty { stem.removeLast() }
            name = ext.isEmpty ? stem : stem + "." + ext
        }
        return name
    }

    /// Fetches a file's bytes from Storage to this device.
    func download(_ a: Attachment) async -> Bool {
        guard let client = backend.client, let path = storagePath(a) else { return false }
        do {
            let data = try await client.storage.from("files").download(path: path)
            let url = FileStore.url(for: a.id, filename: a.filename)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            log.error("download failed: \(String(describing: error), privacy: .public)")
            return false
        }
    }

    /// The server changed this note since we last saw it, and so did we.
    private func resolveConflict(_ client: SupabaseClient, local n: Note, row: NoteDTO) async throws -> [NoteDTO] {
        let server: [NoteDTO] = try await client.from("notes").select().eq("id", value: n.id).execute().value
        guard let s = server.first else {
            return try await client.from("notes").upsert(row).select().execute().value
        }
        if s.body == row.body { return server }
        if s.updated_at > n.updatedAt {
            // Theirs is newer: keep it, and keep ours as a conflicted copy.
            let copy = Note(body: Self.conflictCopy(of: n.body), folder: n.folder)
            copy.createdAt = n.updatedAt
            copy.updatedAt = n.updatedAt
            context.insert(copy)
            apply(s, to: n)
            return server
        }
        // Ours is newer: overwrite. The server keeps theirs in note_revisions.
        return try await client.from("notes").update(row.patch).eq("id", value: n.id).select().execute().value
    }

    static func conflictCopy(of body: String) -> String {
        var lines = body.components(separatedBy: "\n")
        if let i = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
            lines[i] += " (conflicted copy)"
        }
        return lines.joined(separator: "\n")
    }

    // MARK: Pull

    private func pull(_ client: SupabaseClient) async throws {
        // Overlap the cursor a little: rows can commit slightly out of timestamp order.
        let since = cursor == .distantPast ? cursor : cursor.addingTimeInterval(-5)
        var newest = cursor
        var changed = false

        // Every page, not just the first: the cursor is shared, so rows left behind a page
        // limit would be skipped for good.
        let stamp = since.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
        var folderRows: [FolderDTO] = []
        while true {
            let page: [FolderDTO] = try await client.from("folders").select().gt("server_updated_at", value: stamp)
                .order("server_updated_at").order("id").range(from: folderRows.count, to: folderRows.count + 999).execute().value
            folderRows += page
            if page.count < 1000 { break }
        }
        var byID = Dictionary(uniqueKeysWithValues: context.allFoldersIncludingDeleted().map { ($0.id, $0) })
        for r in folderRows {
            let f = byID[r.id] ?? { let f = Folder(name: r.name); f.id = r.id; context.insert(f); byID[r.id] = f; return f }()
            if f.dirty && f.serverVersion > 0 { continue }
            f.name = r.name
            f.sortIndex = r.sort_index
            f.createdAt = r.created_at
            f.updatedAt = r.updated_at
            f.deletedAt = r.deleted_at
            f.dirty = false
            f.serverVersion = 1
            if let s = r.server_updated_at, s > newest { newest = s }
            changed = true
        }
        // Parents after every folder exists.
        for r in folderRows { byID[r.id]?.parent = r.parent_id.flatMap { byID[$0] } }

        var fileRows: [AttachmentDTO] = []
        while true {
            let page: [AttachmentDTO] = try await client.from("attachments").select().gt("server_updated_at", value: stamp)
                .order("server_updated_at").order("id").range(from: fileRows.count, to: fileRows.count + 999).execute().value
            fileRows += page
            if page.count < 1000 { break }
        }
        for r in fileRows {
            let a = context.attachment(r.id) ?? {
                let a = Attachment(id: r.id, filename: r.filename, contentType: r.content_type, size: r.size)
                context.insert(a)
                return a
            }()
            guard !a.dirty || a.uploaded else { continue }
            a.filename = r.filename
            a.contentType = r.content_type
            a.size = r.size
            a.createdAt = r.created_at
            a.deletedAt = r.deleted_at
            a.uploaded = true
            a.dirty = false
            if let s = r.server_updated_at, s > newest { newest = s }
            changed = true
        }

        var offset = 0
        while true {
            let rows: [NoteDTO] = try await client.from("notes").select()
                .gt("server_updated_at", value: stamp)
                .order("server_updated_at").order("id").range(from: offset, to: offset + 499).execute().value
            for r in rows {
                let local = context.note(r.id)
                if let local, local.dirty, (r.version ?? 0) != local.serverVersion, local.serverVersion != 0 {
                    // Both changed: the next push resolves it.
                    continue
                }
                if let local, local.dirty, local.serverVersion == 0 { continue }
                let n = local ?? { let n = Note(body: r.body); n.id = r.id; context.insert(n); return n }()
                if n.body != r.body { remoteChangeTick += 1 }
                apply(r, to: n)
                n.folder = r.folder_id.flatMap { byID[$0] }
                if let s = r.server_updated_at, s > newest { newest = s }
                changed = true
            }
            if rows.count < 500 { break }
            offset += 500
        }
        if changed { try? context.save() }
        cursor = newest
    }

    private func apply(_ r: NoteDTO, to n: Note) {
        n.body = r.body
        n.parentID = r.parent_id
        n.isPinned = r.is_pinned
        n.createdAt = r.created_at
        n.updatedAt = r.updated_at
        n.trashedAt = r.trashed_at
        n.deletedAt = r.deleted_at
        n.serverVersion = r.version ?? n.serverVersion
        n.dirty = false
    }

    private func depth(_ f: Folder) -> Int {
        var d = 0, c = f.parent
        while let p = c, d < 32 { d += 1; c = p.parent }
        return d
    }

    static func describe(_ error: Error) -> String {
        if let u = error as? URLError {
            switch u.code {
            case .notConnectedToInternet, .networkConnectionLost: return "Offline"
            case .cannotConnectToHost, .cannotFindHost, .timedOut: return "Can't reach the server"
            default: break
            }
        }
        return "Sync paused"
    }
}

// MARK: Wire formats

struct FolderDTO: Codable {
    var id: UUID
    var name: String
    var parent_id: UUID?
    var sort_index: Double
    var created_at: Date
    var updated_at: Date
    var deleted_at: Date?
    var server_updated_at: Date?

    init(_ f: Folder) {
        id = f.id
        name = String(f.name.replacingOccurrences(of: "\u{0}", with: "").prefix(200))
        parent_id = f.parent?.id
        sort_index = f.sortIndex
        created_at = f.createdAt
        updated_at = f.updatedAt
        deleted_at = f.deletedAt
    }

    enum CodingKeys: String, CodingKey { case id, name, parent_id, sort_index, created_at, updated_at, deleted_at, server_updated_at }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(parent_id, forKey: .parent_id)
        try c.encode(sort_index, forKey: .sort_index)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(updated_at, forKey: .updated_at)
        try c.encode(deleted_at, forKey: .deleted_at)
    }
}

struct NoteDTO: Codable {
    var id: UUID
    var body: String
    var folder_id: UUID?
    var parent_id: UUID?
    var is_pinned: Bool
    var created_at: Date
    var updated_at: Date
    var trashed_at: Date?
    var deleted_at: Date?
    var version: Int64?
    var server_updated_at: Date?

    init(_ n: Note) {
        id = n.id
        // Postgres text can't hold NUL; a pasted one would otherwise refuse the whole note.
        body = n.body.contains("\u{0}") ? n.body.replacingOccurrences(of: "\u{0}", with: "") : n.body
        folder_id = n.folder?.id
        parent_id = n.parentID
        is_pinned = n.isPinned
        created_at = n.createdAt
        updated_at = n.updatedAt
        trashed_at = n.trashedAt
        deleted_at = n.deletedAt
    }

    enum CodingKeys: String, CodingKey { case id, body, folder_id, parent_id, is_pinned, created_at, updated_at, trashed_at, deleted_at, version, server_updated_at }

    /// Client-owned columns only; the server sets version and its own clock.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(body, forKey: .body)
        try c.encode(folder_id, forKey: .folder_id)
        try c.encode(parent_id, forKey: .parent_id)
        try c.encode(is_pinned, forKey: .is_pinned)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(updated_at, forKey: .updated_at)
        try c.encode(trashed_at, forKey: .trashed_at)
        try c.encode(deleted_at, forKey: .deleted_at)
    }

    struct Patch: Encodable {
        var body: String
        var folder_id: UUID?
        var parent_id: UUID?
        var is_pinned: Bool
        var updated_at: Date
        var trashed_at: Date?
        var deleted_at: Date?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(body, forKey: .body)
            try c.encode(folder_id, forKey: .folder_id)
            try c.encode(parent_id, forKey: .parent_id)
            try c.encode(is_pinned, forKey: .is_pinned)
            try c.encode(updated_at, forKey: .updated_at)
            try c.encode(trashed_at, forKey: .trashed_at)
            try c.encode(deleted_at, forKey: .deleted_at)
        }
        enum CodingKeys: String, CodingKey { case body, folder_id, parent_id, is_pinned, updated_at, trashed_at, deleted_at }
    }

    var patch: Patch { Patch(body: body, folder_id: folder_id, parent_id: parent_id, is_pinned: is_pinned, updated_at: updated_at, trashed_at: trashed_at, deleted_at: deleted_at) }
}

struct AttachmentDTO: Codable {
    var id: UUID
    var filename: String
    var content_type: String
    var size: Int64
    var storage_path: String
    var created_at: Date
    var updated_at: Date
    var deleted_at: Date?
    var server_updated_at: Date?

    enum CodingKeys: String, CodingKey { case id, filename, content_type, size, storage_path, created_at, updated_at, deleted_at, server_updated_at }

    init(id: UUID, filename: String, content_type: String, size: Int64, storage_path: String, created_at: Date, updated_at: Date, deleted_at: Date?) {
        self.id = id; self.filename = filename; self.content_type = content_type; self.size = size
        self.storage_path = storage_path; self.created_at = created_at; self.updated_at = updated_at; self.deleted_at = deleted_at
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(filename, forKey: .filename)
        try c.encode(content_type, forKey: .content_type)
        try c.encode(size, forKey: .size)
        try c.encode(storage_path, forKey: .storage_path)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(updated_at, forKey: .updated_at)
        try c.encode(deleted_at, forKey: .deleted_at)
    }
}

extension ModelContext {
    func allFoldersIncludingDeleted() -> [Folder] {
        (try? fetch(FetchDescriptor<Folder>())) ?? []
    }
}
