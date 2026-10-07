import Foundation
import Supabase
import Testing
@testable import Pane

/// The signed-in account is kept in memory: views read it in their bodies (AppGate on every
/// update), and asking the client reads the session from the Keychain and runs its migrations.
@MainActor @Suite struct BackendSessionTests {
    final class CountingStorage: AuthLocalStorage, @unchecked Sendable {
        private let lock = NSLock()
        private var reads = 0
        var count: Int { lock.withLock { reads } }
        func store(key: String, value: Data) throws {}
        func retrieve(key: String) throws -> Data? { lock.withLock { reads += 1 }; return nil }
        func remove(key: String) throws {}
    }

    @Test func readingTheAccountNeverReadsTheSession() {
        let storage = CountingStorage()
        let client = SupabaseClient(supabaseURL: URL(string: "https://example.invalid")!, supabaseKey: "key",
                                    options: SupabaseClientOptions(auth: .init(storage: storage, autoRefreshToken: false)))
        let backend = Backend(testClient: client, email: "qa@example.com")
        let before = storage.count
        for _ in 0..<50 { _ = backend.userID }
        #expect(storage.count == before, "each read of the account went to the session store")
    }
}
