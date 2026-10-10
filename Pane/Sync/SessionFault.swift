import Foundation
import Security

/// A Keychain whose items can't be changed once they're there, on demand, so what the app does
/// about one can be walked through on a real device (SessionStorage: Sign Out has to stay signed
/// out, and a newer session has to win over the item):
///
///     -sessionFault stuck
///
/// The stand-in keeps its items in a file of its own in the app's folder, so they're still there
/// at the next launch, and takes the first write of each item; after that every change and every
/// delete is refused with -34018, as the real Keychain did on the Mac download after the update
/// to 1.2. The real Keychain is never touched while it's on.
///
/// Development builds only (Debug and QA). The released app and Pinto Notes Beta are Release
/// builds: the check in `SessionStorage` isn't compiled into them, and `from` answers nil for
/// them whatever the arguments say.
enum SessionFault: String, Equatable, Sendable {
    case stuck

    static let isDevelopmentBuild: Bool = {
        #if DEBUG || QA
        true
        #else
        false
        #endif
    }()

    static let active = from(ProcessInfo.processInfo.arguments, development: isDevelopmentBuild)

    static func from(_ arguments: [String], development: Bool) -> SessionFault? {
        guard development, let i = arguments.firstIndex(of: "-sessionFault"), arguments.indices.contains(i + 1) else { return nil }
        return SessionFault(rawValue: arguments[i + 1])
    }

    func keychain(in directory: URL) -> SessionKeychain {
        StuckSessionKeychain(file: directory.appending(path: "session-fault-keychain.plist"))
    }
}

/// Takes an item once; reads it back; refuses every change and delete.
final class StuckSessionKeychain: SessionKeychain, @unchecked Sendable {
    private let file: URL
    private let lock = NSLock()

    init(file: URL) { self.file = file }

    private var items: [String: Data] {
        get { (try? PropertyListDecoder().decode([String: Data].self, from: Data(contentsOf: file))) ?? [:] }
        set {
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? PropertyListEncoder().encode(newValue).write(to: file, options: .atomic)
        }
    }

    func read(_ key: String) -> (status: OSStatus, data: Data?) {
        lock.withLock { items[key].map { (errSecSuccess, $0) } ?? (errSecItemNotFound, nil) }
    }

    func add(_ key: String, _ value: Data) -> OSStatus {
        lock.withLock {
            var all = items
            guard all[key] == nil else { return errSecDuplicateItem }
            all[key] = value
            items = all
            return errSecSuccess
        }
    }

    func update(_ key: String, _ value: Data) -> OSStatus { lock.withLock { items[key] == nil ? errSecItemNotFound : errSecMissingEntitlement } }
    func delete(_ key: String) -> OSStatus { lock.withLock { items[key] == nil ? errSecItemNotFound : errSecMissingEntitlement } }
}
