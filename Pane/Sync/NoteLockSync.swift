import Foundation
import Supabase

/// The account's notes password setup on the server (`note_locks`, one row, readable only by
/// you). It holds the salt, iteration count, key id, a sealed check text and the hint; never the
/// password or the key.
struct SupabaseLockRemote: NoteLockRemote {
    let client: SupabaseClient

    private static let columns = "salt,iterations,key_id,verifier,hint,previous"

    func fetch() async throws -> LockSettings? {
        let rows: [LockSettings] = try await client.from("note_locks").select(Self.columns).execute().value
        return rows.first
    }

    func create(_ settings: LockSettings) async throws {
        do {
            try await client.from("note_locks").insert(settings).execute()
        } catch let e as PostgrestError where e.code == "23505" {
            throw NoteLockError.alreadySetUp
        }
    }

    func replace(_ settings: LockSettings, expecting keyID: String) async throws {
        let rows: [LockSettings] = try await client.from("note_locks").update(settings)
            .eq("key_id", value: keyID).select(Self.columns).execute().value
        if rows.isEmpty { throw NoteLockError.changedElsewhere }
    }
}
