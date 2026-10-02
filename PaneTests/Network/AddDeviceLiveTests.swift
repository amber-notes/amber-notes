import Foundation
import Supabase
import Testing
@testable import Pane

/// Add a device through the real server functions, on the LOCAL Supabase stack only: two
/// sessions of one account hand the key over, list themselves, and one removes the other.
/// Skipped unless `scripts/add-device-e2e.sh` sets the stack's address and two test users.
@MainActor @Suite(.serialized) struct AddDeviceLiveTests {
    struct Env {
        let url: URL, key: String, email: String, other: String, password: String

        static var current: Env? {
            let e = ProcessInfo.processInfo.environment
            guard let api = e["PANE_LOCAL_API"], let url = URL(string: api), url.host == "127.0.0.1",
                  let key = e["PANE_LOCAL_ANON"], let email = e["PANE_LOCAL_EMAIL"], let other = e["PANE_LOCAL_OTHER_EMAIL"],
                  let password = e["PANE_LOCAL_PASSWORD"] else { return nil }
            return Env(url: url, key: key, email: email, other: other, password: password)
        }
    }

    final class MemoryStorage: AuthLocalStorage, @unchecked Sendable {
        private var values: [String: Data] = [:]
        private let lock = NSLock()
        func store(key: String, value: Data) throws { lock.withLock { values[key] = value } }
        func retrieve(key: String) throws -> Data? { lock.withLock { values[key] } }
        func remove(key: String) throws { lock.withLock { _ = values.removeValue(forKey: key) } }
    }

    /// A signed-in session of its own, as a second device has.
    func session(_ env: Env, email: String) async throws -> (SupabaseClient, UUID) {
        let client = SupabaseClient(supabaseURL: env.url, supabaseKey: env.key, options: SupabaseClientOptions(
            auth: .init(storage: MemoryStorage()),
            global: .init(headers: ["x-pane-device": Backend.device, "x-amber-client": Backend.clientTag])))
        let s = try await client.auth.signIn(email: email, password: env.password)
        return (client, s.user.id)
    }

    func device(_ client: SupabaseClient, user: UUID, syncs: Bool) async -> (AccountCrypto, KeyStartupTests.FakeKeychain) {
        let keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        keychain.syncs = syncs
        let crypto = AccountCrypto(store: keychain, defaults: UserDefaults(suiteName: "add-device-live-\(UUID())")!, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: SupabaseAccountKeys(client: client))
        return (crypto, keychain)
    }

    @Test func twoSessionsOfOneAccountHandTheKeyOverAndAnotherAccountCant() async throws {
        guard let env = Env.current else { return }
        let (clientA, user) = try await session(env, email: env.email)
        let (clientB, userB) = try await session(env, email: env.email)
        let (stranger, strangerID) = try await session(env, email: env.other)
        #expect(user == userB && strangerID != user)
        // The account's first device makes its key; the second has no way to it but the first.
        let (a, _) = await device(clientA, user: user, syncs: true)
        let (b, keychainB) = await device(clientB, user: user, syncs: false)
        #expect(a.phase == .ready && b.phase == .waiting)
        let phone = UUID(), mac = UUID()
        let s = NewDeviceSession(crypto: b, server: SupabaseAddDevice(client: clientB), device: mac, platform: "macos", name: "Sara\u{2019}s MacBook Air",
                                 poll: .milliseconds(200))
        let run = Task { await s.run() }
        var shown: (qr: String, code: String)?
        for _ in 0 ..< 200 where shown == nil {
            if case .showing(let qr, let code) = s.state { shown = (qr, code) } else { try await Task.sleep(for: .milliseconds(50)) }
        }
        let code = try #require(shown, "the request was filed: \(s.state)")
        // Another account's device reading the code finds nothing, by scan or by typing.
        let other = SupabaseAddDevice(client: stranger)
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.scanned(code.qr), user: strangerID, server: other) }
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.typed(code.code), user: user, server: other) }
        // The typed code and the scanned one find the same request; the scan answers it.
        let serverA = SupabaseAddDevice(client: clientA)
        let typed = try await AddDeviceApproval.find(.typed(code.code), user: user, server: serverA)
        let c = try await AddDeviceApproval.find(.scanned(code.qr), user: user, server: serverA)
        #expect(typed.id == c.id && c.name == "Sara\u{2019}s MacBook Air" && c.kind == "Mac")
        try await AddDeviceApproval.approve(c, key: try #require(a.keyToHandOver), user: user, device: phone, server: serverA)
        await run.value
        #expect(b.phase == .ready && b.keyID == a.keyID && keychainB.local[user] != nil && keychainB.synced[user] == nil)
        // Used once.
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.scanned(code.qr), user: user, server: serverA) }
        await #expect(throws: AddDeviceError.expired) { try await AddDeviceApproval.approve(c, key: a.keyToHandOver!, user: user, device: phone, server: serverA) }
        // Every device of the account is told.
        struct Notice: Decodable { var kind: String }
        let notices: [Notice] = try await clientA.from("account_notices").select("kind").eq("kind", value: "device_added").execute().value
        #expect(notices.count == 1)
        // Both list themselves; each sees the other, by a name the server only holds sealed.
        let onPhone = KeyDevices(device: phone, platform: "ios", name: "iPhone", identity: DeviceIdentity(store: MemoryDeviceIdentityStore()))
        let onMac = KeyDevices(device: mac, platform: "macos", name: "Sara\u{2019}s MacBook Air", identity: DeviceIdentity(store: MemoryDeviceIdentityStore()))
        onPhone.attach(account: user, server: SupabaseKeyDevices(client: clientA))
        onMac.attach(account: user, server: SupabaseKeyDevices(client: clientB))
        var removed = 0
        onMac.removedHere = { removed += 1; b.forgetLocalKey(); await onMac.removalDone(account: user) }
        await onMac.refresh(b)
        await onPhone.refresh(a)
        await onMac.refresh(b)
        #expect(onPhone.others.map(\.name) == ["Sara\u{2019}s MacBook Air"] && onPhone.others.first?.how == .added && onPhone.others.first?.canRemove == true)
        #expect(onMac.others.map(\.name) == ["iPhone"] && onMac.others.first?.backedUp == true)
        struct Raw: Decodable { var name_ct: String }
        let raw: [Raw] = try await clientA.from("key_devices").select("name_ct").execute().value
        #expect(raw.count == 2 && raw.allSatisfy { $0.name_ct.hasPrefix("amb2.") && !$0.name_ct.contains("MacBook") })
        let strangers: [Raw] = try await stranger.from("key_devices").select("name_ct").execute().value
        #expect(strangers.isEmpty)
        // The iPhone removes the Mac: the Mac drops its key the next time it looks, and leaves the list.
        try await onPhone.remove(try #require(onPhone.others.first), crypto: a)
        #expect(onPhone.others.first?.removing == true)
        await onMac.refresh(b)
        #expect(removed == 1 && keychainB.local[user] == nil && b.phase != .ready)
        await onPhone.refresh(a)
        #expect(onPhone.others.isEmpty)
        for c in [a, b] { c.signedOut() }
    }
}
