import Foundation

/// A Keychain that refuses to take the account's key, on demand, so what the app does then can be
/// walked through on a real device (AccountCrypto.keep, the fallback in KeychainAccountKeyStore,
/// and "Your key couldn't be saved"):
///
///     -keyFault synced     writes of the synced item are refused; the key is kept on this device only
///     -keyFault all        every write is refused; the notes open, and the app says the key wasn't saved
///
/// Development builds only (Debug and QA). The released app and Pinto Notes Beta are Release
/// builds: the check in `KeychainAccountKeyStore.save` isn't compiled into them, and `from` answers
/// nil for them whatever the arguments say. Nothing is written to or removed from the Keychain by a
/// refused save: it returns before the Keychain is touched.
enum KeyFault: String, Equatable, Sendable {
    case synced, all

    static let isDevelopmentBuild: Bool = {
        #if DEBUG || QA
        true
        #else
        false
        #endif
    }()

    /// The fault this launch asked for, if this build honours one.
    static let active = from(ProcessInfo.processInfo.arguments, development: isDevelopmentBuild)

    static func from(_ arguments: [String], development: Bool) -> KeyFault? {
        guard development, let i = arguments.firstIndex(of: "-keyFault"), arguments.indices.contains(i + 1) else { return nil }
        return KeyFault(rawValue: arguments[i + 1])
    }

    func refuses(_ slot: KeySlot) -> Bool { self == .all || slot == .synced }
}
