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
/// is one AES-GCM box: `amb2.<key id>.<base64 nonce‖ciphertext‖tag>`, where the key id is the
/// first 8 bytes of SHA-256(salt) in hex. The header and the note's id are authenticated, so a
/// box can't be passed off as another note's. The title stays plain text so the list can show it.
enum NoteCrypto {
    static let prefix = "amb2"
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

    /// What a note's box is bound to.
    static func context(of note: UUID) -> String { "note:" + note.uuidString.lowercased() }

    static func aad(_ keyID: Substring, _ context: String) -> Data {
        Data("\(prefix).\(keyID)|\(context)".utf8)
    }

    /// `nonce` is for test vectors only; every real box gets a fresh random one.
    static func seal(_ text: String, key: SymmetricKey, keyID: String, context: String, nonce: AES.GCM.Nonce? = nil) throws -> String {
        let box = try AES.GCM.seal(Data(text.utf8), using: key, nonce: nonce ?? AES.GCM.Nonce(), authenticating: aad(Substring(keyID), context))
        guard let combined = box.combined else { throw Failure.malformed }
        return "\(prefix).\(keyID)." + combined.base64EncodedString()
    }

    private static func parts(_ sealed: String) -> [Substring]? {
        let parts = sealed.split(separator: ".", maxSplits: 2)
        guard parts.count == 3, parts[0] == prefix else { return nil }
        return parts
    }

    /// The key id a sealed text names, or nil when it isn't one.
    static func keyID(of sealed: String) -> String? { parts(sealed).map { String($0[1]) } }

    static func open(_ sealed: String, key: SymmetricKey, context: String) throws -> String {
        guard let p = parts(sealed), let data = Data(base64Encoded: String(p[2])),
              let box = try? AES.GCM.SealedBox(combined: data) else { throw Failure.malformed }
        guard let plain = try? AES.GCM.open(box, using: key, authenticating: aad(p[1], context)),
              let text = String(data: plain, encoding: .utf8) else { throw Failure.wrongPassword }
        return text
    }

    static func verifier(key: SymmetricKey, keyID: String) throws -> String {
        try seal(verifierText, key: key, keyID: keyID, context: "verifier")
    }

    static func check(_ key: SymmetricKey, against verifier: String) -> Bool {
        (try? open(verifier, key: key, context: "verifier")) == verifierText
    }

    /// Proof that whoever set the new password knew the old key: the old key, sealed with the new.
    static func proof(of oldKey: SymmetricKey, oldKeyID: String, sealedWith newKey: SymmetricKey, newKeyID: String) throws -> String {
        try seal(oldKey.withUnsafeBytes { Data($0) }.base64EncodedString(), key: newKey, keyID: newKeyID, context: "key:" + oldKeyID)
    }

    /// The old key a proof carries, if `newKey` opens it.
    static func openProof(_ proof: String, with newKey: SymmetricKey, oldKeyID: String) -> SymmetricKey? {
        guard let text = try? open(proof, key: newKey, context: "key:" + oldKeyID), let data = Data(base64Encoded: text),
              data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }
}

/// The account's notes password setup, as the server keeps it (`note_locks`). Nothing secret.
struct LockSettings: Codable, Equatable, Sendable {
    struct Earlier: Codable, Equatable, Sendable {
        var salt: String
        var iterations: Int
        var key_id: String
        /// This password's key, sealed with the next one's (see NoteCrypto.proof).
        var proof: String?
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
    case notesChanged
    case unverified
    case hasFilesOrSubNotes
    case offline
    case other(String)

    var errorDescription: String? {
        switch self {
        case .wrongPassword: "That password is incorrect."
        case .notUnlocked: "Enter your notes password first."
        case .alreadySetUp: "You already have a notes password, set on another device. Enter it to lock this note."
        case .changedElsewhere: "Your notes password was changed on another device. Enter the new one."
        case .notesChanged: "Your notes changed on another device. Try again in a moment."
        case .unverified: "The notes password on the server couldn't be checked against the one this device knows, so it wasn't used. Contact support."
        case .hasFilesOrSubNotes: "Notes with files or sub-notes can't be locked."
        case .offline: "You're offline. Connect to the internet to set or change your notes password."
        case .other(let s): s
        }
    }
}

/// A locked note sealed again for a password change, as the server takes it.
struct ResealedNote: Encodable, Sendable {
    var id: UUID
    /// The server version the note was at; the change fails if it moved on.
    var version: Int64
    /// Its title, which goes sealed with the account's key as the note's head.
    var title: String
    var locked_body: String

    enum CodingKeys: String, CodingKey { case id, version, head_ct, locked_body }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(version, forKey: .version)
        try c.encode(Wire.seal(head: Wire.head(body: title, locked: true), id), forKey: .head_ct)
        try c.encode(locked_body, forKey: .locked_body)
    }
}

/// Where the account's password setup lives: the server, or nowhere (local-only builds).
protocol NoteLockRemote: Sendable {
    func fetch() async throws -> LockSettings?
    /// Fails with `.alreadySetUp` when another device got there first.
    func create(_ settings: LockSettings) async throws
    /// Swaps the setup (only if it still has `keyID`) and writes the re-sealed notes, all at once.
    /// Returns each note's new server version. `.changedElsewhere` or `.notesChanged` otherwise.
    func changePassword(_ settings: LockSettings, expecting keyID: String, notes: [ResealedNote]) async throws -> [UUID: Int64]
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
/// them again ("Lock Now"), the app goes to the background, the Mac locks or sleeps, or nothing
/// has happened in a locked note for `relockAfter`. The key lives in memory while unlocked, and in
/// the Keychain behind biometrics (`.biometryCurrentSet`) for the next Face ID unlock. Opened text
/// is never saved: a locked note's `body` is its title and `lockedBody` the sealed text, here and
/// on the server.
///
/// A setup changed on another device isn't taken on the server's word: it's kept aside
/// (`pending`) until the new password opens it and its proof chain leads back to a key this
/// device already trusts.
@MainActor
@Observable
final class NoteVault {
    /// The app's vault. Tests make their own.
    static var shared = NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults())

    private(set) var settings: LockSettings?
    /// A different setup the server has, not yet proven (see the type's comment).
    private(set) var pending: LockSettings?
    /// Every setup this device has trusted, by key id, oldest first: the salts it has seen, with
    /// the verifiers that prove a key.
    private var trusted: [LockSettings] = []
    /// Keys this device knows this session, by key id: the current one once unlocked, and
    /// earlier ones (from the proof chain), so notes sealed with them still open.
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

    /// The app's vault nudges sync when the key arrives; vaults made in tests leave that alone.
    private let drivesSync: Bool

    init(keyStore: LockKeyStore, remote: NoteLockRemote? = nil, defaults: UserDefaults = .standard,
         iterations: Int = NoteCrypto.iterations, drivesSync: Bool = false) {
        self.keyStore = keyStore
        self.drivesSync = drivesSync
        self.remote = remote
        self.defaults = defaults
        self.iterations = iterations
        usesBiometrics = defaults.object(forKey: "noteLock.biometrics") as? Bool ?? true
        load()
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
        pending = nil
        self.account = name
        load()
    }

    /// Picks up a setup made on another device, or notices a password changed there.
    func refresh() async {
        let asked = account
        guard let remote, let fresh = try? await remote.fetch() else { return }
        // Signed out or into another account while the server was answering: not this one's.
        guard account == asked else { return }
        take(fresh)
    }

    private func take(_ fresh: LockSettings) {
        guard let s = settings else {
            // The first setup this device sees: nothing to check it against.
            settings = fresh
            trusted = [fresh]
            store()
            return
        }
        if fresh.key_id == s.key_id {
            // The same password; only the hint can change (the server refuses anything else).
            pending = nil
            if fresh.hint != s.hint { settings?.hint = fresh.hint; store() }
        } else if fresh != pending {
            pending = fresh
        }
    }

    private func load() {
        let key = "noteLock.trusted.\(account)"
        trusted = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode([LockSettings].self, from: $0) } ?? []
        settings = trusted.last
    }

    private func store() {
        if let s = settings, trusted.last?.key_id != s.key_id { trusted.append(s) } else if let s = settings { trusted[trusted.count - 1] = s }
        defaults.set(try? JSONEncoder().encode(trusted), forKey: "noteLock.trusted.\(account)")
    }

    // MARK: Password

    /// The first time: one password for every locked note, with a hint. Unlocks.
    func setUp(password: String, hint: String?) async throws {
        if let remote, let existing = try? await remote.fetch() { take(existing) }
        guard settings == nil else { throw NoteLockError.alreadySetUp }
        let fresh = try await Self.makeSettings(password: password, hint: hint, iterations: iterations)
        if let remote {
            do { try await remote.create(fresh.settings) } catch let e as NoteLockError { throw e } catch { throw NoteLockError.offline }
        }
        settings = fresh.settings
        store()
        unlocked(with: fresh.key)
    }

    private static func derive(_ password: String, _ s: LockSettings) async -> SymmetricKey {
        let salt = s.saltData, iterations = s.iterations
        return await Task.detached { NoteCrypto.deriveKey(password: password, salt: salt, iterations: iterations) }.value
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

    /// Every earlier key a setup's proofs lead to from `key` (its own key), newest first.
    private static func chain(_ s: LockSettings, from key: SymmetricKey) -> [String: SymmetricKey] {
        var found = [s.key_id: key]
        var next = key
        for e in s.previous.reversed() {
            guard let proof = e.proof, let k = NoteCrypto.openProof(proof, with: next, oldKeyID: e.key_id) else { break }
            found[e.key_id] = k
            next = k
        }
        return found
    }

    /// Opens every locked note. Throws `.wrongPassword`, or `.changedElsewhere` for the old
    /// password after a change on another device.
    func unlock(password: String) async throws {
        if pending == nil, let remote, let fresh = try? await remote.fetch() { take(fresh) }
        if let p = pending {
            let key = await Self.derive(password, p)
            if NoteCrypto.check(key, against: p.verifier) {
                // The new password: take the new setup only if its proofs reach a key we trust.
                let found = Self.chain(p, from: key)
                guard trusted.contains(where: { t in found[t.key_id].map { NoteCrypto.check($0, against: t.verifier) } ?? false }) else {
                    throw NoteLockError.unverified
                }
                settings = p
                pending = nil
                store()
                keyStore.remove()
                opened = [:]
                keys.merge(found) { new, _ in new }
                unlocked(with: key)
                return
            }
        }
        guard let s = settings else { throw NoteLockError.notUnlocked }
        let key = await Self.derive(password, s)
        guard NoteCrypto.check(key, against: s.verifier) else { throw NoteLockError.wrongPassword }
        // The right password until it was changed elsewhere: the new one is needed now.
        if pending != nil { throw NoteLockError.changedElsewhere }
        unlocked(with: key)
    }

    /// Face ID or Touch ID. False when it's off, unavailable, cancelled or out of date.
    func unlockWithBiometrics(reason: String = "Unlock your locked notes") async -> Bool {
        guard pending == nil, let s = settings, biometryName != nil, let key = await keyStore.load(keyID: s.key_id, reason: reason),
              NoteCrypto.check(key, against: s.verifier) else { return false }
        unlocked(with: key)
        return true
    }

    private func unlocked(with key: SymmetricKey) {
        guard let s = settings else { return }
        // Earlier keys too, so notes sealed before a password change still open.
        keys.merge(Self.chain(s, from: key)) { new, _ in new }
        if usesBiometrics { _ = keyStore.save(key, keyID: s.key_id) }
        touch()
        watchIdle()
        // A note waiting for the key to sync (see SyncEngine.resolveConflict) can go now.
        if drivesSync { SyncSignal.changed() }
    }

    /// New password: every locked note is sealed again with the new key, and versions sealed with
    /// earlier keys are removed from history. Nothing changes unless the server took it all.
    func changePassword(old: String, new: String, hint: String?, in context: ModelContext) async throws {
        if let remote, let fresh = try? await remote.fetch() { take(fresh) }
        guard pending == nil else { throw NoteLockError.changedElsewhere }
        guard let s = settings else { throw NoteLockError.notUnlocked }
        let oldKey = await Self.derive(old, s)
        guard NoteCrypto.check(oldKey, against: s.verifier) else { throw NoteLockError.wrongPassword }
        keys.merge(Self.chain(s, from: oldKey)) { new, _ in new }
        DebouncedSave.flushAll()
        // The new salt first, then the proof that ties the old key to it.
        var fresh = try await Self.makeSettings(password: new, hint: hint, iterations: iterations)
        let proof = try NoteCrypto.proof(of: oldKey, oldKeyID: s.key_id, sealedWith: fresh.key, newKeyID: fresh.settings.key_id)
        fresh.settings.previous = Array((s.previous + [.init(salt: s.salt, iterations: s.iterations, key_id: s.key_id, proof: proof)]).suffix(50))
        // Sealed again in memory first: the server gets the setup and the notes together.
        var resealed: [(Note, String, String)] = []
        for n in Self.lockedNotes(in: context) {
            guard let text = open(n) else { continue }
            let sealed = try NoteCrypto.seal(text, key: fresh.key, keyID: fresh.settings.key_id, context: NoteCrypto.context(of: n.id))
            resealed.append((n, sealed, Self.titleLine(of: text)))
        }
        var versions: [UUID: Int64] = [:]
        if let remote {
            let onServer = resealed.filter { $0.0.serverVersion > 0 }
                .map { ResealedNote(id: $0.0.id, version: $0.0.serverVersion, title: $0.2, locked_body: $0.1) }
            do { versions = try await remote.changePassword(fresh.settings, expecting: s.key_id, notes: onServer) }
            catch let e as NoteLockError { throw e } catch { throw NoteLockError.offline }
        }
        settings = fresh.settings
        store()
        keyStore.remove()
        opened = [:]
        for (n, sealed, title) in resealed {
            n.lockedBody = sealed
            n.body = title
            if let v = versions[n.id] {
                // Already on the server as it is here; anything else unpushed still goes up.
                n.serverVersion = v
            } else {
                n.touch()
            }
        }
        try? context.save()
        unlocked(with: fresh.key)
    }

    /// Opens a note sealed with an earlier password this device has no key for (its proof chain
    /// was cut short), and seals it again with the current one. Needs the vault unlocked.
    func openEarlier(_ note: Note, password: String) async throws {
        guard let s = settings, isUnlocked, let sealed = note.lockedBody, let id = NoteCrypto.keyID(of: sealed) else { throw NoteLockError.notUnlocked }
        guard let earlier = (s.previous.map { LockSettings(salt: $0.salt, iterations: $0.iterations, key_id: $0.key_id, verifier: "") } + trusted)
            .last(where: { $0.key_id == id }) else { throw NoteLockError.wrongPassword }
        let key = await Self.derive(password, earlier)
        guard let text = try? NoteCrypto.open(sealed, key: key, context: NoteCrypto.context(of: note.id)) else { throw NoteLockError.wrongPassword }
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
    /// The server can't read a note to check this, so the apps are the only guard.
    static func blocker(for note: Note) -> NoteLockError? {
        if note.body.contains("pane-file:") || note.body.contains("pane-note:") { return .hasFilesOrSubNotes }
        // A sub-note whose link was cut from the text is still this note's sub-note.
        let id = note.id
        let children = FetchDescriptor<Note>(predicate: #Predicate { $0.parentID == id && $0.deletedAt == nil })
        if let context = note.modelContext, ((try? context.fetchCount(children)) ?? 0) > 0 { return .hasFilesOrSubNotes }
        return nil
    }

    /// Seals the note's text. Its earlier versions are deleted on the server when this syncs.
    func lock(_ note: Note) throws {
        guard note.lockedBody == nil else { return }
        if let why = Self.blocker(for: note) { throw why }
        try write(note.body, to: note)
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

    /// A sealed text with whichever key this device has for it, bound to `note`.
    private func open(_ sealed: String, note: UUID) -> String? {
        guard let id = NoteCrypto.keyID(of: sealed), let key = keys[id] else { return nil }
        return try? NoteCrypto.open(sealed, key: key, context: NoteCrypto.context(of: note))
    }

    private func open(_ note: Note) -> String? { note.lockedBody.flatMap { open($0, note: note.id) } }

    /// A locked note's text, or nil while it's locked (or sealed with a key this device lacks).
    func text(of note: Note) -> String? {
        guard let sealed = note.lockedBody else { return note.body }
        if let o = opened[note.id], o.sealed == sealed { return o.text }
        guard isUnlocked, let text = open(sealed, note: note.id) else { return nil }
        opened[note.id] = (sealed, text)
        return text
    }

    /// Another device's sealed text of a note (a server row), while unlocked.
    func text(sealed: String, note: UUID) -> String? { isUnlocked ? open(sealed, note: note) : nil }

    /// True when the note is sealed with an earlier password this device can't open yet.
    func needsEarlierPassword(_ note: Note) -> Bool {
        guard isUnlocked, let sealed = note.lockedBody, let id = NoteCrypto.keyID(of: sealed) else { return false }
        return id != settings?.key_id && keys[id] == nil
    }

    /// Typing in an open locked note (or locking one): sealed with the current key and bound to
    /// the note; the title follows.
    func write(_ text: String, to note: Note) throws {
        guard let s = settings, let key = keys[s.key_id] else { throw NoteLockError.notUnlocked }
        let sealed = try NoteCrypto.seal(text, key: key, keyID: s.key_id, context: NoteCrypto.context(of: note.id))
        note.lockedBody = sealed
        note.body = Self.titleLine(of: text)
        opened[note.id] = (sealed, text)
        note.touch()
        touch()
    }

    /// A new locked note holding `text`, sealed for its own id: a conflicted copy of a locked note.
    func sealedCopy(of text: String, in folder: Folder?, at date: Date) throws -> Note {
        let copy = Note(body: "", folder: folder)
        try write(text, to: copy)
        copy.createdAt = date
        copy.updatedAt = date
        return copy
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
