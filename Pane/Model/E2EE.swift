import CryptoKit
import Foundation
import Observation
import Security

/// End-to-end encryption of the whole account (docs/Technical/e2ee-design.md).
///
/// One random data key per account, made on the first device that sets an encryption password.
/// Everything the account syncs is sealed with it before it leaves the device, in the locked-note
/// box format (`NoteCrypto`, amb2): note bodies, their titles and previews, folder names, file
/// names and file bytes. The server keeps the data key only wrapped: under the encryption password
/// (PBKDF2, like the notes password), under the recovery key if there is one, and under each AI
/// connection's tokens. The same formats are in supabase/functions/_shared/e2ee.ts and
/// web/lib/e2ee.ts; e2ee-vectors.json holds boxes all three must produce and open.
enum E2EE {
    static let hkdfSalt = Data("amber-notes/e2ee".utf8)
    static let fileMagic = Data("AMB2F".utf8)
    /// No 0/O, 1/I: easy to read back from paper.
    static let recoveryAlphabet = Array("23456789ABCDEFGHJKLMNPQRSTUVWXYZ")

    enum Failure: Error, Equatable { case malformed, wrongKey }

    static func newDataKey() -> SymmetricKey { SymmetricKey(size: .bits256) }

    static func bytes(_ key: SymmetricKey) -> Data { key.withUnsafeBytes { Data($0) } }

    /// The data key's id: the first 16 hex digits of SHA-256 of the key.
    static func keyID(of key: SymmetricKey) -> String {
        SHA256.hash(data: bytes(key)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    static func hex(_ data: some Sequence<UInt8>) -> String { data.map { String(format: "%02x", $0) }.joined() }
    static func sha256Hex(_ s: String) -> String { hex(SHA256.hash(data: Data(s.utf8))) }

    static func randomHex(bytes n: Int = 32) -> String {
        var b = [UInt8](repeating: 0, count: n)
        precondition(SecRandomCopyBytes(kSecRandomDefault, n, &b) == errSecSuccess)
        return hex(b)
    }

    // MARK: Contexts: what each box is bound to

    static func body(_ id: UUID) -> String { "body:" + id.uuidString.lowercased() }
    static func head(_ id: UUID) -> String { "head:" + id.uuidString.lowercased() }
    static func folder(_ id: UUID) -> String { "folder:" + id.uuidString.lowercased() }
    static func fileMeta(_ id: UUID) -> String { "file-meta:" + id.uuidString.lowercased() }
    static func file(_ id: UUID) -> String { "file:" + id.uuidString.lowercased() }
    static func wrap(_ purpose: String, user: UUID) -> String { "wrap:\(purpose):" + user.uuidString.lowercased() }

    // MARK: Files

    /// A file's bytes, sealed: "AMB2F" ‖ key id (16 ASCII) ‖ nonce ‖ ciphertext ‖ tag.
    static func sealFile(_ data: Data, key: SymmetricKey, keyID: String, id: UUID, nonce: AES.GCM.Nonce? = nil) throws -> Data {
        let box = try AES.GCM.seal(data, using: key, nonce: nonce ?? AES.GCM.Nonce(), authenticating: NoteCrypto.aad(Substring(keyID), file(id)))
        guard let combined = box.combined else { throw Failure.malformed }
        return fileMagic + Data(keyID.utf8) + combined
    }

    static func isSealedFile(_ data: Data) -> Bool { data.count >= 49 && data.prefix(5) == fileMagic }

    static func openFile(_ data: Data, key: SymmetricKey, id: UUID) throws -> Data {
        guard isSealedFile(data), let keyID = String(data: data.subdata(in: data.startIndex + 5 ..< data.startIndex + 21), encoding: .ascii),
              let box = try? AES.GCM.SealedBox(combined: data.subdata(in: data.startIndex + 21 ..< data.endIndex)) else { throw Failure.malformed }
        guard let plain = try? AES.GCM.open(box, using: key, authenticating: NoteCrypto.aad(Substring(keyID), file(id))) else { throw Failure.wrongKey }
        return plain
    }

    // MARK: Wrapping the data key

    /// The key a token or code opens its wrap with: HKDF-SHA256 of the token itself.
    static func tokenKey(_ secret: String, purpose: String) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(secret.utf8)), salt: hkdfSalt,
                               info: Data("wrap \(purpose)".utf8), outputByteCount: 32)
    }

    static func normalizeRecoveryKey(_ typed: String) -> String {
        String(typed.uppercased().unicodeScalars.filter { ("0"..."9").contains($0) || ("A"..."Z").contains($0) }.map(Character.init))
    }

    static func recoveryKEK(_ typed: String, user: UUID) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(normalizeRecoveryKey(typed).utf8)), salt: hkdfSalt,
                               info: Data("recovery \(user.uuidString.lowercased())".utf8), outputByteCount: 32)
    }

    /// 28 characters in groups of four, like Apple's recovery key.
    static func newRecoveryKey() -> String {
        var b = [UInt8](repeating: 0, count: 28)
        precondition(SecRandomCopyBytes(kSecRandomDefault, b.count, &b) == errSecSuccess)
        let chars = b.map { recoveryAlphabet[Int($0) % recoveryAlphabet.count] }
        return stride(from: 0, to: 28, by: 4).map { String(chars[$0 ..< $0 + 4]) }.joined(separator: "-")
    }

    static func wrap(_ dataKey: SymmetricKey, with kek: SymmetricKey, purpose: String, user: UUID, nonce: AES.GCM.Nonce? = nil) throws -> String {
        try NoteCrypto.seal(bytes(dataKey).base64EncodedString(), key: kek, keyID: keyID(of: dataKey), context: wrap(purpose, user: user), nonce: nonce)
    }

    static func unwrap(_ wrapped: String, with kek: SymmetricKey, purpose: String, user: UUID) throws -> SymmetricKey {
        guard let text = try? NoteCrypto.open(wrapped, key: kek, context: wrap(purpose, user: user)) else { throw Failure.wrongKey }
        guard let raw = Data(base64Encoded: text), raw.count == 32 else { throw Failure.malformed }
        let key = SymmetricKey(data: raw)
        guard keyID(of: key) == NoteCrypto.keyID(of: wrapped) else { throw Failure.malformed }
        return key
    }

    /// The sealer sync uses while the account's data key is open. Nil: this account isn't
    /// encrypted here (signed out, local only, or not yet set up).
    nonisolated(unsafe) static var sealer: Sealer?
}

/// What a note shows in lists, sealed next to its body.
struct NoteHead: Codable, Equatable {
    var title: String
    var preview: String

    static func of(_ body: String) -> NoteHead {
        let lines = NoteText.firstLines(of: body, count: 2)
        return NoteHead(title: lines.first ?? "New Note", preview: lines.count > 1 ? lines[1] : "")
    }
}

/// Seals and opens this account's boxes. The same text for the same thing seals to the same box
/// it had (remembered by a hash, not the text), so an unchanged note never looks changed.
final class Sealer: @unchecked Sendable {
    let key: SymmetricKey
    let keyID: String
    let user: UUID
    private var sealed: [String: (hash: SHA256.Digest, box: String)] = [:]
    private let lock = NSLock()

    init(key: SymmetricKey, user: UUID) {
        self.key = key
        keyID = E2EE.keyID(of: key)
        self.user = user
    }

    private func remember(_ context: String, _ plain: String, _ box: String) {
        lock.withLock { sealed[context] = (SHA256.hash(data: Data(plain.utf8)), box) }
    }

    func seal(_ plain: String, context: String) -> String? {
        let hash = SHA256.hash(data: Data(plain.utf8))
        if let s = lock.withLock({ sealed[context] }), s.hash == hash { return s.box }
        guard let box = try? NoteCrypto.seal(plain, key: key, keyID: keyID, context: context) else { return nil }
        lock.withLock { sealed[context] = (hash, box) }
        return box
    }

    func open(_ box: String, context: String) -> String? {
        guard let plain = try? NoteCrypto.open(box, key: key, context: context) else { return nil }
        remember(context, plain, box)
        return plain
    }

    func sealHead(_ head: NoteHead, note: UUID) -> String? {
        guard let json = try? String(data: JSONEncoder.sorted.encode(head), encoding: .utf8) else { return nil }
        return seal(json, context: E2EE.head(note))
    }

    func openHead(_ box: String, note: UUID) -> NoteHead? {
        open(box, context: E2EE.head(note)).flatMap { try? JSONDecoder().decode(NoteHead.self, from: Data($0.utf8)) }
    }

    func sealFile(_ data: Data, id: UUID) throws -> Data { try E2EE.sealFile(data, key: key, keyID: keyID, id: id) }
    func openFile(_ data: Data, id: UUID) throws -> Data { try E2EE.openFile(data, key: key, id: id) }
}

extension JSONEncoder {
    static let sorted: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()
}

// MARK: The account's keys on the server

/// `account_keys`: the salt and count the password key is made with, and the data key wrapped
/// under it (and under the recovery key). Nothing secret in the clear.
struct AccountKeys: Codable, Equatable, Sendable {
    var key_id: String
    var salt: String
    var iterations: Int
    var password_wrap: String
    var recovery_wrap: String?
}

protocol AccountKeysRemote: Sendable {
    func fetch() async throws -> AccountKeys?
    /// Fails with `.alreadySetUp` when another device got there first.
    func create(_ keys: AccountKeys) async throws
    func update(_ keys: AccountKeys) async throws
}

enum AccountCryptoError: LocalizedError, Equatable {
    case wrongPassword, wrongRecoveryKey, alreadySetUp, offline, tooShort, mismatch, notReady

    var errorDescription: String? {
        switch self {
        case .wrongPassword: "That password is incorrect."
        case .wrongRecoveryKey: "That recovery key doesn't match this account."
        case .alreadySetUp: "Encryption was set up on another device. Enter the encryption password you chose there."
        case .offline: "You're offline. Connect to the internet and try again."
        case .tooShort: "Use at least 8 characters."
        case .mismatch: "The two passwords don't match."
        case .notReady: "Enter your encryption password first."
        }
    }
}

// MARK: Keeping the data key on the device

protocol DataKeyStore: Sendable {
    func load(account: UUID) -> SymmetricKey?
    @discardableResult func save(_ key: SymmetricKey, account: UUID) -> Bool
    func remove(account: UUID)
}

/// Tests and unsigned builds: the key lives only as long as the app runs.
final class MemoryDataKeyStore: DataKeyStore, @unchecked Sendable {
    private var keys: [UUID: SymmetricKey] = [:]
    private let lock = NSLock()
    func load(account: UUID) -> SymmetricKey? { lock.withLock { keys[account] } }
    func save(_ key: SymmetricKey, account: UUID) -> Bool { lock.withLock { keys[account] = key }; return true }
    func remove(account: UUID) { lock.withLock { _ = keys.removeValue(forKey: account) } }
}

/// The data key in the Keychain, synced by iCloud Keychain (end-to-end encrypted by Apple) so the
/// user's other Apple devices have it without typing the password. Readable after the first
/// unlock, so sync keeps working in the background.
struct KeychainDataKeyStore: DataKeyStore {
    static let service = "dev.emilwagman.pane.data-key"

    private func query(_ account: UUID) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service,
         kSecAttrAccount as String: account.uuidString.lowercased(), kSecUseDataProtectionKeychain as String: true,
         kSecAttrSynchronizable as String: kSecAttrSynchronizableAny]
    }

    func load(account: UUID) -> SymmetricKey? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data, data.count == 32 else { return nil }
        return SymmetricKey(data: data)
    }

    func save(_ key: SymmetricKey, account: UUID) -> Bool {
        remove(account: account)
        var q = query(account)
        q[kSecAttrSynchronizable as String] = true
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        q[kSecValueData as String] = E2EE.bytes(key)
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func remove(account: UUID) {
        SecItemDelete(query(account) as CFDictionary)
    }
}

// MARK: The account's encryption state

/// Whether this account's notes can be opened here, and the screens that get it there: set an
/// encryption password (the first device), or type it (every other device, unless iCloud Keychain
/// already brought the key). Sync runs only once this is `.ready`.
@MainActor
@Observable
final class AccountCrypto {
    enum Phase: Equatable { case off, checking, needsSetup, needsPassword, ready, unreachable }

    static var shared = AccountCrypto(store: MemoryDataKeyStore())

    private(set) var phase: Phase = .off
    private(set) var keys: AccountKeys?
    private(set) var account: UUID?
    private(set) var dataKey: SymmetricKey?
    private var remote: AccountKeysRemote?
    let store: DataKeyStore
    /// Test runs use a few iterations; the app uses the notes password's figure.
    let iterations: Int

    init(store: DataKeyStore, iterations: Int = NoteCrypto.iterations) {
        self.store = store
        self.iterations = iterations
    }

    var isReady: Bool { phase == .ready }
    /// Sync runs with the key open, or for an account that isn't encrypted here at all.
    var allowsSync: Bool { phase == .ready || phase == .off }

    /// Signed in (or out): finds out whether the key is here, or what's needed to get it.
    func attach(account: UUID?, remote: AccountKeysRemote?) async {
        if account != self.account { dataKey = nil; keys = nil; E2EE.sealer = nil }
        self.account = account
        self.remote = remote
        guard let account, let remote else { phase = .off; E2EE.sealer = nil; return }
        if phase != .ready { phase = .checking }
        do {
            keys = try await remote.fetch()
        } catch is SupabaseAccountKeys.Unsupported {
            phase = .off
            E2EE.sealer = nil
            return
        } catch {
            // Offline with the key already here: carry on; sync waits for the network anyway.
            if let k = store.load(account: account) { open(k) } else { phase = .unreachable }
            return
        }
        guard let keys else {
            store.remove(account: account)
            dataKey = nil
            E2EE.sealer = nil
            phase = .needsSetup
            return
        }
        if let k = dataKey ?? store.load(account: account), E2EE.keyID(of: k) == keys.key_id {
            open(k)
        } else {
            dataKey = nil
            E2EE.sealer = nil
            phase = .needsPassword
        }
    }

    private func open(_ key: SymmetricKey) {
        guard let account else { return }
        dataKey = key
        E2EE.sealer = Sealer(key: key, user: account)
        phase = .ready
    }

    private func keep(_ key: SymmetricKey) {
        guard let account else { return }
        store.save(key, account: account)
        open(key)
    }

    /// The first device: a new data key, wrapped under the password (and a recovery key when
    /// asked for). Returns the recovery key, to be shown once.
    func setUp(password: String, confirm: String, recovery: Bool) async throws -> String? {
        guard password.count >= 8 else { throw AccountCryptoError.tooShort }
        guard password == confirm else { throw AccountCryptoError.mismatch }
        guard let account, let remote else { throw AccountCryptoError.offline }
        let key = E2EE.newDataKey()
        let salt = NoteCrypto.newSalt()
        let iterations = self.iterations
        let kek = await Task.detached { NoteCrypto.deriveKey(password: password, salt: salt, iterations: iterations) }.value
        let code = recovery ? E2EE.newRecoveryKey() : nil
        let fresh = AccountKeys(key_id: E2EE.keyID(of: key), salt: salt.base64EncodedString(), iterations: iterations,
                                password_wrap: try E2EE.wrap(key, with: kek, purpose: "password", user: account),
                                recovery_wrap: try code.map { try E2EE.wrap(key, with: E2EE.recoveryKEK($0, user: account), purpose: "recovery", user: account) })
        do { try await remote.create(fresh) } catch let e as AccountCryptoError { throw e } catch { throw AccountCryptoError.offline }
        keys = fresh
        keep(key)
        return code
    }

    func unlock(password: String) async throws {
        guard let account, let keys else { throw AccountCryptoError.notReady }
        let salt = Data(base64Encoded: keys.salt) ?? Data(), iterations = keys.iterations
        let kek = await Task.detached { NoteCrypto.deriveKey(password: password, salt: salt, iterations: iterations) }.value
        guard let key = try? E2EE.unwrap(keys.password_wrap, with: kek, purpose: "password", user: account) else { throw AccountCryptoError.wrongPassword }
        keep(key)
    }

    func unlock(recoveryKey: String) async throws {
        guard let account, let keys else { throw AccountCryptoError.notReady }
        guard let wrapped = keys.recovery_wrap,
              let key = try? E2EE.unwrap(wrapped, with: E2EE.recoveryKEK(recoveryKey, user: account), purpose: "recovery", user: account) else {
            throw AccountCryptoError.wrongRecoveryKey
        }
        keep(key)
    }

    /// A new password wraps the same key; nothing else changes.
    func changePassword(old: String, new: String, confirm: String) async throws {
        guard new.count >= 8 else { throw AccountCryptoError.tooShort }
        guard new == confirm else { throw AccountCryptoError.mismatch }
        guard let account, let remote, var keys, let dataKey else { throw AccountCryptoError.notReady }
        let oldSalt = Data(base64Encoded: keys.salt) ?? Data(), oldIterations = keys.iterations
        let oldKEK = await Task.detached { NoteCrypto.deriveKey(password: old, salt: oldSalt, iterations: oldIterations) }.value
        guard (try? E2EE.unwrap(keys.password_wrap, with: oldKEK, purpose: "password", user: account)) != nil else { throw AccountCryptoError.wrongPassword }
        let salt = NoteCrypto.newSalt(), iterations = self.iterations
        let kek = await Task.detached { NoteCrypto.deriveKey(password: new, salt: salt, iterations: iterations) }.value
        keys.salt = salt.base64EncodedString()
        keys.iterations = iterations
        keys.password_wrap = try E2EE.wrap(dataKey, with: kek, purpose: "password", user: account)
        do { try await remote.update(keys) } catch { throw AccountCryptoError.offline }
        self.keys = keys
    }

    /// A new recovery key replaces the old one, which stops working. Shown once.
    func newRecoveryKey() async throws -> String {
        guard let account, let remote, var keys, let dataKey else { throw AccountCryptoError.notReady }
        let code = E2EE.newRecoveryKey()
        keys.recovery_wrap = try E2EE.wrap(dataKey, with: E2EE.recoveryKEK(code, user: account), purpose: "recovery", user: account)
        do { try await remote.update(keys) } catch { throw AccountCryptoError.offline }
        self.keys = keys
        return code
    }

    /// Signing out forgets the key on this device (iCloud Keychain keeps it for the others).
    func signedOut() {
        dataKey = nil
        keys = nil
        E2EE.sealer = nil
        phase = .off
        account = nil
    }

    // MARK: AI connections

    /// An authorization code made here, with the data key wrapped under it for /connect/decide.
    func connectionCode() throws -> (code: String, hash: String, wrap: String) {
        guard let account, let dataKey else { throw AccountCryptoError.notReady }
        let code = "amb_code_" + E2EE.randomHex()
        return (code, E2EE.sha256Hex(code), try E2EE.wrap(dataKey, with: E2EE.tokenKey(code, purpose: "code"), purpose: "code", user: account))
    }

    /// A `pane_` access token made here, with its hash and the data key wrapped under it.
    func accessToken() throws -> (token: String, hash: String, wrap: String) {
        guard let account, let dataKey else { throw AccountCryptoError.notReady }
        let token = "pane_" + E2EE.randomHex()
        return (token, E2EE.sha256Hex(token), try E2EE.wrap(dataKey, with: E2EE.tokenKey(token, purpose: "pane"), purpose: "pane", user: account))
    }

    /// Tests: the key is here.
    func adoptForTesting(_ key: SymmetricKey, account: UUID, keys: AccountKeys? = nil) {
        self.account = account
        self.keys = keys
        open(key)
    }
}
