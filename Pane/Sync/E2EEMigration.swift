import Foundation
import Observation
import Supabase
import SwiftData
import os

private let log = Logger(subsystem: "dev.emilwagman.pane", category: "e2ee")

/// Moving an account's notes to end-to-end encryption, on the first device with the data key.
///
/// Everything this device has is marked for sync and goes up sealed (a sealed write replaces the
/// readable text on the server and keeps no readable version). Files are sealed and uploaded again,
/// then their readable copies are deleted. Versions from before are sealed again by
/// `reseal_revisions`, and `finish_e2ee_migration` deletes any readable version left and says when
/// nothing readable is. Runs again on each launch until then; it can stop at any point.
@MainActor
@Observable
final class E2EEMigration {
    static let shared = E2EEMigration()

    /// What the banner says while it runs.
    private(set) var progress: String?

    static func doneKey(_ user: UUID) -> String { "e2ee.migrated.\(user.uuidString.lowercased())" }
    static func markedKey(_ user: UUID) -> String { "e2ee.marked.\(user.uuidString.lowercased())" }
    static func reconnectKey(_ user: UUID) -> String { "e2ee.reconnect.\(user.uuidString.lowercased())" }
    nonisolated static let oldFilesKey = "e2ee.oldFiles"

    static func isDone(_ user: UUID, defaults: UserDefaults = .standard) -> Bool { defaults.bool(forKey: doneKey(user)) }

    /// A readable file's old path, deleted once its sealed copy is up.
    nonisolated static func forget(_ path: String, defaults: UserDefaults) {
        var paths = defaults.stringArray(forKey: oldFilesKey) ?? []
        if !paths.contains(path) { paths.append(path) }
        defaults.set(paths, forKey: oldFilesKey)
    }

    /// Marks everything here for sync, once: notes (tombstones too), folders, and files whose bytes
    /// in Storage are still readable. Returns the files that need downloading first.
    static func mark(_ context: ModelContext, user: UUID, defaults: UserDefaults) -> [Attachment] {
        var missing: [Attachment] = []
        let files = (try? context.fetch(FetchDescriptor<Attachment>())) ?? []
        for a in files where !a.sealed && a.deletedAt == nil {
            if FileStore.exists(a) { a.uploaded = false } else { missing.append(a) }
            a.dirty = true
        }
        guard !defaults.bool(forKey: markedKey(user)) else { try? context.save(); return missing }
        for n in (try? context.fetch(FetchDescriptor<Note>())) ?? [] where n.serverVersion > 0 { n.dirty = true }
        for f in context.allFoldersIncludingDeleted() where f.serverVersion > 0 { f.dirty = true }
        try? context.save()
        defaults.set(true, forKey: markedKey(user))
        return missing
    }

    func run(sync: SyncEngine, client: SupabaseClient, context: ModelContext, user: UUID, defaults: UserDefaults = .standard) async {
        guard !Self.isDone(user, defaults: defaults), E2EE.sealer != nil else { return }
        progress = "Encrypting your notes…"
        defer { progress = nil }
        let missing = Self.mark(context, user: user, defaults: defaults)
        for (i, a) in missing.enumerated() {
            progress = "Encrypting your files (\(i + 1) of \(missing.count))…"
            if await sync.download(a) { a.uploaded = false }
        }
        try? context.save()
        progress = "Encrypting your notes…"
        await sync.sync()
        await deleteOldFiles(client, defaults: defaults)
        progress = "Encrypting your version history…"
        await resealVersions(client)
        do {
            struct Left: Decodable { var done: Bool; var notes: Int; var folders: Int; var files: Int }
            let left: Left = try await client.rpc("finish_e2ee_migration").execute().value
            if left.done {
                defaults.set(true, forKey: Self.doneKey(user))
                defaults.set(true, forKey: Self.reconnectKey(user))
                log.notice("account encrypted")
            } else {
                log.notice("still readable: \(left.notes) notes, \(left.folders) folders, \(left.files) files; next launch goes on")
            }
        } catch {
            log.error("finish failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func deleteOldFiles(_ client: SupabaseClient, defaults: UserDefaults) async {
        let paths = defaults.stringArray(forKey: Self.oldFilesKey) ?? []
        guard !paths.isEmpty else { return }
        for i in stride(from: 0, to: paths.count, by: 100) {
            guard (try? await client.storage.from("files").remove(paths: Array(paths[i ..< min(i + 100, paths.count)]))) != nil else { return }
        }
        defaults.removeObject(forKey: Self.oldFilesKey)
    }

    /// Versions kept from before, sealed again on this device, 200 at a time.
    private func resealVersions(_ client: SupabaseClient) async {
        struct Row: Decodable { var id: Int64; var note_id: UUID; var body: String }
        struct Sealed: Encodable { var id: Int64; var body_ct: String; var head_ct: String }
        guard let sealer = E2EE.sealer else { return }
        for _ in 0 ..< 500 {
            guard let rows: [Row] = try? await client.from("note_revisions").select("id,note_id,body")
                .filter("body", operator: "not.is", value: "null").is("locked_body", value: nil)
                .order("id").limit(200).execute().value, !rows.isEmpty else { return }
            let sealed = rows.compactMap { r -> Sealed? in
                guard let body = try? NoteCrypto.seal(r.body, key: sealer.key, keyID: sealer.keyID, context: E2EE.body(r.note_id)),
                      let json = try? String(decoding: JSONEncoder.sorted.encode(NoteHead.of(r.body)), as: UTF8.self),
                      let head = try? NoteCrypto.seal(json, key: sealer.key, keyID: sealer.keyID, context: E2EE.head(r.note_id)) else { return nil }
                return Sealed(id: r.id, body_ct: body, head_ct: head)
            }
            guard let n: Int = try? await client.rpc("reseal_revisions", params: ["p_rows": sealed]).execute().value, n > 0 else { return }
        }
    }
}
