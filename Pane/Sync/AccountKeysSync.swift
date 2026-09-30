import Foundation
import Supabase

/// The account's key on the server (`account_keys`, one row, readable only by you): its id, its
/// verifier and the data key wrapped under the recovery key. Only the functions below write it:
/// `create_account_key` (insert-if-absent), `mark_recovery_key_saved` and `start_fresh`, which
/// also counts the account's reset generation (`account_key_resets`).
struct SupabaseAccountKeys: AccountKeyServer {
    let client: SupabaseClient

    private static let columns = "key_id,verifier,recovery_wrap,recovery_saved_at"

    struct NoRow: Error {}

    /// The key row and the reset generation, read together so a device never sees a missing key
    /// without knowing whether the account started fresh.
    func fetch() async throws -> ServerKeyState {
        struct Reset: Decodable { var generation: Int }
        async let keys: [ServerKey] = client.from("account_keys").select(Self.columns).limit(1).execute().value
        async let resets: [Reset] = client.from("account_key_resets").select("generation").limit(1).execute().value
        let (k, r) = try await (keys, resets)
        return ServerKeyState(key: k.first, generation: r.first?.generation ?? 0)
    }

    func create(_ key: ServerKey) async throws -> (key: ServerKey, created: Bool) {
        struct Params: Encodable { var p_key_id: String; var p_verifier: String; var p_recovery_wrap: String }
        struct Row: Decodable {
            var key_id: String
            var verifier: String
            var recovery_wrap: String
            var recovery_saved_at: Date?
            var created: Bool
        }
        let rows: [Row] = try await client.rpc("create_account_key", params: Params(p_key_id: key.key_id, p_verifier: key.verifier,
                                                                                     p_recovery_wrap: key.recovery_wrap)).execute().value
        guard let r = rows.first else { throw NoRow() }
        return (ServerKey(key_id: r.key_id, verifier: r.verifier, recovery_wrap: r.recovery_wrap, recovery_saved_at: r.recovery_saved_at), r.created)
    }

    func markRecoveryKeySaved() async throws -> Date? {
        try await client.rpc("mark_recovery_key_saved").execute().value
    }

    /// Refused with hint `reauth` unless the session's sign-in is from the last 10 minutes.
    func startFresh(keyID: String) async throws -> Bool {
        do {
            return try await client.rpc("start_fresh", params: ["p_key_id": keyID]).execute().value
        } catch let e as PostgrestError where e.hint == "reauth" {
            throw KeyError.reauth
        }
    }
}
