import Foundation
import Supabase
import Testing
@testable import Pane

/// The signed-in account is kept in memory: views read it in their bodies (AppGate on every
/// update), and asking the client reads the session from the Keychain and runs its migrations.
@MainActor @Suite struct BackendSessionTests {
    /// Counts the session reads made on one thread while it's watched. The client also loads its
    /// session on its own, at a time of its choosing (that made this test flaky); a read caused by
    /// reading `userID` happens on the reading thread, inside the watched span.
    final class CountingStorage: AuthLocalStorage, @unchecked Sendable {
        private let lock = NSLock()
        private var reads = 0
        private var watched: Thread?
        var count: Int { lock.withLock { reads } }
        func watch(_ thread: Thread?) { lock.withLock { watched = thread } }
        func store(key: String, value: Data) throws {}
        func retrieve(key: String) throws -> Data? {
            lock.withLock { if let watched, watched === Thread.current { reads += 1 } }
            return nil
        }
        func remove(key: String) throws {}
    }

    @Test func readingTheAccountNeverReadsTheSession() {
        let storage = CountingStorage()
        let client = SupabaseClient(supabaseURL: URL(string: "https://example.invalid")!, supabaseKey: "key",
                                    options: SupabaseClientOptions(auth: .init(storage: storage, autoRefreshToken: false)))
        let backend = Backend(testClient: client, email: "qa@example.com")
        // Synchronously on this thread: nothing else can run on it meanwhile.
        storage.watch(.current)
        for _ in 0..<50 { _ = backend.userID }
        storage.watch(nil)
        #expect(storage.count == 0, "each read of the account went to the session store")
    }
}
