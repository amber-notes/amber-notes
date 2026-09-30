import Foundation
import Supabase

/// The account's encryption setup on the server (`account_keys`, one row, readable only by you):
/// the password salt and count, and the data key wrapped under the password and the recovery key.
struct SupabaseAccountKeys: AccountKeysRemote {
    let client: SupabaseClient

    /// A server from before encryption: the account stays as it was.
    struct Unsupported: Error {}

    private static let columns = "key_id,salt,iterations,password_wrap,recovery_wrap"

    func fetch() async throws -> AccountKeys? {
        do {
            let rows: [AccountKeys] = try await client.from("account_keys").select(Self.columns).execute().value
            return rows.first
        } catch let e as PostgrestError where e.code == "42P01" || e.code == "PGRST205" {
            throw Unsupported()
        }
    }

    func create(_ keys: AccountKeys) async throws {
        do {
            try await client.from("account_keys").insert(keys).execute()
        } catch let e as PostgrestError where e.code == "23505" {
            throw AccountCryptoError.alreadySetUp
        }
    }

    struct Change: Encodable { var salt: String; var iterations: Int; var password_wrap: String; var recovery_wrap: String? }

    func update(_ keys: AccountKeys) async throws {
        try await client.from("account_keys")
            .update(Change(salt: keys.salt, iterations: keys.iterations, password_wrap: keys.password_wrap, recovery_wrap: keys.recovery_wrap))
            .eq("key_id", value: keys.key_id).execute()
    }
}
