import Foundation

/// Settings that live only in memory, one store per test. A `UserDefaults(suiteName:)` suite
/// leaves its plist in ~/Library/Preferences even after `removePersistentDomain`, so every run
/// added files to the real Preferences folder.
final class TestDefaults: UserDefaults, @unchecked Sendable {
    private var values: [String: Any] = [:]
    private let lock = NSLock()

    init() { super.init(suiteName: nil)! }

    // The typed getters and setters (bool, string, stringArray, data…) all come through these.
    override func object(forKey key: String) -> Any? { lock.withLock { values[key] } }
    override func set(_ value: Any?, forKey key: String) { lock.withLock { values[key] = value } }
    override func removeObject(forKey key: String) { lock.withLock { _ = values.removeValue(forKey: key) } }
}
