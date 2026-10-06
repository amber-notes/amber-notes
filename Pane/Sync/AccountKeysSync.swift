import Foundation
import Supabase

/// The account's key on the server (`account_keys`, one row, readable only by you): its id, its
/// verifier and the data key wrapped under the recovery key. Only the functions below write it:
/// `create_account_key` (insert-if-absent, for the reset generation the device read),
/// `mark_recovery_key_saved` and `start_fresh`, which also counts the account's reset generation
/// (`account_key_resets`). Both are read together with `account_key_state`.
struct SupabaseAccountKeys: AccountKeyServer {
    let client: SupabaseClient

    struct NoRow: Error {}

    /// The key row and the reset generation, in one read (`account_key_state`), so a device never
    /// pairs a missing key with a generation from another moment.
    func fetch() async throws -> ServerKeyState {
        struct State: Decodable { var key: ServerKey?; var generation: Int }
        let state: State = try await client.rpc("account_key_state").execute().value
        return ServerKeyState(key: state.key, generation: state.generation)
    }

    /// Refused with hint `stale_generation` when the account started fresh after `generation`.
    func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) {
        struct Params: Encodable { var p_key_id: String; var p_verifier: String; var p_recovery_wrap: String; var p_generation: Int }
        struct Row: Decodable {
            var key_id: String
            var verifier: String
            var recovery_wrap: String
            var recovery_saved_at: Date?
            var created: Bool
        }
        let rows: [Row]
        do {
            rows = try await client.rpc("create_account_key", params: Params(p_key_id: key.key_id, p_verifier: key.verifier,
                                                                            p_recovery_wrap: key.recovery_wrap, p_generation: generation)).execute().value
        } catch let e as PostgrestError where e.hint == "stale_generation" {
            throw KeyError.staleGeneration
        }
        guard let r = rows.first else { throw NoRow() }
        return (ServerKey(key_id: r.key_id, verifier: r.verifier, recovery_wrap: r.recovery_wrap, recovery_saved_at: r.recovery_saved_at), r.created)
    }

    func markRecoveryKeySaved() async throws -> Date? {
        try await client.rpc("mark_recovery_key_saved").execute().value
    }

    /// Refused with hint `reauth` unless the session's sign-in is from the last 10 minutes, and
    /// with `paused_after_reset` (detail: when it opens again) for 72 hours after a password reset.
    func startFresh(keyID: String) async throws -> Bool {
        do {
            return try await client.rpc("start_fresh", params: ["p_key_id": keyID]).execute().value
        } catch let e as PostgrestError where e.hint == "reauth" {
            throw KeyError.reauth
        } catch let e as PostgrestError where e.hint == "paused_after_reset" {
            throw KeyError.pausedAfterReset(until: Self.pausedUntil(e.detail))
        }
    }

    /// The server's "until", in UTC (`2026-10-05T14:30:00Z`).
    nonisolated static func pausedUntil(_ detail: String?) -> Date? {
        detail.flatMap(Backend.pauseDate)
    }
}
