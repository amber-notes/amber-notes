import Foundation
import Security
import Supabase

/// Stores the auth session in the Keychain; falls back to a protected file in the
/// app's own container when the Keychain isn't available (unsigned dev builds) or refuses a write.
///
/// The Keychain can hold an item this build can read and can't change or delete (seen on the Mac
/// download after the update to 1.2: every delete answered -34018). Three rules keep such an item
/// from ever being used again:
/// - the file, when there is one, is the session: it's only written when the Keychain refused the
///   write, and removed when a Keychain write works, so it's never the older of the two;
/// - an item that couldn't be replaced or removed is marked dead (a small file beside the session
///   file) and isn't read until a Keychain write works again;
/// - signing out overwrites an item it can't delete with nothing.
/// Without them, Sign Out removed the file, left the item, and the next read signed in again.
final class SessionStorage: AuthLocalStorage, @unchecked Sendable {
    private let lock = NSLock()
    /// Nil: this build keeps everything in the file.
    private let keychain: SessionKeychain?
    private let directory: URL

    /// The app's own: the Keychain when this build can use it, and its own folder.
    convenience init() {
        self.init(keychain: Self.appKeychain, directory: Self.appDirectory)
    }

    /// Tests give their own Keychain and folder.
    init(keychain: SessionKeychain?, directory: URL) {
        self.keychain = keychain
        self.directory = directory
    }

    static let appDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appending(path: "Pane", directoryHint: .isDirectory)

    private static let appKeychain: SessionKeychain? = {
        #if DEBUG || QA
        // `-sessionFault stuck`: a stand-in Keychain whose items can't be changed (SessionFault).
        if let fault = SessionFault.active { return fault.keychain(in: appDirectory) }
        #endif
        return useKeychain ? SystemSessionKeychain(service: AppIdentity.keychainPrefix + ".auth") : nil
    }()

    /// Unsigned (ad-hoc) Mac builds get a new code identity on every build, so the
    /// Keychain would ask permission after each install. They use the private file instead.
    private static let useKeychain: Bool = {
        #if os(macOS)
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return false }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return false }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let dict = info as? [String: Any] else { return false }
        return (dict[kSecCodeInfoTeamIdentifier as String] as? String)?.isEmpty == false
        #else
        return true
        #endif
    }()

    func store(key: String, value: Data) throws {
        lock.lock(); defer { lock.unlock() }
        if let keychain {
            // A new item each time, so it always has today's protection; changed in place when the
            // old one can't be removed.
            _ = keychain.delete(key)
            var status = keychain.add(key, value)
            if status == errSecDuplicateItem { status = keychain.update(key, value) }
            if status == errSecSuccess {
                try? FileManager.default.removeItem(at: fileURL(for: key))
                try? FileManager.default.removeItem(at: deadMark(for: key))
                return
            }
            // It goes to the file below instead; why the Keychain refused is worth knowing.
            Telemetry.shared.record(.keychainFailed(item: Self.item(key), operation: .save, status: Int(status)))
            // Whatever the Keychain still holds is older than what goes to the file now.
            markDead(key)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        var file = fileURL(for: key)
        try value.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        // Like the Keychain item it stands in for, it stays on this device: never in a backup.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? file.setResourceValues(values)
        #else
        // Owner-only from the moment the file exists, then swapped into place.
        let target = fileURL(for: key)
        let temp = target.deletingLastPathComponent().appending(path: ".\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(atPath: temp.path, contents: value, attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        if FileManager.default.fileExists(atPath: target.path) {
            _ = try FileManager.default.replaceItemAt(target, withItemAt: temp)
        } else {
            try FileManager.default.moveItem(at: temp, to: target)
        }
        #endif
    }

    /// What a stored name holds, for reports: the session, or what the key and device stores keep
    /// here on builds without the data protection keychain (`KeychainAccountKeyStore.fallbackName`).
    static func item(_ key: String) -> KeychainItem {
        if key == "device-identity" { return .deviceIdentity }
        for slot in KeySlot.allCases where key.hasPrefix("data-key-\(slot.rawValue)-") { return KeychainItem(slot) }
        return .session
    }

    func retrieve(key: String) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        if let data = try? Data(contentsOf: fileURL(for: key)) { return data }
        guard let keychain, !FileManager.default.fileExists(atPath: deadMark(for: key).path) else { return nil }
        let found = keychain.read(key)
        // Nothing in it: an item Sign Out overwrote because it couldn't be deleted.
        guard found.status == errSecSuccess, let data = found.data, !data.isEmpty else { return nil }
        return data
    }

    func remove(key: String) throws {
        lock.lock(); defer { lock.unlock() }
        if let keychain {
            let status = keychain.delete(key)
            if status == errSecSuccess || status == errSecItemNotFound {
                try? FileManager.default.removeItem(at: deadMark(for: key))
            } else {
                // It can't be removed: emptied if that's allowed, and never read again either way.
                _ = keychain.update(key, Data())
                markDead(key)
            }
        }
        try? FileManager.default.removeItem(at: fileURL(for: key))
    }

    private func name(_ key: String) -> String { "session-\(key.replacingOccurrences(of: "/", with: "_"))" }
    private func fileURL(for key: String) -> URL { directory.appending(path: name(key) + ".bin") }
    /// "The Keychain item for this key is not to be read": there while the item couldn't be
    /// replaced or removed.
    private func deadMark(for key: String) -> URL { directory.appending(path: name(key) + ".dead") }

    private func markDead(_ key: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: deadMark(for: key).path, contents: Data(), attributes: [.posixPermissions: 0o600])
    }
}

/// The Keychain as the session store uses it: one item a key, by status code.
protocol SessionKeychain: Sendable {
    func read(_ key: String) -> (status: OSStatus, data: Data?)
    func add(_ key: String, _ value: Data) -> OSStatus
    func update(_ key: String, _ value: Data) -> OSStatus
    func delete(_ key: String) -> OSStatus
}

struct SystemSessionKeychain: SessionKeychain {
    let service: String

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    func read(_ key: String) -> (status: OSStatus, data: Data?) {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        return (status, out as? Data)
    }

    func add(_ key: String, _ value: Data) -> OSStatus {
        var add = query(key)
        add[kSecValueData as String] = value
        // This device only: a session never travels in a backup to another device.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil)
    }

    func update(_ key: String, _ value: Data) -> OSStatus {
        SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: value] as CFDictionary)
    }

    func delete(_ key: String) -> OSStatus {
        SecItemDelete(query(key) as CFDictionary)
    }
}
