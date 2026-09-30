import Foundation
import Supabase

/// The account's notes password setup on the server (`note_locks`, one row, readable only by
/// you). It holds the salt, iteration count, key id, a sealed check text, the hint and earlier
/// setups with their proofs; never a password or a key in the clear. It's written once, then
/// changed only through `change_notes_password`.
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

    struct Change: Encodable {
        var p_settings: LockSettings
        var p_expected_key_id: String
        var p_notes: [ResealedNote]
    }

    struct Changed: Decodable {
        struct Row: Decodable { var id: UUID; var version: Int64 }
        var notes: [Row]
    }

    func changePassword(_ settings: LockSettings, expecting keyID: String, notes: [ResealedNote]) async throws -> [UUID: Int64] {
        do {
            let changed: Changed = try await client.rpc("change_notes_password", params: Change(p_settings: settings, p_expected_key_id: keyID, p_notes: notes))
                .execute().value
            return Dictionary(changed.notes.map { ($0.id, $0.version) }, uniquingKeysWith: { _, b in b })
        } catch let e as PostgrestError where e.code == "PT409" {
            throw NoteLockError.changedElsewhere
        } catch let e as PostgrestError where e.code == "40001" {
            throw NoteLockError.notesChanged
        }
    }
}
