import Foundation
import Security
import Supabase

/// Stores the auth session in the Keychain; falls back to a protected file in the
/// app's own container when the Keychain isn't available (unsigned dev builds).
final class SessionStorage: AuthLocalStorage, @unchecked Sendable {
    private let service = "dev.emilwagman.pane.auth"
    private let lock = NSLock()

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
        SecItemDelete(query(key) as CFDictionary)
        var add = query(key)
        add[kSecValueData as String] = value
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        if SecItemAdd(add as CFDictionary, nil) == errSecSuccess {
            try? FileManager.default.removeItem(at: fileURL(for: key))
            return
        }
        #if os(iOS)
        try value.write(to: fileURL(for: key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try value.write(to: fileURL(for: key), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL(for: key).path)
        #endif
    }

    func retrieve(key: String) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data { return data }
        return try? Data(contentsOf: fileURL(for: key))
    }

    func remove(key: String) throws {
        lock.lock(); defer { lock.unlock() }
        SecItemDelete(query(key) as CFDictionary)
        try? FileManager.default.removeItem(at: fileURL(for: key))
    }

    private func fileURL(for key: String) -> URL {
        fileURL.deletingLastPathComponent().appending(path: "session-\(key.replacingOccurrences(of: "/", with: "_")).bin")
    }
}
