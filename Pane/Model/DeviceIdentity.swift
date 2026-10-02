import Foundation
import Security

// Which device this is, for the list of devices that hold the key and for Add a device: a random
// id and, per account, the epoch its removals are made for. Both live in a Keychain item that
// stays on this device (ThisDeviceOnly, never synced, never restored onto another phone), so an
// iPhone set up by transfer from an old one is a device of its own: it doesn't inherit the old
// phone's row in the list, and a removal meant for one never lands on the other.

protocol DeviceIdentityStore: Sendable {
    func load() -> Data?
    func save(_ data: Data)
}

/// Tests and captures.
final class MemoryDeviceIdentityStore: DeviceIdentityStore, @unchecked Sendable {
    private var data: Data?
    private let lock = NSLock()
    func load() -> Data? { lock.withLock { data } }
    func save(_ data: Data) { lock.withLock { self.data = data } }
}

/// A device-only Keychain item. Builds without the data protection keychain (ad-hoc and Developer
/// ID Macs) keep it in the app's own protected file, where they keep the session.
struct KeychainDeviceIdentityStore: DeviceIdentityStore {
    static let service = "dev.emilwagman.pane.device-identity"
    private static let fallback = SessionStorage()

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: "identity",
         kSecUseDataProtectionKeychain as String: true, kSecAttrSynchronizable as String: false]
    }

    func load() -> Data? {
        guard KeychainAccountKeyStore.dataProtectionAvailable else { return try? Self.fallback.retrieve(key: "device-identity") }
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    func save(_ data: Data) {
        guard KeychainAccountKeyStore.dataProtectionAvailable else { try? Self.fallback.store(key: "device-identity", value: data); return }
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        q[kSecAttrLabel as String] = "Amber Notes device"
        q[kSecValueData as String] = data
        SecItemAdd(q as CFDictionary, nil)
    }
}

@MainActor
final class DeviceIdentity {
    static var shared = DeviceIdentity(store: MemoryDeviceIdentityStore())

    private struct Stored: Codable {
        var id: UUID
        var epochs: [String: String] = [:]
    }

    private let store: DeviceIdentityStore
    private var stored: Stored

    init(store: DeviceIdentityStore) {
        self.store = store
        if let data = store.load(), let s = try? JSONDecoder().decode(Stored.self, from: data) {
            stored = s
        } else {
            stored = Stored(id: UUID())
            save()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(stored) { store.save(data) }
    }

    /// This device, in `key_devices` and `device_adds`.
    var id: UUID { stored.id }

    /// This device's epoch for the account: 16 random bytes made the first time it lists itself,
    /// and again after it obeyed a removal. Kept here, so it's this device that says which
    /// removals count.
    func epoch(_ account: UUID) -> String {
        let key = account.uuidString.lowercased()
        if let e = stored.epochs[key], e.count == 32 { return e }
        let e = E2EE.randomHex(bytes: 16)
        stored.epochs[key] = e
        save()
        return e
    }

    /// After a removal was obeyed: whatever lists this device next does it under a new epoch.
    func rotateEpoch(_ account: UUID) {
        stored.epochs[account.uuidString.lowercased()] = nil
        save()
    }
}
