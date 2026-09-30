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
/// everything changed on the server since its cursor.
///
/// Near-live: while you type, the note reaches the model every 0.35 s (DebouncedSave) and
/// goes up at most every 0.35 s on its own, without a pull. Another device's realtime
/// event carries the changed row, which is applied straight away; the cursor pull still
/// runs on launch, foreground, reconnect and every minute, to catch anything missed.
///
/// A note you're editing is never overwritten by what arrives: unwritten typing is written
/// first, a dirty note is skipped, and the push sorts it out by version.
/// If both sides changed a note, the newer edit wins and the other is kept as a
/// "conflicted copy", so nothing is ever lost (the server also keeps every revision).
///
/// End-to-end encrypted: everything goes up sealed with the account's data key (`E2EE.sealer`)
/// and comes down sealed. Without the key nothing moves at all, and a row that doesn't open here
/// is never applied.
@MainActor
@Observable
final class SyncEngine {
    enum Status: Equatable { case idle, syncing, offline(String), synced(Date) }

    private(set) var status: Status = .idle
    /// True once a sync has completed since launch.
    private(set) var hasSynced = false
    /// Bumps when a pull changed a note, so an open editor can refresh.
    private(set) var remoteChangeTick = 0 { didSet { lastChange = .now } }

    private let backend: Backend
    private let context: ModelContext
    private var pending: Task<Void, Never>?
    private var running = false
    private var again = false
    /// A push-only run was asked for while another run was going.
    private var pushAgain = false
    /// Throttled pushes while you type: at most one every `pushInterval`.
    private var pushLoop: Task<Void, Never>?
    private var pushWanted = false
    private var lastPush = Date.distantPast
    static let pushInterval: TimeInterval = 0.35
    private var channel: RealtimeChannelV2?
    /// Realtime is joined and delivering. While it isn't, a short poll stands in (`fallback`).
    private(set) var realtimeUp = false
    /// The app is in front; nothing polls in the background.
    private var active = true
    private var started = false
    private var fallback: Task<Void, Never>?
    /// The last change either way, for backing the poll off when nothing is happening.
    private var lastChange = Date.now
    /// How often to pull while realtime is down: every `fast`, or every `slow` once nothing has
    /// changed for `slowAfter`. Tests shorten these.
    static var fallbackPoll: (fast: Duration, slow: Duration, slowAfter: TimeInterval) = (.seconds(8), .seconds(30), 300)
    private var realtimeTasks: [Task<Void, Never>] = []
    /// Rows the server refused (too big, over a limit), keyed by id with the edit time that
    /// was refused. They're skipped until they change again, so one bad row never blocks
    /// the rest of the library.
    private var refused: [UUID: Date] = [:]
    /// The last refusal's message, shown as the sync status.
    private(set) var problem: String?
    /// The account the local library belongs to.

    private var cursorKey: String { "syncCursor.\(backend.userID?.uuidString ?? "none")" }
    private var cursor: Date {
        get { defaults.object(forKey: cursorKey) as? Date ?? .distantPast }
        set { defaults.set(newValue, forKey: cursorKey) }
    }
    /// Where the pull cursor is kept; tests give each simulated device its own.
    private let defaults: UserDefaults

    /// Seals conflicted copies of locked notes; the app's vault unless a test gives its own.
    private let lockVault: NoteVault?

    init(backend: Backend, context: ModelContext, defaults: UserDefaults = .standard, vault: NoteVault? = nil) {
        self.backend = backend
        self.context = context
        self.defaults = defaults
        self.lockVault = vault
        SyncSignal.onChange = { [weak self] in self?.localChanged() }
    }

    // MARK: Scheduling

    func schedule(after delay: TimeInterval = 0) {
        guard backend.client != nil, case .signedIn = backend.state, Wire.sealer != nil else { return }
        pending?.cancel()
        pending = Task { [weak self] in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    /// Something changed here: push it soon, at most every `pushInterval`, first one at once.
    func localChanged() {
        guard backend.client != nil, case .signedIn = backend.state, Wire.sealer != nil else { return }
        lastChange = .now
        pushWanted = true
        guard pushLoop == nil else { return }
        pushLoop = Task { [weak self] in
            while let self, self.pushWanted {
                let wait = Self.pushInterval - Date.now.timeIntervalSince(self.lastPush)
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                guard !Task.isCancelled else { break }
                self.pushWanted = false
                self.lastPush = .now
                await self.sync(pulling: false)
            }
            self?.pushLoop = nil
        }
    }

    /// A full run pushes then pulls; `pulling: false` only pushes (your own typing).
    /// Asked for while a run is going, it runs again straight after that one, and returns
    /// once that follow-up is done: when it returns, what you asked for has happened.
    func sync(pulling: Bool = true) async {
        // Nothing moves until the account's key is open here.
        guard let client = backend.client, case .signedIn = backend.state, Wire.sealer != nil else { return }
        if running {
            if pulling { again = true } else { pushAgain = true }
            await withCheckedContinuation { waiting.append($0) }
            return
        }
        running = true
        var pulling = pulling
        while true {
            await run(client, pulling: pulling)
            if again { again = false; pushAgain = false; pulling = true }
            else if pushAgain { pushAgain = false; pulling = false }
            else { break }
            // Signed out meanwhile: nothing more goes up.
            guard case .signedIn = backend.state else { again = false; pushAgain = false; break }
        }
        running = false
        let done = waiting
        waiting = []
        done.forEach { $0.resume() }
    }

    /// Callers of `sync` that arrived while a run was going, until their follow-up is done.
    private var waiting: [CheckedContinuation<Void, Never>] = []

    private func run(_ client: SupabaseClient, pulling: Bool) async {
        // The key can go (signed out, Start fresh) between runs.
        guard let sealer = Wire.sealer else { return }
        resetOldLibraryIfNeeded()
        if pulling { status = .syncing }
        do {
            let slowedDown = try await push(client, sealer: sealer)
            if pulling { try await pull(client); hasSynced = true }
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
    }

    /// Starts realtime and a first sync after sign-in.
    func start() async {
        guard let client = backend.client, case .signedIn = backend.state, Wire.sealer != nil else { return }
        adoptLibrary()
        resetOldLibraryIfNeeded()
        // Start fresh removes the account's files from Storage through here.
        AccountCrypto.shared.removeAccountFiles = { [weak self] user in
            guard let client = self?.backend.client else { return }
            do { try await Self.removeStoredFiles(client: client, user: user) } catch {
                log.error("removing files after start fresh failed: \(String(describing: error), privacy: .public)")
            }
        }
        started = true
        // Until realtime has joined, a short poll brings other devices' edits.
        updateFallback()
        await sync()
        guard channel == nil else { return }
        #if DEBUG || QA
        // `-netOffline` is offline for realtime too (its socket doesn't pass the fault layer).
        if NetFault.config.offline { return }
        #endif
        let ch = client.channel("pane-sync")
        let notes = ch.postgresChange(AnyAction.self, schema: "public", table: "notes")
        let folders = ch.postgresChange(AnyAction.self, schema: "public", table: "folders")
        let files = ch.postgresChange(AnyAction.self, schema: "public", table: "attachments")
        let joins = ch.statusChange
        try? await ch.subscribeWithError()
        channel = ch
        // Realtime takes a moment to start delivering after it joins; a pull covers that gap.
        schedule(after: 2)
        realtimeTasks.append(Task { [weak self] in
            for await action in notes { await self?.received(action) }
        })
        for stream in [folders, files] {
            realtimeTasks.append(Task { [weak self] in
                for await _ in stream { self?.schedule(after: 0.25) }
            })
        }
        // After sleep or a dropped connection the channel rejoins on its own; whatever
        // happened meanwhile comes in with a pull.
        realtimeTasks.append(Task { [weak self] in
            var joined = false
            for await s in joins {
                guard case .subscribed = s else { self?.realtimeChanged(up: false); continue }
                self?.realtimeChanged(up: true)
                if joined { self?.schedule(after: 0) }
                joined = true
            }
        })
        // A safety net for anything realtime missed.
        realtimeTasks.append(Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                self?.schedule(after: 0)
            }
        })
    }

    /// Another device (or an AI) changed a note: apply the row it carries, or fetch it.
    private func received(_ action: AnyAction) async {
        guard let client = backend.client, case .signedIn = backend.state else { return }
        let record: [String: AnyJSON]
        switch action {
        case .insert(let a): record = a.record
        case .update(let a): record = a.record
        case .delete: schedule(after: 0.25); return
        }
        var rows: [NoteDTO] = []
        if let row = try? record.decode(as: NoteDTO.self, decoder: AnyJSON.decoder) {
            rows = [row]
        } else if case .string(let id)? = record["id"], let uuid = UUID(uuidString: id) {
            // Rows too large for a realtime message arrive without their body.
            rows = (try? await client.from("notes").select().eq("id", value: uuid).execute().value) ?? []
        }
        guard !rows.isEmpty else { schedule(after: 0.25); return }
        take(rows)
    }

    /// Rows another device just wrote, as realtime delivers them: applied straight away.
    func take(_ rows: [NoteDTO]) {
        // Typing that isn't in the model yet goes in first, so it counts as a local edit.
        DebouncedSave.flushAll()
        var folders = Dictionary(uniqueKeysWithValues: context.allFoldersIncludingDeleted().map { ($0.id, $0) })
        var changed = false
        for r in rows {
            if let fid = r.folder_id, folders[fid] == nil {
                // A folder this device hasn't seen yet: the full pull brings both.
                schedule(after: 0)
                continue
            }
            if merge(r, folders: &folders) { changed = true }
        }
        if changed { try? context.save() }
    }

    /// This device's library was synced for one account. When a different account signs
    /// in, that library (and its unsynced edits) must never be pushed into the new one, so
    /// it's cleared and the new account's notes are pulled fresh.
    private func adoptLibrary() {
        guard let uid = backend.userID else { return }
        // Backend normally adopts before it reports sign-in (AccountLibrary); this catches the rest.
        if AccountLibrary.adopt(uid, context: context) { log.notice("a different account signed in: cleared this device's library") }
        if adoptedFor != uid {
            adoptedFor = uid
            refused = [:]
            problem = nil
        }
    }
    /// The account this engine's in-memory state (refusals, problems) belongs to.
    private var adoptedFor: UUID?

    // MARK: The one-time reset

    nonisolated static func resetKey(_ user: UUID) -> String { "e2ee.v1.localReset.\(user.uuidString.lowercased())" }

    /// The first run of an encrypted build for an account: what this device synced before was
    /// readable, and the server has since wiped it. It goes here too, with the cursor, so none of
    /// it is ever pushed into the sealed account. Notes written while signed out never synced;
    /// they stay and go up sealed.
    private func resetOldLibraryIfNeeded() {
        guard let uid = backend.userID, !defaults.bool(forKey: Self.resetKey(uid)) else { return }
        DebouncedSave.flushAll()
        let (removed, kept) = Self.resetOldLibrary(context)
        defaults.removeObject(forKey: cursorKey)
        synced = [:]
        refused = [:]
        defaults.set(true, forKey: Self.resetKey(uid))
        if removed > 0 { remoteChangeTick += 1 }
        log.notice("local reset for encryption: removed \(removed), kept \(kept) never synced")
    }

    /// Removes everything that was synced; keeps what never was (and the folders and files it
    /// needs), marked to go up as new. Returns how many rows went and how many notes stayed.
    static func resetOldLibrary(_ context: ModelContext) -> (removed: Int, kept: Int) {
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        let folders = context.allFoldersIncludingDeleted()
        let files = (try? context.fetch(FetchDescriptor<Attachment>())) ?? []
        let keptNotes = notes.filter { $0.serverVersion == 0 && $0.deletedAt == nil }
        let keptNoteIDs = Set(keptNotes.map(\.id))
        // New folders, the folders kept notes are in, and every parent of those.
        var keptFolders = Set<UUID>()
        func keep(_ folder: Folder?) {
            var f = folder, hops = 0
            while let x = f, hops < 64 { keptFolders.insert(x.id); f = x.parent; hops += 1 }
        }
        for f in folders where f.serverVersion == 0 && f.deletedAt == nil { keep(f) }
        for n in keptNotes { keep(n.folder) }
        var embedded = Set<UUID>()
        for n in keptNotes {
            for m in n.body.matches(of: /pane-file:([0-9a-fA-F-]{36})/) { if let id = UUID(uuidString: String(m.1)) { embedded.insert(id) } }
        }
        func erase<T: PersistentModel>(_ m: T) { context.delete(m) }
        var removed = 0
        for f in files {
            if f.deletedAt == nil, !f.uploaded || embedded.contains(f.id), FileStore.exists(f) {
                f.uploaded = false
                f.dirty = true
            } else {
                try? FileManager.default.removeItem(at: FileStore.url(for: f.id, filename: f.filename).deletingLastPathComponent())
                context.delete(f)
                removed += 1
            }
        }
        for n in notes where !keptNoteIDs.contains(n.id) { context.delete(n); removed += 1 }
        for n in keptNotes {
            // A sub-note whose parent went is a note of its own now.
            if let p = n.parentID, !keptNoteIDs.contains(p) { n.parentID = nil }
            n.dirty = true
        }
        for f in folders {
            if keptFolders.contains(f.id) {
                f.serverVersion = 0
                f.dirty = true
            } else if !f.isDeleted {
                // A kept folder keeps its parents, so whatever goes here holds nothing kept. Gone
                // for good: Library's delete(folder) would move it to Recently Deleted instead.
                erase(f)
                removed += 1
            }
        }
        do { try context.save() } catch { log.error("local reset: save failed: \(String(describing: error), privacy: .public)") }
        return (removed, keptNotes.count)
    }

    // MARK: Start fresh

    /// "Start fresh" ended the account's key: the files it sealed can't be opened by anyone, so
    /// everything under `<user id>/` in Storage goes (the database rows went with `start_fresh`).
    nonisolated static func removeStoredFiles(client: SupabaseClient, user: UUID) async throws {
        let folder = user.uuidString.lowercased()
        let bucket = client.storage.from("files")
        // A page at a time: what's removed drops out of the next listing.
        while true {
            let listed = try await bucket.list(path: folder, options: SearchOptions(limit: 1000))
            let paths = listed.filter { !$0.name.isEmpty }.map { "\(folder)/\($0.name)" }
            var gone = 0
            for i in stride(from: 0, to: paths.count, by: 100) {
                gone += try await bucket.remove(paths: Array(paths[i ..< min(i + 100, paths.count)])).count
            }
            if listed.count < 1000 || gone == 0 { return }
        }
    }

    /// Realtime joined or dropped. While it's down, edits from other devices come in by a
    /// poll every 8 s (30 s once nothing has changed for 5 minutes) instead of only the
    /// minute pull; joining again stops it.
    func realtimeChanged(up: Bool) {
        realtimeUp = up
        updateFallback()
    }

    /// The app came to the front or went away: the poll only runs while it's in front.
    func setActive(_ isActive: Bool) {
        active = isActive
        updateFallback()
    }

    private func updateFallback() {
        var signedIn: Bool { if case .signedIn = backend.state { true } else { false } }
        let wanted = started && active && !realtimeUp && backend.client != nil && signedIn
        if !wanted { fallback?.cancel(); fallback = nil; return }
        guard fallback == nil else { return }
        fallback = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let poll = Self.fallbackPoll
                let quiet = Date.now.timeIntervalSince(self.lastChange) > poll.slowAfter
                try? await Task.sleep(for: quiet ? poll.slow : poll.fast)
                guard !Task.isCancelled else { return }
                await self.sync()
            }
        }
    }

    func stop() async {
        // Signed out: nothing already scheduled may still go up.
        started = false
        realtimeUp = false
        fallback?.cancel()
        fallback = nil
        pending?.cancel()
        pushLoop?.cancel()
        pushLoop = nil
        pushWanted = false
        realtimeTasks.forEach { $0.cancel() }
        realtimeTasks = []
        if let channel { await channel.unsubscribe() }
        channel = nil
    }

    // MARK: Push

    /// Pushes dirty rows. Returns true when the server said "too fast" and the rest should
    /// wait; rows it refuses outright are set aside instead of failing the whole sync.
    private func push(_ client: SupabaseClient, sealer: Sealer) async throws -> Bool {
        problem = nil
        if try await pushFiles(client, sealer: sealer) { return true }
        let folders = ((try? context.fetch(FetchDescriptor<Folder>(predicate: #Predicate { $0.dirty }))) ?? [])
            .sorted { Self.depth($0) < Self.depth($1) } // parents first, for the foreign key
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
        var pushedNotes: [UUID] = []
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
                        saved = try await resolveConflict(client, local: n)
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
                remember(s)
                n.serverVersion = s.version ?? n.serverVersion
                // Stay dirty if you typed more while this was in flight.
                if n.updatedAt <= sentAt { n.dirty = false }
                pushedNotes.append(n.id)
            }
        }
        try? context.save()
        republishShares(for: pushedNotes)
        return false
    }

    // MARK: Shared pages

    /// Live links: note → whether its link includes sub-notes. A shared page shows a readable copy
    /// this device publishes (the server can't read the note), so an edit that went up is
    /// published to every page it's on.
    private(set) var liveShares: [UUID: Bool] = [:]
    private var publishQueue: Set<UUID> = []
    private var publishTask: Task<Void, Never>?
    /// How long after the last pushed change a page is written again. Tests shorten it.
    static var publishDelay: Duration = .seconds(2)

    private func refreshShares(_ client: SupabaseClient) async {
        struct Row: Decodable { var note_id: UUID; var include_subnotes: Bool }
        if let rows: [Row] = try? await client.from("note_shares").select("note_id,include_subnotes").is("revoked_at", value: nil).execute().value {
            liveShares = Dictionary(rows.map { ($0.note_id, $0.include_subnotes) }, uniquingKeysWith: { a, _ in a })
        }
    }

    /// Sharing changed on this device (Share Link, sub-notes, Stop Sharing).
    func shareChanged(_ note: UUID, includesSubNotes: Bool?) {
        liveShares[note] = includesSubNotes
    }

    /// The shared notes whose pages show this one: itself, and each ancestor whose link includes sub-notes.
    func sharedRoots(of id: UUID) -> [UUID] {
        var roots: [UUID] = liveShares[id] != nil ? [id] : []
        var seen: Set<UUID> = [id]
        var next = context.note(id)?.parentID
        while let p = next, seen.insert(p).inserted, seen.count < 64 {
            if liveShares[p] == true { roots.append(p) }
            next = context.note(p)?.parentID
        }
        return roots
    }

    /// Typing pushes every 0.35 s; the pages are written 2 s after the last push that touched them.
    private func republishShares(for ids: [UUID]) {
        guard !liveShares.isEmpty else { return }
        let roots = ids.flatMap { sharedRoots(of: $0) }
        guard !roots.isEmpty else { return }
        publishQueue.formUnion(roots)
        publishTask?.cancel()
        publishTask = Task { [weak self] in
            try? await Task.sleep(for: Self.publishDelay)
            guard !Task.isCancelled, let self, let client = self.backend.client, let user = self.backend.userID else { return }
            let roots = self.publishQueue
            self.publishQueue = []
            self.publishTask = nil
            for r in roots {
                await SharePublisher.republish(root: r, includeSubNotes: self.liveShares[r] ?? false, client: client, context: self.context, user: user)
            }
        }
    }

    private func isRefused(_ id: UUID, _ edited: Date) -> Bool { refused[id] == edited }

    /// A row this device can't open (sealed with another key, or damaged): left alone, and said
    /// so. Always false, so it reads as a filter.
    private func skipUnreadable(_ id: UUID, _ what: String) -> Bool {
        log.error("can't open \(id, privacy: .public): not sealed with this device's key")
        problem = "\(what) couldn't be opened on this device, so it was left as it is."
        return false
    }

    private func refuse(_ id: UUID, _ edited: Date, _ message: String) {
        log.error("server refused \(id, privacy: .public): \(message, privacy: .public)")
        refused[id] = edited
        problem = message
    }

    enum Refusal: Equatable, Sendable { case tooFast, refused(String) }

    /// Sorts a failed write: "too fast" (try again later), "refused" (this row as it stands
    /// can never go up: too big, over a limit, bad data), or nil (network and the like).
    nonisolated static func refusal(_ error: Error) -> Refusal? {
        if error is Wire.Unsealable { return .refused("it couldn't be encrypted") }
        if let e = error as? EncodingError, case .invalidValue(_, let c) = e, c.underlyingError is Wire.Unsealable {
            return .refused("it couldn't be encrypted")
        }
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

    /// Where a file's sealed bytes are in Storage: whose it is and which file, nothing else.
    nonisolated static func storagePath(user: UUID, id: UUID) -> String {
        "\(user.uuidString.lowercased())/\(id.uuidString.lowercased())"
    }

    /// Uploads new files sealed, then their sealed metadata. Returns true when the server said "too fast".
    private func pushFiles(_ client: SupabaseClient, sealer: Sealer) async throws -> Bool {
        guard let uid = backend.userID else { return false }
        let files = (try? context.fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.dirty || !$0.uploaded }))) ?? []
        for a in files where !isRefused(a.id, a.createdAt) {
            let path = Self.storagePath(user: uid, id: a.id)
            do {
                if !a.uploaded, a.deletedAt == nil {
                    guard FileStore.exists(a) else { continue }
                    let data = try Data(contentsOf: FileStore.url(for: a.id, filename: a.filename))
                    try await client.storage.from("files").upload(path, data: try sealer.sealFile(data, id: a.id),
                                                                  options: FileOptions(contentType: "application/octet-stream", upsert: true))
                    a.size = Int64(data.count)
                    a.uploaded = true
                }
                try await client.from("attachments").upsert(AttachmentDTO(a, path: path)).execute()
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

    /// A file's bytes from Storage, opened with the account's key.
    nonisolated static func fetchFile(client: SupabaseClient, user: UUID, id: UUID, sealer: Sealer) async throws -> Data {
        let data = try await client.storage.from("files").download(path: storagePath(user: user, id: id))
        return try sealer.openFile(data, id: id)
    }

    /// Fetches a file's bytes from Storage to this device.
    func download(_ a: Attachment) async -> Bool {
        guard let client = backend.client, let uid = backend.userID, let sealer = Wire.sealer else { return false }
        do {
            let data = try await Self.fetchFile(client: client, user: uid, id: a.id, sealer: sealer)
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
    private func resolveConflict(_ client: SupabaseClient, local n: Note) async throws -> [NoteDTO] {
        let server: [NoteDTO] = try await client.from("notes").select().eq("id", value: n.id).execute().value
        // Typing that isn't in the note yet goes in first, so nothing below works from stale text.
        DebouncedSave.flushAll()
        guard let s = server.first else {
            return try await client.from("notes").upsert(NoteDTO(n)).select().execute().value
        }
        // Theirs can't be opened here: nothing is merged with it or written over it.
        if s.unreadable { _ = skipUnreadable(s.id, "A note"); return [] }
        if s.body == n.body && s.locked_body == n.lockedBody { return server }
        // A locked note's text is sealed: there's nothing to merge line by line.
        let sealed = s.locked_body != nil || n.lockedBody != nil
        // Both typed since the version we last had: where the edits don't touch the same lines,
        // put them together (like Notes), instead of one side's edit going to version history.
        if !sealed, let base = synced[n.id], base.version == n.serverVersion, let sv = s.version,
           let merged = TextDiff.merge(base: base.body, mine: n.body, theirs: s.body) {
            let mine = n.body
            var patch = NoteDTO(n).patch
            patch.body = merged
            let saved: [NoteDTO] = try await client.from("notes").update(patch)
                .eq("id", value: n.id).eq("version", value: Int(sv)).select().execute().value
            // Moved on again meanwhile: the next push tries again.
            guard let row = saved.first else { return [] }
            DebouncedSave.flushAll()
            if n.body == mine {
                n.body = merged
            } else if let again = TextDiff.merge(base: mine, mine: n.body, theirs: merged) {
                // You typed while that was in flight: that goes up next.
                n.body = again
                n.touch()
            } else {
                return []
            }
            remember(row)
            return saved
        }
        if sealed { return try await resolveSealedConflict(client, local: n, server: s) }
        if s.updated_at > n.updatedAt {
            // Theirs is newer: keep it, and keep ours as a conflicted copy.
            let copy = Note(body: Self.conflictCopy(of: n.body), folder: n.folder)
            copy.createdAt = n.updatedAt
            copy.updatedAt = n.updatedAt
            context.insert(copy)
            apply(s, to: n)
            return server
        }
        // Ours is newer: it goes up, and theirs is kept here as a conflicted copy (the server
        // keeps it in note_revisions too), so neither edit is lost.
        let copy = Note(body: Self.conflictCopy(of: s.body), folder: n.folder)
        copy.createdAt = s.updated_at
        copy.updatedAt = s.updated_at
        context.insert(copy)
        return try await client.from("notes").update(NoteDTO(n).patch).eq("id", value: n.id).select().execute().value
    }

    /// A conflict where either side is locked. The loser is kept as a conflicted copy, and that
    /// copy is always sealed: a copy of a locked note is never readable, here or on the server.
    /// Locked on one side only, the lock wins whichever is newer, so an edit made elsewhere never
    /// quietly unlocks a note (or disappears with the history that locking deletes).
    ///
    /// Sealing needs the key. While notes are locked the note waits here, unpushed and as it was,
    /// and goes up once the notes password is entered (NoteVault signals a push).
    private func resolveSealedConflict(_ client: SupabaseClient, local n: Note, server s: NoteDTO) async throws -> [NoteDTO] {
        let vault = lockVault ?? NoteVault.shared
        let theirsWins = (s.locked_body == nil) != (n.lockedBody == nil) ? s.locked_body != nil : s.updated_at > n.updatedAt
        let loser: String? = theirsWins ? vault.text(of: n) : s.locked_body.map { vault.text(sealed: $0, note: s.id) } ?? s.body
        guard vault.isUnlocked, let loser else {
            problem = "“\(n.title)” was changed on another device while it was locked here. Enter your notes password to sync it."
            return []
        }
        let copy = try vault.sealedCopy(of: Self.conflictCopy(of: loser), in: n.folder, at: theirsWins ? n.updatedAt : s.updated_at)
        context.insert(copy)
        if theirsWins {
            apply(s, to: n)
            return [s]
        }
        return try await client.from("notes").update(NoteDTO(n).patch).eq("id", value: n.id).select().execute().value
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
        for r in folderRows where !r.unreadable || skipUnreadable(r.id, "A folder") {
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
        for r in fileRows where !r.unreadable || skipUnreadable(r.id, "A file") {
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
            // Typing that isn't in the model yet goes in first, so the note counts as edited
            // here and what arrives can't replace it (the saver would then drop it).
            if !rows.isEmpty { DebouncedSave.flushAll() }
            for r in rows {
                if let s = r.server_updated_at, s > newest { newest = s }
                if merge(r, folders: &byID) { changed = true }
            }
            if rows.count < 500 { break }
            offset += 500
        }
        if changed { try? context.save() }
        cursor = newest
        await refreshShares(client)
    }

    /// Takes one server row into the library. Returns true when anything changed.
    ///
    /// The rule: a note with local edits not yet pushed is left alone (the push compares
    /// versions and keeps both if they really diverged); an older version than the one we
    /// have is an out-of-order event; the same version with the same content is our own
    /// push coming back, and touching the note would only churn the editor and the list.
    @discardableResult
    private func merge(_ r: NoteDTO, folders byID: inout [UUID: Folder]) -> Bool {
        if r.unreadable { _ = skipUnreadable(r.id, "A note"); return false }
        let local = context.note(r.id)
        if let local, !Self.takes(r, over: local) { return false }
        let n = local ?? { let n = Note(body: r.body); n.id = r.id; context.insert(n); return n }()
        if n.body != r.body { remoteChangeTick += 1 }
        let before = (body: local?.body, version: local.map(\.serverVersion), aiAt: local?.aiEditedAt)
        apply(r, to: n)
        n.folder = r.folder_id.flatMap { byID[$0] }
        // An AI's edit: remember the text from before it, for the tint, the receipt and Undo.
        // On this account's first sync here, older AI edits are history, not news.
        AIEdit.arrived(n, previousBody: before.body, previousVersion: before.version, previousEditAt: before.aiAt, quiet: local == nil && cursor == .distantPast)
        return true
    }

    /// A row the server just wrote for this device (a restored version): it replaces the note
    /// here whatever its state, because it already includes everything this device pushed.
    func adopt(_ r: NoteDTO) {
        guard let n = context.note(r.id) else { return }
        if n.body != r.body { remoteChangeTick += 1 }
        apply(r, to: n)
        try? context.save()
        // The server wrote it, so no push follows: a shared page is published from here.
        republishShares(for: [r.id])
    }

    /// Whether a server row should replace what this device has (see `merge`).
    static func takes(_ r: NoteDTO, over local: Note) -> Bool {
        if local.dirty { return false }
        if let v = r.version, v < local.serverVersion { return false }
        if let v = r.version, v == local.serverVersion, same(r, local) { return false }
        return true
    }

    static func same(_ r: NoteDTO, _ n: Note) -> Bool {
        // The server keeps microseconds; a Date round-trips a hair off.
        func near(_ a: Date?, _ b: Date?) -> Bool {
            switch (a, b) {
            case (nil, nil): true
            case let (x?, y?): abs(x.timeIntervalSince(y)) < 0.001
            default: false
            }
        }
        return r.body == n.body && r.locked_body == n.lockedBody && r.parent_id == n.parentID && r.is_pinned == n.isPinned
            && near(r.trashed_at, n.trashedAt) && near(r.deleted_at, n.deletedAt) && r.folder_id == n.folder?.id
    }

    /// The text of each note at the server version this device last had: the common starting
    /// point when both sides typed at once. Kept for this run of the app only.
    private var synced: [UUID: (version: Int64, body: String)] = [:]

    private func remember(_ r: NoteDTO) {
        if let v = r.version { synced[r.id] = (v, r.body) }
    }

    private func apply(_ r: NoteDTO, to n: Note) {
        remember(r)
        n.body = r.body
        n.lockedBody = r.locked_body
        n.parentID = r.parent_id
        n.isPinned = r.is_pinned
        n.createdAt = r.created_at
        n.updatedAt = r.updated_at
        n.trashedAt = r.trashed_at
        n.deletedAt = r.deleted_at
        n.serverVersion = r.version ?? n.serverVersion
        // Older servers don't send these: keep what we had.
        if r.ai_edited_at != nil {
            n.aiEditor = r.ai_editor
            n.aiEditedAt = r.ai_edited_at
        }
        n.dirty = false
    }

    private static func depth(_ f: Folder) -> Int {
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

/// Sealing for the wire (see E2EE): text columns go up only sealed with the account's data key,
/// and rows that come down are opened here. A row that doesn't open is marked `unreadable` and
/// never applied. Without the key nothing can be encoded at all.
enum Wire {
    struct Unsealable: Error {}

    /// The account's sealer (`E2EE.sealer`), or a test's own. Task-local, so tests running side by
    /// side each have theirs; tasks sync starts inherit it.
    @TaskLocal static var testSealer: Sealer?
    static var sealer: Sealer? { testSealer ?? E2EE.sealer }

    static func seal(_ plain: String, _ context: String) throws -> String {
        guard let box = Wire.sealer?.seal(plain, context: context) else { throw Unsealable() }
        return box
    }

    static func seal(head: NoteHead, _ id: UUID) throws -> String {
        guard let box = Wire.sealer?.sealHead(head, note: id) else { throw Unsealable() }
        return box
    }

    /// A note's head: its title and preview, or a locked note's title alone (its `body` is the title).
    static func head(body: String, locked: Bool) -> NoteHead {
        locked ? NoteHead(title: body.isEmpty ? "New Note" : body, preview: nil) : .of(body)
    }
}

struct FolderDTO: Codable {
    var id: UUID
    var name: String
    var parent_id: UUID?
    var sort_index: Double
    var created_at: Date
    var updated_at: Date
    var deleted_at: Date?
    var server_updated_at: Date?
    /// Doesn't open with this device's key: never applied.
    var unreadable = false

    init(_ f: Folder) {
        id = f.id
        name = String(f.name.prefix(200))
        parent_id = f.parent?.id
        sort_index = f.sortIndex
        created_at = f.createdAt
        updated_at = f.updatedAt
        deleted_at = f.deletedAt
    }

    enum CodingKeys: String, CodingKey { case id, name_ct, parent_id, sort_index, created_at, updated_at, deleted_at, server_updated_at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        parent_id = try c.decodeIfPresent(UUID.self, forKey: .parent_id)
        sort_index = try c.decodeIfPresent(Double.self, forKey: .sort_index) ?? 0
        created_at = try c.decode(Date.self, forKey: .created_at)
        updated_at = try c.decode(Date.self, forKey: .updated_at)
        deleted_at = try c.decodeIfPresent(Date.self, forKey: .deleted_at)
        server_updated_at = try c.decodeIfPresent(Date.self, forKey: .server_updated_at)
        if let box = try c.decodeIfPresent(String.self, forKey: .name_ct), let n = Wire.sealer?.open(box, context: E2EE.folder(id)) {
            name = n
        } else {
            name = ""
            unreadable = true
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(Wire.seal(name, E2EE.folder(id)), forKey: .name_ct)
        try c.encode(parent_id, forKey: .parent_id)
        try c.encode(sort_index, forKey: .sort_index)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(updated_at, forKey: .updated_at)
        try c.encode(deleted_at, forKey: .deleted_at)
    }
}

struct NoteDTO: Codable {
    var id: UUID
    /// The note's text, opened. For a locked note, its title (from the sealed head).
    var body: String
    /// A locked note's text, sealed with the notes password's key; `body` is then its title.
    var locked_body: String?
    var folder_id: UUID?
    var parent_id: UUID?
    var is_pinned: Bool
    var created_at: Date
    var updated_at: Date
    var trashed_at: Date?
    var deleted_at: Date?
    var version: Int64?
    var server_updated_at: Date?
    /// The AI that last changed the note, and when. Set by the server only; never sent.
    var ai_editor: String?
    var ai_edited_at: Date?
    /// Doesn't open with this device's key (or is damaged): never applied.
    var unreadable = false

    init(_ n: Note) {
        id = n.id
        body = n.body
        locked_body = n.lockedBody
        folder_id = n.folder?.id
        parent_id = n.parentID
        is_pinned = n.isPinned
        created_at = n.createdAt
        updated_at = n.updatedAt
        trashed_at = n.trashedAt
        deleted_at = n.deletedAt
    }

    enum CodingKeys: String, CodingKey { case id, body_ct, head_ct, locked_body, folder_id, parent_id, is_pinned, created_at, updated_at, trashed_at, deleted_at, version, server_updated_at, ai_editor, ai_edited_at }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        locked_body = try c.decodeIfPresent(String.self, forKey: .locked_body)
        folder_id = try c.decodeIfPresent(UUID.self, forKey: .folder_id)
        parent_id = try c.decodeIfPresent(UUID.self, forKey: .parent_id)
        is_pinned = try c.decodeIfPresent(Bool.self, forKey: .is_pinned) ?? false
        created_at = try c.decode(Date.self, forKey: .created_at)
        updated_at = try c.decode(Date.self, forKey: .updated_at)
        trashed_at = try c.decodeIfPresent(Date.self, forKey: .trashed_at)
        deleted_at = try c.decodeIfPresent(Date.self, forKey: .deleted_at)
        version = try c.decodeIfPresent(Int64.self, forKey: .version)
        server_updated_at = try c.decodeIfPresent(Date.self, forKey: .server_updated_at)
        ai_editor = try c.decodeIfPresent(String.self, forKey: .ai_editor)
        ai_edited_at = try c.decodeIfPresent(Date.self, forKey: .ai_edited_at)
        // A row without its text (realtime leaves big values out) isn't a note to apply.
        guard c.contains(.head_ct), locked_body != nil || c.contains(.body_ct) else {
            throw DecodingError.keyNotFound(CodingKeys.body_ct, .init(codingPath: c.codingPath, debugDescription: "no text in this row"))
        }
        let head = try c.decodeIfPresent(String.self, forKey: .head_ct)
        if deleted_at != nil, head == nil {
            // Deleted for good: a tombstone keeps no text at all.
            body = ""
        } else if locked_body != nil {
            if let head, let h = Wire.sealer?.openHead(head, note: id) { body = h.title } else { body = ""; unreadable = true }
        } else if let box = try c.decodeIfPresent(String.self, forKey: .body_ct), let text = Wire.sealer?.open(box, context: E2EE.body(id)) {
            body = text
            // Opening the head too means an unchanged note seals to the same head next time.
            if let head { _ = Wire.sealer?.openHead(head, note: id) }
        } else {
            body = ""
            unreadable = true
        }
    }

    /// The text columns, sealed: the body (none for a locked note) and the head. A note deleted
    /// for good sends none: its tombstone keeps no text.
    static func encodeText(_ c: inout KeyedEncodingContainer<CodingKeys>, id: UUID, body: String, locked: String?, deleted: Bool) throws {
        if deleted {
            try c.encodeNil(forKey: .body_ct)
            try c.encodeNil(forKey: .head_ct)
            try c.encodeNil(forKey: .locked_body)
            return
        }
        // Postgres text can't hold NUL; a pasted one would otherwise refuse the whole note.
        let body = body.contains("\u{0}") ? body.replacingOccurrences(of: "\u{0}", with: "") : body
        if locked == nil { try c.encode(Wire.seal(body, E2EE.body(id)), forKey: .body_ct) } else { try c.encodeNil(forKey: .body_ct) }
        try c.encode(Wire.seal(head: Wire.head(body: body, locked: locked != nil), id), forKey: .head_ct)
        try c.encode(locked, forKey: .locked_body)
    }

    /// Client-owned columns only; the server sets version and its own clock.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try Self.encodeText(&c, id: id, body: body, locked: locked_body, deleted: deleted_at != nil)
        try c.encode(folder_id, forKey: .folder_id)
        try c.encode(parent_id, forKey: .parent_id)
        try c.encode(is_pinned, forKey: .is_pinned)
        try c.encode(created_at, forKey: .created_at)
        try c.encode(updated_at, forKey: .updated_at)
        try c.encode(trashed_at, forKey: .trashed_at)
        try c.encode(deleted_at, forKey: .deleted_at)
    }

    struct Patch: Encodable {
        var id: UUID
        var body: String
        var locked_body: String?
        var folder_id: UUID?
        var parent_id: UUID?
        var is_pinned: Bool
        var updated_at: Date
        var trashed_at: Date?
        var deleted_at: Date?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: NoteDTO.CodingKeys.self)
            try NoteDTO.encodeText(&c, id: id, body: body, locked: locked_body, deleted: deleted_at != nil)
            try c.encode(folder_id, forKey: .folder_id)
            try c.encode(parent_id, forKey: .parent_id)
            try c.encode(is_pinned, forKey: .is_pinned)
            try c.encode(updated_at, forKey: .updated_at)
            try c.encode(trashed_at, forKey: .trashed_at)
            try c.encode(deleted_at, forKey: .deleted_at)
        }
    }

    var patch: Patch { Patch(id: id, body: body, locked_body: locked_body, folder_id: folder_id, parent_id: parent_id, is_pinned: is_pinned, updated_at: updated_at, trashed_at: trashed_at, deleted_at: deleted_at) }
}

/// A file's name, type (a UTType identifier) and size, sealed together as its `meta_ct`.
struct FileMeta: Codable, Equatable {
    var name: String
    var type: String
    var size: Int64?
}

struct AttachmentDTO: Codable {
    var id: UUID
    var filename: String
    var content_type: String
    /// The file's own size; the row stores the sealed size.
    var size: Int64
    var storage_path: String
    var created_at: Date
    var updated_at: Date
    var deleted_at: Date?
    var server_updated_at: Date?
    /// Doesn't open with this device's key: never applied.
    var unreadable = false

    enum CodingKeys: String, CodingKey { case id, meta_ct, size, storage_path, created_at, updated_at, deleted_at, server_updated_at }

    /// Sealing adds the header, the nonce and the tag to the file's bytes.
    static let sealOverhead: Int64 = 5 + 16 + 12 + 16

    init(id: UUID, filename: String, content_type: String, size: Int64, storage_path: String, created_at: Date, updated_at: Date, deleted_at: Date?) {
        self.id = id; self.filename = filename; self.content_type = content_type; self.size = size
        self.storage_path = storage_path; self.created_at = created_at; self.updated_at = updated_at; self.deleted_at = deleted_at
    }

    init(_ a: Attachment, path: String) {
        self.init(id: a.id, filename: String(a.filename.prefix(255)), content_type: a.contentType, size: a.size,
                  storage_path: path, created_at: a.createdAt, updated_at: .now, deleted_at: a.deletedAt)
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        let stored = try c.decodeIfPresent(Int64.self, forKey: .size) ?? 0
        storage_path = try c.decode(String.self, forKey: .storage_path)
        created_at = try c.decode(Date.self, forKey: .created_at)
        updated_at = try c.decode(Date.self, forKey: .updated_at)
        deleted_at = try c.decodeIfPresent(Date.self, forKey: .deleted_at)
        server_updated_at = try c.decodeIfPresent(Date.self, forKey: .server_updated_at)
        if let box = try c.decodeIfPresent(String.self, forKey: .meta_ct), let json = Wire.sealer?.open(box, context: E2EE.fileMeta(id)),
           let m = try? JSONDecoder().decode(FileMeta.self, from: Data(json.utf8)) {
            filename = m.name
            content_type = m.type
            size = m.size ?? max(stored - Self.sealOverhead, 0)
        } else {
            filename = "file"
            content_type = "public.data"
            size = 0
            unreadable = true
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        let json = String(decoding: try JSONEncoder.sorted.encode(FileMeta(name: filename, type: content_type, size: size)), as: UTF8.self)
        try c.encode(Wire.seal(json, E2EE.fileMeta(id)), forKey: .meta_ct)
        try c.encode(size + Self.sealOverhead, forKey: .size)
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
