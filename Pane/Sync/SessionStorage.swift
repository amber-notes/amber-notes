import Foundation
import Security
import Supabase

/// Stores the auth session in the Keychain; falls back to a protected file in the
/// app's own container when the Keychain isn't available (unsigned dev builds).
final class SessionStorage: AuthLocalStorage, @unchecked Sendable {
    private let service = AppIdentity.keychainPrefix + ".auth"
    private let lock = NSLock()

    /// Unsigned (ad-hoc) Mac builds get a new code identity on every build, so the
    /// Keychain would ask permission after each install. They use the private file instead.
    private let useKeychain: Bool = {
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

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "session.bin")
    }

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    func store(key: String, value: Data) throws {
        lock.lock(); defer { lock.unlock() }
        if useKeychain {
            SecItemDelete(query(key) as CFDictionary)
            var add = query(key)
            add[kSecValueData as String] = value
            // This device only: a session never travels in a backup to another device.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecSuccess {
                try? FileManager.default.removeItem(at: fileURL(for: key))
                return
            }
            // It goes to the file below instead; why the Keychain refused is worth knowing.
            Telemetry.shared.record(.keychainFailed(item: Self.item(key), operation: .save, status: Int(status)))
        }
        #if os(iOS)
        try value.write(to: fileURL(for: key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
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
        if useKeychain {
            var q = query(key)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data { return data }
        }
        return try? Data(contentsOf: fileURL(for: key))
    }

    func remove(key: String) throws {
        lock.lock(); defer { lock.unlock() }
        if useKeychain { SecItemDelete(query(key) as CFDictionary) }
        try? FileManager.default.removeItem(at: fileURL(for: key))
    }

    private func fileURL(for key: String) -> URL {
        fileURL.deletingLastPathComponent().appending(path: "session-\(key.replacingOccurrences(of: "/", with: "_")).bin")
    }
}
