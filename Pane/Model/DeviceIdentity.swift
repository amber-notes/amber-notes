import Foundation
import Security

// Which device this is, for the list of devices that hold the key and for Add a device: a random
// id and, per account, the epoch its removals are made for. Both live in a Keychain item that
// stays on this device (ThisDeviceOnly, never synced, never restored onto another phone), so an
// iPhone set up by transfer from an old one is a device of its own: it doesn't inherit the old
// phone's row in the list, and a removal meant for one never lands on the other.

/// What reading the stored identity found. "Not there" and "can't be read right now" are
/// different things: only the first may be answered by making a new identity.
enum DeviceIdentityLoad: Equatable, Sendable {
    case found(Data)
    /// There is no identity yet (a new install, or a phone set up by transfer).
    case none
    /// The store can't be read right now (the Keychain before the first unlock, or any other
    /// error). The identity may well exist: nothing is made, and the caller tries again later.
    case unavailable
}

protocol DeviceIdentityStore: Sendable {
    func load() -> DeviceIdentityLoad
    /// False when it wasn't written: then there is no identity to act under.
    func save(_ data: Data) -> Bool
}

/// Tests and captures.
final class MemoryDeviceIdentityStore: DeviceIdentityStore, @unchecked Sendable {
    private var data: Data?
    private let lock = NSLock()
    /// Tests: the Keychain can't be read (before first unlock), or a save doesn't stick.
    var unreadable = false
    var failsToSave = false
    private(set) var saves = 0
    func load() -> DeviceIdentityLoad { lock.withLock { unreadable ? .unavailable : data.map { .found($0) } ?? .none } }
    func save(_ data: Data) -> Bool {
        lock.withLock {
            guard !failsToSave else { return false }
            self.data = data
            saves += 1
            return true
        }
    }
}

/// A device-only Keychain item. Builds without the data protection keychain (ad-hoc and Developer
/// ID Macs) keep it in the app's own protected file, where they keep the session.
struct KeychainDeviceIdentityStore: DeviceIdentityStore {
    static let service = AppIdentity.keychainPrefix + ".device-identity"
    private static let fallback = SessionStorage()

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: "identity",
         kSecUseDataProtectionKeychain as String: true, kSecAttrSynchronizable as String: false]
    }

    func load() -> DeviceIdentityLoad {
        guard KeychainAccountKeyStore.dataProtectionAvailable else {
            return ((try? Self.fallback.retrieve(key: "device-identity")) ?? nil).map { .found($0) } ?? .none
        }
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        return Self.result(SecItemCopyMatching(q as CFDictionary, &out), out as? Data)
    }

    /// Only "no such item" means there is none. Anything else (not yet unlocked since boot, a
    /// Keychain error) means it can't be told right now.
    static func result(_ status: OSStatus, _ data: Data?) -> DeviceIdentityLoad {
        switch status {
        case errSecSuccess: data.map { .found($0) } ?? .unavailable
        case errSecItemNotFound: .none
        default: .unavailable
        }
    }

    func save(_ data: Data) -> Bool {
        guard KeychainAccountKeyStore.dataProtectionAvailable else { return (try? Self.fallback.store(key: "device-identity", value: data)) != nil }
        var update = query
        update[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        update[kSecAttrLabel as String] = "Pinto Notes device"
        update[kSecValueData as String] = data
        // Change the item in place when it's there, so a failed write never leaves none.
        let changed = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if changed == errSecSuccess { return true }
        guard changed == errSecItemNotFound else { return false }
        return SecItemAdd(update as CFDictionary, nil) == errSecSuccess
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
    /// Nil while the identity isn't known: the store couldn't be read, or a new one couldn't be saved.
    private var stored: Stored?

    init(store: DeviceIdentityStore) {
        self.store = store
        resolve()
    }

    /// Reads the identity, or makes one when there is none. A new one is made only when the store
    /// says there is none, never when it merely couldn't be read: a device that minted a second
    /// identity would list itself twice, and count its own old row as another device that holds
    /// the key. True when the identity is known.
    @discardableResult
    func resolve() -> Bool {
        if stored != nil { return true }
        switch store.load() {
        case .found(let data):
            if let s = try? JSONDecoder().decode(Stored.self, from: data) {
                stored = s
            } else {
                // Something else's bytes: it will never read as an identity, so it's replaced.
                mint()
            }
        case .none: mint()
        case .unavailable: break
        }
        return stored != nil
    }

    private func mint() {
        let fresh = Stored(id: UUID())
        // An identity that wasn't written is not one: the next launch would make another.
        if let data = try? JSONEncoder().encode(fresh), store.save(data) { stored = fresh }
    }

    private func save(_ s: Stored) -> Bool {
        guard let data = try? JSONEncoder().encode(s), store.save(data) else { return false }
        stored = s
        return true
    }

    /// This device, in `key_devices` and `device_adds`. Nil while it isn't known (try again later).
    var id: UUID? {
        resolve()
        return stored?.id
    }

    /// This device's epoch for the account: 16 random bytes made the first time it lists itself,
    /// and again after it obeyed a removal. Kept here, so it's this device that says which
    /// removals count. Nil while the identity isn't known or a new epoch couldn't be saved.
    func epoch(_ account: UUID) -> String? {
        guard resolve(), var s = stored else { return nil }
        let key = account.uuidString.lowercased()
        if let e = s.epochs[key], e.count == 32 { return e }
        let e = E2EE.randomHex(bytes: 16)
        s.epochs[key] = e
        return save(s) ? e : nil
    }

    /// After a removal was obeyed: whatever lists this device next does it under a new epoch.
    func rotateEpoch(_ account: UUID) {
        guard resolve(), var s = stored else { return }
        s.epochs[account.uuidString.lowercased()] = nil
        // Not written: the old epoch is at least gone for as long as the app runs.
        if !save(s) { stored = s }
    }
}
