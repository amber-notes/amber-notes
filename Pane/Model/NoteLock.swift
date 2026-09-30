import CommonCrypto
import CryptoKit
import Foundation
import LocalAuthentication
import Observation
import Security
import SwiftData

/// How a locked note's text is sealed, like Apple Notes: on the device, before it's saved or
/// synced, so the server, the AI tools and anyone reading the database see only ciphertext.
///
/// One notes password for the account. The key is PBKDF2-HMAC-SHA256 of the password with a
/// random per-account salt (kept on the server with the iteration count), 256 bits. Each note
/// is one AES-GCM box: `amb1.<key id>.<base64 nonce‖ciphertext‖tag>`, where the key id is the
/// first 8 bytes of SHA-256(salt) in hex and the header is authenticated too. The title stays
/// plain text so the list can show it.
enum NoteCrypto {
    static let prefix = "amb1"
    /// OWASP's figure for PBKDF2-HMAC-SHA256; about half a second on a recent iPhone.
    static let iterations = 600_000
    /// A text sealed with the key, so a password can be checked without any note.
    static let verifierText = "Amber Notes locked notes"

    enum Failure: Error, Equatable { case wrongPassword, malformed }

    static func newSalt() -> Data {
        var bytes = [UInt8](repeating: 0, count: 16)
        precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess)
        return Data(bytes)
    }

    static func keyID(salt: Data) -> String {
        SHA256.hash(data: salt).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// Slow on purpose: call it off the main thread.
    static func deriveKey(password: String, salt: Data, iterations: Int) -> SymmetricKey {
        // The same password typed on a Mac and an iPhone can arrive composed differently.
        let pw = Array(password.precomposedStringWithCanonicalMapping.utf8).map { CChar(bitPattern: $0) }
        var out = [UInt8](repeating: 0, count: 32)
        let status = salt.withUnsafeBytes { s in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw, pw.count,
                                 s.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                 CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, out.count)
        }
        precondition(status == kCCSuccess, "PBKDF2 failed: \(status)")
        return SymmetricKey(data: out)
    }

    static func seal(_ text: String, key: SymmetricKey, keyID: String) throws -> String {
        let header = "\(prefix).\(keyID)"
        let box = try AES.GCM.seal(Data(text.utf8), using: key, authenticating: Data(header.utf8))
        guard let combined = box.combined else { throw Failure.malformed }
        return header + "." + combined.base64EncodedString()
    }

    /// The key id a sealed text names, or nil when it isn't one.
    static func keyID(of sealed: String) -> String? {
        let parts = sealed.split(separator: ".", maxSplits: 2)
        guard parts.count == 3, parts[0] == prefix else { return nil }
        return String(parts[1])
    }

    static func open(_ sealed: String, key: SymmetricKey) throws -> String {
        let parts = sealed.split(separator: ".", maxSplits: 2)
        guard parts.count == 3, parts[0] == prefix, let data = Data(base64Encoded: String(parts[2])),
              let box = try? AES.GCM.SealedBox(combined: data) else { throw Failure.malformed }
        guard let plain = try? AES.GCM.open(box, using: key, authenticating: Data("\(parts[0]).\(parts[1])".utf8)),
              let text = String(data: plain, encoding: .utf8) else { throw Failure.wrongPassword }
        return text
    }

    static func verifier(key: SymmetricKey, keyID: String) throws -> String {
        try seal(verifierText, key: key, keyID: keyID)
    }

    static func check(_ key: SymmetricKey, against verifier: String) -> Bool {
        (try? open(verifier, key: key)) == verifierText
    }
}

/// The account's notes password setup, as the server keeps it (`note_locks`). Nothing secret.
struct LockSettings: Codable, Equatable, Sendable {
    struct Earlier: Codable, Equatable, Sendable {
        var salt: String
        var iterations: Int
        var key_id: String
    }

    var salt: String
    var iterations: Int
    var key_id: String
    var verifier: String
    var hint: String?
    var previous: [Earlier] = []

    var saltData: Data { Data(base64Encoded: salt) ?? Data() }
}

enum NoteLockError: LocalizedError, Equatable {
    case wrongPassword
    case notUnlocked
    case alreadySetUp
    case changedElsewhere
    case hasFilesOrSubNotes
    case offline
    case other(String)

    var errorDescription: String? {
        switch self {
        case .wrongPassword: "That password is incorrect."
        case .notUnlocked: "Enter your notes password first."
        case .alreadySetUp: "You already have a notes password, set on another device. Enter it to lock this note."
        case .changedElsewhere: "Your notes password was changed on another device. Enter the new one."
        case .hasFilesOrSubNotes: "Notes with files or sub-notes can't be locked."
        case .offline: "You're offline. Connect to the internet to set or change your notes password."
        case .other(let s): s
        }
    }
}

/// Where the account's password setup lives: the server, or nowhere (local-only builds).
protocol NoteLockRemote: Sendable {
    func fetch() async throws -> LockSettings?
    /// Fails with `.alreadySetUp` when another device got there first.
    func create(_ settings: LockSettings) async throws
    /// Replaces the setup only if it still has `keyID`; otherwise `.changedElsewhere`.
    func replace(_ settings: LockSettings, expecting keyID: String) async throws
}

/// Keeps the derived key on this device, behind Face ID or Touch ID.
protocol LockKeyStore: Sendable {
    var biometryName: String? { get }
    func save(_ key: SymmetricKey, keyID: String) -> Bool
    func load(keyID: String, reason: String) async -> SymmetricKey?
    func remove()
}

/// The unlocked state and everything that reads or writes a locked note's text.
///
/// Unlocking (with the password, or Face ID / Touch ID) opens every locked note until you lock
/// them again ("Lock Now"), the app goes to the background, or nothing has happened in a locked
/// note for `relockAfter`. The key lives in memory while unlocked, and in the Keychain behind
/// biometrics (`.biometryCurrentSet`) for the next Face ID unlock. Opened text is never saved:
/// a locked note's `body` is its title and `lockedBody` the sealed text, here and on the server.
@MainActor
@Observable
final class NoteVault {
    /// The app's vault. Tests make their own.
    static var shared = NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults())

    private(set) var settings: LockSettings?
    /// Keys this device knows this session, by key id: the current one once unlocked, and older
    /// ones kept after the password changed elsewhere, so notes sealed with them can move over.
    private var keys: [String: SymmetricKey] = [:]
    /// Opened texts, by note, while unlocked; dropped when locking.
    @ObservationIgnored private var opened: [UUID: (sealed: String, text: String)] = [:]
    @ObservationIgnored private(set) var lastActivity = Date.now
    var relockAfter: TimeInterval = 5 * 60
    /// Face ID / Touch ID unlocks, when this device has it.
    var usesBiometrics: Bool {
        didSet {
            defaults.set(usesBiometrics, forKey: "noteLock.biometrics")
            if !usesBiometrics { keyStore.remove() }
        }
    }

    let keyStore: LockKeyStore
    private var remote: NoteLockRemote?
    private var account = "local"
    private let defaults: UserDefaults
    private let iterations: Int
    @ObservationIgnored private var idleWatch: Task<Void, Never>?

    /// The app's vault tells sync whether this account locks notes (`NoteDTO.sendsLock`); vaults
    /// made in tests leave that alone.
    private let drivesSync: Bool

    init(keyStore: LockKeyStore, remote: NoteLockRemote? = nil, defaults: UserDefaults = .standard,
         iterations: Int = NoteCrypto.iterations, drivesSync: Bool = false) {
        self.keyStore = keyStore
        self.drivesSync = drivesSync
        self.remote = remote
        self.defaults = defaults
        self.iterations = iterations
        usesBiometrics = defaults.object(forKey: "noteLock.biometrics") as? Bool ?? true
        settings = Self.stored(in: defaults, account: account)
        publish()
    }

    var isSetUp: Bool { settings != nil }
    var isUnlocked: Bool { settings.map { keys[$0.key_id] != nil } ?? false }
    var biometryName: String? { usesBiometrics ? keyStore.biometryName : nil }

    // MARK: Account

    /// A different account (or none): its own setup, everything locked.
    func attach(account: UUID?, remote: NoteLockRemote?) {
        let name = account?.uuidString.lowercased() ?? "local"
        self.remote = remote
        guard name != self.account else { return }
        lockNow()
        keys = [:]
        self.account = name
        settings = Self.stored(in: defaults, account: name)
        publish()
    }

    /// Picks up a setup made (or a password changed) on another device.
    func refresh() async {
        guard let remote, let fresh = try? await remote.fetch() else { return }
        adopt(fresh)
    }

    private func adopt(_ fresh: LockSettings) {
        guard fresh != settings else { return }
        let changed = settings.map { $0.key_id != fresh.key_id } ?? false
        settings = fresh
        store()
        if changed {
            // The old key stays in memory for notes this device sealed with it; the Keychain's goes.
            keyStore.remove()
            opened = [:]
        }
    }

    private func publish() {
        if drivesSync { NoteDTO.sendsLock = settings != nil }
    }

    private static func stored(in defaults: UserDefaults, account: String) -> LockSettings? {
        defaults.data(forKey: "noteLock.settings.\(account)").flatMap { try? JSONDecoder().decode(LockSettings.self, from: $0) }
    }

    private func store() {
        defaults.set(try? JSONEncoder().encode(settings), forKey: "noteLock.settings.\(account)")
        publish()
    }

    // MARK: Password

    /// The first time: one password for every locked note, with a hint. Unlocks.
    func setUp(password: String, hint: String?) async throws {
        if let remote, let existing = try? await remote.fetch() { adopt(existing) }
        guard settings == nil else { throw NoteLockError.alreadySetUp }
        let fresh = try await Self.makeSettings(password: password, hint: hint, iterations: iterations)
        if let remote {
            do { try await remote.create(fresh.settings) } catch let e as NoteLockError { throw e } catch { throw NoteLockError.offline }
        }
        settings = fresh.settings
        store()
        unlocked(with: fresh.key)
    }

    private static func makeSettings(password: String, hint: String?, iterations: Int, previous: [LockSettings.Earlier] = []) async throws -> (settings: LockSettings, key: SymmetricKey) {
        let salt = NoteCrypto.newSalt()
        let keyID = NoteCrypto.keyID(salt: salt)
        let key = await Task.detached { NoteCrypto.deriveKey(password: password, salt: salt, iterations: iterations) }.value
        let hint = hint?.trimmingCharacters(in: .whitespacesAndNewlines)
        let settings = LockSettings(salt: salt.base64EncodedString(), iterations: iterations, key_id: keyID,
                                    verifier: try NoteCrypto.verifier(key: key, keyID: keyID),
                                    hint: hint?.isEmpty == false ? String(hint!.prefix(200)) : nil, previous: previous)
        return (settings, key)
    }

    /// Opens every locked note. Throws `.wrongPassword`.
    func unlock(password: String) async throws {
        guard let s = settings else { throw NoteLockError.notUnlocked }
        let salt = s.saltData, iterations = s.iterations
        let key = await Task.detached { NoteCrypto.deriveKey(password: password, salt: salt, iterations: iterations) }.value
        guard NoteCrypto.check(key, against: s.verifier) else {
            // Maybe it changed on another device since this one last looked.
            if let remote, let fresh = try? await remote.fetch(), fresh.key_id != s.key_id {
                adopt(fresh)
                return try await unlock(password: password)
            }
            throw NoteLockError.wrongPassword
        }
        unlocked(with: key)
    }

    /// Face ID or Touch ID. False when it's off, unavailable, cancelled or out of date.
    func unlockWithBiometrics(reason: String = "Unlock your locked notes") async -> Bool {
        guard let s = settings, biometryName != nil, let key = await keyStore.load(keyID: s.key_id, reason: reason),
              NoteCrypto.check(key, against: s.verifier) else { return false }
        unlocked(with: key)
        return true
    }

    private func unlocked(with key: SymmetricKey) {
        guard let s = settings else { return }
        keys[s.key_id] = key
        if usesBiometrics { _ = keyStore.save(key, keyID: s.key_id) }
        touch()
        watchIdle()
    }

    /// New password: every locked note on this device is sealed again with the new key.
    /// Nothing changes unless the server took the new setup first.
    func changePassword(old: String, new: String, hint: String?, in context: ModelContext) async throws {
        guard let s = settings else { throw NoteLockError.notUnlocked }
        let salt = s.saltData, iterations = s.iterations
        let oldKey = await Task.detached { NoteCrypto.deriveKey(password: old, salt: salt, iterations: iterations) }.value
        guard NoteCrypto.check(oldKey, against: s.verifier) else { throw NoteLockError.wrongPassword }
        keys[s.key_id] = oldKey
        DebouncedSave.flushAll()
        let earlier = (s.previous + [.init(salt: s.salt, iterations: s.iterations, key_id: s.key_id)]).suffix(50)
        let fresh = try await Self.makeSettings(password: new, hint: hint, iterations: self.iterations, previous: Array(earlier))
        // Sealed again in memory first: the server gets the new setup before any note changes.
        var resealed: [(Note, String)] = []
        for n in Self.lockedNotes(in: context) {
            guard let sealed = n.lockedBody, let id = NoteCrypto.keyID(of: sealed), let key = keys[id],
                  let text = try? NoteCrypto.open(sealed, key: key) else { continue }
            resealed.append((n, try NoteCrypto.seal(text, key: fresh.key, keyID: fresh.settings.key_id)))
        }
        if let remote {
            do { try await remote.replace(fresh.settings, expecting: s.key_id) } catch let e as NoteLockError { throw e } catch { throw NoteLockError.offline }
        }
        settings = fresh.settings
        store()
        keyStore.remove()
        opened = [:]
        for (n, sealed) in resealed {
            n.lockedBody = sealed
            n.touch()
        }
        try? context.save()
        unlocked(with: fresh.key)
    }

    /// Opens a note sealed with an earlier password (set before a change on another device), and
    /// seals it again with the current one. Needs the current password unlocked first.
    func openEarlier(_ note: Note, password: String) async throws {
        guard let s = settings, isUnlocked, let sealed = note.lockedBody, let id = NoteCrypto.keyID(of: sealed) else { throw NoteLockError.notUnlocked }
        guard let earlier = s.previous.last(where: { $0.key_id == id }) else { throw NoteLockError.wrongPassword }
        let salt = Data(base64Encoded: earlier.salt) ?? Data(), iterations = earlier.iterations
        let key = await Task.detached { NoteCrypto.deriveKey(password: password, salt: salt, iterations: iterations) }.value
        guard let text = try? NoteCrypto.open(sealed, key: key) else { throw NoteLockError.wrongPassword }
        keys[id] = key
        try write(text, to: note)
    }

    // MARK: Locking

    func lockNow() {
        guard !keys.isEmpty || !opened.isEmpty else { return }
        // Typing not yet in the note is sealed while the key is still here.
        DebouncedSave.flushAll()
        keys = [:]
        opened = [:]
        idleWatch?.cancel()
        idleWatch = nil
    }

    /// Something happened in a locked note: the relock clock starts again.
    func touch() { lastActivity = .now }

    /// Relocks after `relockAfter` with nothing happening.
    func expireIfIdle(now: Date = .now) {
        if isUnlocked, now.timeIntervalSince(lastActivity) >= relockAfter { lockNow() }
    }

    private func watchIdle() {
        guard idleWatch == nil else { return }
        idleWatch = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                // Gone with its vault, not left waking forever.
                guard let self else { return }
                self.expireIfIdle()
            }
        }
    }

    /// Why a note can't be locked, or nil. Files and sub-notes live outside the note's text, so
    /// they'd stay readable: like Apple Notes with some attachments, those notes can't be locked.
    static func blocker(for note: Note) -> NoteLockError? {
        note.body.contains("pane-file:") || note.body.contains("pane-note:") ? .hasFilesOrSubNotes : nil
    }

    /// Seals the note's text. Its earlier versions are deleted on the server when this syncs.
    func lock(_ note: Note) throws {
        guard let s = settings, let key = keys[s.key_id] else { throw NoteLockError.notUnlocked }
        guard note.lockedBody == nil else { return }
        if let why = Self.blocker(for: note) { throw why }
        let text = note.body
        let sealed = try NoteCrypto.seal(text, key: key, keyID: s.key_id)
        note.lockedBody = sealed
        note.body = Self.titleLine(of: text)
        opened[note.id] = (sealed, text)
        note.touch()
        touch()
    }

    /// Back to a normal note.
    func removeLock(_ note: Note) throws {
        guard note.lockedBody != nil else { return }
        guard let text = text(of: note) else { throw NoteLockError.notUnlocked }
        opened[note.id] = nil
        note.lockedBody = nil
        note.body = text
        note.touch()
    }

    /// A locked note's text, or nil while it's locked (or sealed with a key this device lacks).
    func text(of note: Note) -> String? {
        guard let sealed = note.lockedBody else { return note.body }
        if let o = opened[note.id], o.sealed == sealed { return o.text }
        guard let id = NoteCrypto.keyID(of: sealed), let key = keys[id], settings.map({ keys[$0.key_id] != nil }) == true,
              let text = try? NoteCrypto.open(sealed, key: key) else { return nil }
        opened[note.id] = (sealed, text)
        return text
    }

    /// True when the note is sealed with an earlier password this device can't open yet.
    func needsEarlierPassword(_ note: Note) -> Bool {
        guard isUnlocked, let sealed = note.lockedBody, let id = NoteCrypto.keyID(of: sealed) else { return false }
        return id != settings?.key_id && keys[id] == nil
    }

    /// Typing in an open locked note: sealed again with the current key; the title follows.
    func write(_ text: String, to note: Note) throws {
        guard let s = settings, let key = keys[s.key_id] else { throw NoteLockError.notUnlocked }
        let sealed = try NoteCrypto.seal(text, key: key, keyID: s.key_id)
        note.lockedBody = sealed
        note.body = Self.titleLine(of: text)
        opened[note.id] = (sealed, text)
        note.touch()
        touch()
    }

    /// What a locked note keeps in the clear: its title, on one line.
    static func titleLine(of text: String) -> String {
        String(NoteText.title(of: text).replacingOccurrences(of: "\n", with: " ").prefix(300))
    }

    static func lockedNotes(in context: ModelContext) -> [Note] {
        ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.lockedBody != nil && $0.deletedAt == nil }
    }
}

/// Settings that live only in memory: tests and captures start with no notes password and leave
/// nothing on disk (a UserDefaults suite leaves its file behind even when emptied).
final class MemoryDefaults: UserDefaults, @unchecked Sendable {
    private var values: [String: Any] = [:]
    private let lock = NSLock()

    init() { super.init(suiteName: nil)! }

    override func object(forKey key: String) -> Any? { lock.withLock { values[key] } }
    override func set(_ value: Any?, forKey key: String) { lock.withLock { values[key] = value } }
    override func removeObject(forKey key: String) { lock.withLock { _ = values.removeValue(forKey: key) } }
}

// MARK: Key storage

/// Tests and captures: nothing leaves memory, and there's no biometry.
final class MemoryKeyStore: LockKeyStore, @unchecked Sendable {
    private var keys: [String: SymmetricKey] = [:]
    private let lock = NSLock()
    let biometryName: String?

    init(biometryName: String? = nil) { self.biometryName = biometryName }

    func save(_ key: SymmetricKey, keyID: String) -> Bool { lock.withLock { keys = [keyID: key] }; return true }
    func load(keyID: String, reason: String) async -> SymmetricKey? { lock.withLock { keys[keyID] } }
    func remove() { lock.withLock { keys = [:] } }
}

/// The derived key in the Keychain, readable only after Face ID or Touch ID on this device, and
/// gone when the enrolled faces or fingers change (`.biometryCurrentSet`).
struct KeychainKeyStore: LockKeyStore {
    static let service = "dev.emilwagman.pane.notes-lock"

    var biometryName: String? {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return nil }
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return nil
        }
    }

    private func query(_ keyID: String? = nil) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
                                kSecUseDataProtectionKeychain as String: true]
        if let keyID { q[kSecAttrAccount as String] = keyID }
        return q
    }

    func save(_ key: SymmetricKey, keyID: String) -> Bool {
        remove()
        guard biometryName != nil,
              let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil) else { return false }
        var q = query(keyID)
        q[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        q[kSecAttrAccessControl as String] = access
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func load(keyID: String, reason: String) async -> SymmetricKey? {
        let service = Self.service
        // Waits for Face ID or Touch ID; kept off the main thread.
        return await Task.detached {
            let context = LAContext()
            context.localizedReason = reason
            let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecUseDataProtectionKeychain as String: true, kSecAttrAccount as String: keyID,
                                    kSecReturnData as String: true, kSecUseAuthenticationContext as String: context]
            var out: CFTypeRef?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
            return SymmetricKey(data: data)
        }.value
    }

    func remove() {
        SecItemDelete(query() as CFDictionary)
    }
}
