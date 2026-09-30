import CryptoKit
import Foundation
import Observation
import Security

/// End-to-end encryption of the whole account (docs/Technical/e2ee-design.md).
///
/// One random 256-bit data key (DK) per account, made on the account's first launch and kept in
/// iCloud Keychain. Everything the account syncs is sealed with it before it leaves the device, in
/// the locked-note box format (`NoteCrypto`, amb2): note bodies, titles and previews, folder names,
/// file names, file bytes and versions. The server holds no key material: only the key's id, a
/// verifier, and DK wrapped under the recovery key (and under each AI connection's tokens). The same
/// formats are in supabase/functions/_shared/e2ee.ts; e2ee-vectors.json pins them byte for byte.
enum E2EE {
    static let hkdfSalt = Data("amber-notes/e2ee".utf8)
    static let fileMagic = Data("AMB2F".utf8)

    enum Failure: Error, Equatable { case malformed, wrongKey }

    static func newDataKey() -> SymmetricKey { SymmetricKey(size: .bits256) }

    static func bytes(_ key: SymmetricKey) -> Data { key.withUnsafeBytes { Data($0) } }

    /// The data key's id: the first 16 hex digits of SHA-256 of the key.
    static func keyID(of key: SymmetricKey) -> String { keyID(of: bytes(key)) }
    static func keyID(of raw: Data) -> String { hex(SHA256.hash(data: raw).prefix(8)) }

    static func hex(_ data: some Sequence<UInt8>) -> String { data.map { String(format: "%02x", $0) }.joined() }
    static func sha256Hex(_ s: String) -> String { hex(SHA256.hash(data: Data(s.utf8))) }

    static func randomBytes(_ n: Int) -> Data {
        var b = [UInt8](repeating: 0, count: n)
        precondition(SecRandomCopyBytes(kSecRandomDefault, n, &b) == errSecSuccess)
        return Data(b)
    }

    static func randomHex(bytes n: Int = 32) -> String { hex(randomBytes(n)) }

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

    // MARK: The verifier: shows a key is the account's without the server holding it

    /// hex(HMAC-SHA256(HKDF(DK, info "verifier"), "amber-notes verifier|<user id>")).
    static func verifier(of key: SymmetricKey, user: UUID) -> String {
        let mac = HKDF<SHA256>.deriveKey(inputKeyMaterial: key, salt: hkdfSalt, info: Data("verifier".utf8), outputByteCount: 32)
        return hex(HMAC<SHA256>.authenticationCode(for: Data("amber-notes verifier|\(user.uuidString.lowercased())".utf8), using: mac))
    }

    // MARK: Wrapping the data key

    /// The key a token or code opens its wrap with: HKDF-SHA256 of the token itself.
    static func tokenKey(_ secret: String, purpose: String) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(secret.utf8)), salt: hkdfSalt,
                               info: Data("wrap \(purpose)".utf8), outputByteCount: 32)
    }

    /// The data key sealed with `kek`. The box names the data key's id, so a stale wrap shows.
    static func wrap(_ dataKey: SymmetricKey, with kek: SymmetricKey, purpose: String, user: UUID, nonce: AES.GCM.Nonce? = nil) throws -> String {
        try NoteCrypto.seal(bytes(dataKey).base64EncodedString(), key: kek, keyID: keyID(of: dataKey), context: wrap(purpose, user: user), nonce: nonce)
    }

    static func unwrap(_ wrapped: String, with kek: SymmetricKey, purpose: String, user: UUID) throws -> SymmetricKey {
        guard let text = try? NoteCrypto.open(wrapped, key: kek, context: wrap(purpose, user: user)) else { throw Failure.wrongKey }
        guard let raw = Data(base64Encoded: text), raw.count == 32, keyID(of: raw) == NoteCrypto.keyID(of: wrapped) else { throw Failure.malformed }
        return SymmetricKey(data: raw)
    }

    // MARK: The recovery key
    //
    // 128 random bits, written as 28 characters of Crockford base32 (0-9 and A-Z without I, L, O,
    // U) in seven groups of four: the 128 bits, then the first 12 bits of SHA-256 of them as a
    // check, so a typo shows before anything is unwrapped. Reading it back is forgiving: case,
    // spaces and dashes don't matter, O reads as 0, I and L as 1.

    static let crockford = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    private static func check(_ bytes: Data) -> Int {
        let d = Array(SHA256.hash(data: bytes))
        return Int(d[0]) << 4 | Int(d[1]) >> 4
    }

    private static func number(_ bits: ArraySlice<Bool>) -> Int { bits.reduce(0) { $0 << 1 | ($1 ? 1 : 0) } }

    static func recoveryKeyText(_ bytes: Data) -> String {
        precondition(bytes.count == 16, "a recovery key is 16 bytes")
        let c = check(bytes)
        var bits: [Bool] = []
        for b in bytes { for i in (0 ..< 8).reversed() { bits.append((b >> i) & 1 == 1) } }
        for i in (0 ..< 12).reversed() { bits.append((c >> i) & 1 == 1) }
        let chars = stride(from: 0, to: 140, by: 5).map { crockford[number(bits[$0 ..< $0 + 5])] }
        return stride(from: 0, to: 28, by: 4).map { String(chars[$0 ..< $0 + 4]) }.joined(separator: "-")
    }

    /// The canonical form of a typed recovery key: its 28 characters, or nil when it can't be one.
    static func canonicalRecoveryKey(_ typed: String) -> String? {
        let separators: Set<Character> = ["-", "_", ".", "\u{2010}", "\u{2011}", "\u{2012}", "\u{2013}", "\u{2014}", "\u{2015}"]
        let s = String(typed.uppercased().filter { !$0.isWhitespace && !separators.contains($0) }.map { c -> Character in
            switch c {
            case "O": "0"
            case "I", "L": "1"
            default: c
            }
        })
        return s.count == 28 && s.allSatisfy(crockford.contains) ? s : nil
    }

    /// The 16 key bytes a typed recovery key stands for, or nil (wrong length, letter or check).
    static func parseRecoveryKey(_ typed: String) -> Data? {
        guard let s = canonicalRecoveryKey(typed) else { return nil }
        var bits: [Bool] = []
        for ch in s {
            let v = crockford.firstIndex(of: ch) ?? 0
            for i in (0 ..< 5).reversed() { bits.append((v >> i) & 1 == 1) }
        }
        let bytes = Data(stride(from: 0, to: 128, by: 8).map { UInt8(number(bits[$0 ..< $0 + 8])) })
        return check(bytes) == number(bits[128 ..< 140]) ? bytes : nil
    }

    /// The key the recovery wrap is sealed with: HKDF-SHA256 of the 16 recovery key bytes.
    static func recoveryKEK(_ bytes: Data, user: UUID) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: bytes), salt: hkdfSalt,
                               info: Data("recovery \(user.uuidString.lowercased())".utf8), outputByteCount: 32)
    }

    // MARK: Handing a code to a browser
    //
    // A browser elsewhere asked this account's devices to approve an AI connection. The device that
    // approves seals the authorization code to the page's P-256 key, so only that page can open it:
    // "amb2h." + base64(device ephemeral public key, raw uncompressed 65 bytes ‖ nonce 12 ‖
    // AES-GCM ciphertext ‖ tag 16). Key: HKDF-SHA256 of the ECDH secret, salt "amber-notes/e2ee",
    // info "handoff <request id>"; AAD "amb2h|<request id>" (supabase/functions/_shared/e2ee.ts).

    static let handoffPrefix = "amb2h."

    private static func handoffKey(_ secret: SharedSecret, request: UUID) -> SymmetricKey {
        secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: hkdfSalt,
                                       sharedInfo: Data("handoff \(request.uuidString.lowercased())".utf8), outputByteCount: 32)
    }

    private static func handoffAAD(_ request: UUID) -> Data { Data("amb2h|\(request.uuidString.lowercased())".utf8) }

    /// `code` sealed to the page's public key (raw uncompressed, 65 bytes). `ephemeral` and `nonce`
    /// are for the test vector only.
    static func sealHandoff(code: String, browserKey: Data, requestID: UUID,
                            ephemeral: P256.KeyAgreement.PrivateKey = .init(), nonce: AES.GCM.Nonce = .init()) throws -> String {
        guard browserKey.count == 65, browserKey.first == 4,
              let page = try? P256.KeyAgreement.PublicKey(x963Representation: browserKey) else { throw Failure.malformed }
        let key = handoffKey(try ephemeral.sharedSecretFromKeyAgreement(with: page), request: requestID)
        let box = try AES.GCM.seal(Data(code.utf8), using: key, nonce: nonce, authenticating: handoffAAD(requestID))
        guard let combined = box.combined else { throw Failure.malformed }
        return handoffPrefix + (ephemeral.publicKey.x963Representation + combined).base64EncodedString()
    }

    /// What the page does with a handoff; here for tests.
    static func openHandoff(_ sealed: String, browserPrivate: P256.KeyAgreement.PrivateKey, requestID: UUID) throws -> String {
        guard sealed.hasPrefix(handoffPrefix), let bytes = Data(base64Encoded: String(sealed.dropFirst(handoffPrefix.count))),
              bytes.count >= 65 + 12 + 16,
              let device = try? P256.KeyAgreement.PublicKey(x963Representation: bytes.prefix(65)),
              let box = try? AES.GCM.SealedBox(combined: bytes.dropFirst(65)) else { throw Failure.malformed }
        let key = handoffKey(try browserPrivate.sharedSecretFromKeyAgreement(with: device), request: requestID)
        guard let plain = try? AES.GCM.open(box, using: key, authenticating: handoffAAD(requestID)) else { throw Failure.wrongKey }
        return String(decoding: plain, as: UTF8.self)
    }

    /// The sealer sync uses while the account's data key is open. Nil: signed out, local only, or
    /// this device doesn't have the key yet. Set only by `AccountCrypto`.
    nonisolated(unsafe) static var sealer: Sealer?
}

/// What a note shows in lists, sealed next to its body. A locked note's head is its title only.
struct NoteHead: Codable, Equatable, Sendable {
    var title: String
    var preview: String?

    init(title: String, preview: String? = nil) {
        self.title = title
        self.preview = preview
    }

    static func of(_ body: String) -> NoteHead {
        let lines = NoteText.firstLines(of: body, count: 2)
        return NoteHead(title: lines.first ?? "New Note", preview: lines.count > 1 ? lines[1] : nil)
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? "New Note"
        preview = try? c.decodeIfPresent(String.self, forKey: .preview)
    }

    /// The JSON that's sealed, keys in the server's order (`{"title":…,"preview":…}`), and no
    /// preview key when there's none (a locked note's head).
    var json: String {
        func quoted(_ s: String) -> String { (try? String(decoding: JSONEncoder.sorted.encode(s), as: UTF8.self)) ?? "\"\"" }
        guard let preview, !preview.isEmpty else { return "{\"title\":\(quoted(title))}" }
        return "{\"title\":\(quoted(title)),\"preview\":\(quoted(preview))}"
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

    func seal(_ plain: String, context: String) -> String? {
        let hash = SHA256.hash(data: Data(plain.utf8))
        if let s = lock.withLock({ sealed[context] }), s.hash == hash { return s.box }
        guard let box = try? NoteCrypto.seal(plain, key: key, keyID: keyID, context: context) else { return nil }
        lock.withLock { sealed[context] = (hash, box) }
        return box
    }

    func open(_ box: String, context: String) -> String? {
        guard let plain = try? NoteCrypto.open(box, key: key, context: context) else { return nil }
        lock.withLock { sealed[context] = (SHA256.hash(data: Data(plain.utf8)), box) }
        return plain
    }

    func sealHead(_ head: NoteHead, note: UUID) -> String? { seal(head.json, context: E2EE.head(note)) }

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

// MARK: The key, as the Keychain and the server hold it

/// What the Keychain holds for an account: the data key and the recovery key together, so any
/// device with the one can show the other. Stored as version (1) ‖ DK (32) ‖ recovery key (16).
struct StoredKey: Equatable, Sendable {
    static let version: UInt8 = 1
    let dataKey: Data
    let recovery: Data

    init?(dataKey: Data, recovery: Data) {
        guard dataKey.count == 32, recovery.count == 16 else { return nil }
        self.dataKey = dataKey
        self.recovery = recovery
    }

    init?(encoded: Data) {
        let b = Array(encoded)
        guard b.count == 49, b[0] == Self.version else { return nil }
        self.init(dataKey: Data(b[1 ..< 33]), recovery: Data(b[33 ..< 49]))
    }

    static func generate() -> StoredKey {
        StoredKey(dataKey: E2EE.bytes(E2EE.newDataKey()), recovery: E2EE.randomBytes(16))!
    }

    var encoded: Data { Data([Self.version]) + dataKey + recovery }
    var key: SymmetricKey { SymmetricKey(data: dataKey) }
    var keyID: String { E2EE.keyID(of: dataKey) }
    var recoveryText: String { E2EE.recoveryKeyText(recovery) }

    /// The row the server keeps for this key: nothing that opens it.
    func serverRow(user: UUID) throws -> ServerKey {
        ServerKey(key_id: keyID, verifier: E2EE.verifier(of: key, user: user),
                  recovery_wrap: try E2EE.wrap(key, with: E2EE.recoveryKEK(recovery, user: user), purpose: "recovery", user: user))
    }

    /// Whether this is the account's key, by the server's id and verifier.
    func matches(_ server: ServerKey, user: UUID) -> Bool {
        keyID == server.key_id && E2EE.verifier(of: key, user: user) == server.verifier
    }
}

/// `account_keys`: the key's id, its verifier and DK wrapped under the recovery key.
struct ServerKey: Codable, Equatable, Sendable {
    var key_id: String
    var verifier: String
    var recovery_wrap: String
    /// When the recovery key was last printed, exported or copied, on any device.
    var recovery_saved_at: Date?
}

/// The account's key on the server. Every call throws when the server can't be reached.
protocol AccountKeyServer: Sendable {
    /// The account's key, or nil when it has none yet.
    func fetch() async throws -> ServerKey?
    /// `create_account_key`: insert-if-absent. The account's key, whoever made it, and whether
    /// this call did.
    func create(_ key: ServerKey) async throws -> (key: ServerKey, created: Bool)
    func markRecoveryKeySaved() async throws -> Date?
    /// `start_fresh`: deletes the account's notes and key, if `keyID` is still its key.
    func startFresh(keyID: String) async throws -> Bool
}

enum KeySlot: String, Sendable, CaseIterable {
    /// The account's key, synced by iCloud Keychain.
    case synced
    /// A key being made, on this device only until the server has taken it (see `AccountCrypto`).
    case pending
}

protocol AccountKeyStore: Sendable {
    /// Whether a key saved here reaches the account's other devices.
    var syncs: Bool { get }
    func load(account: UUID, slot: KeySlot) -> StoredKey?
    @discardableResult func save(_ key: StoredKey, account: UUID, slot: KeySlot) -> Bool
    func remove(account: UUID, slot: KeySlot)
}

/// In-memory runs (UI tests, captures).
final class MemoryAccountKeyStore: AccountKeyStore, @unchecked Sendable {
    let syncs: Bool
    private var keys: [String: StoredKey] = [:]
    private let lock = NSLock()
    init(syncs: Bool = true) { self.syncs = syncs }
    private func id(_ account: UUID, _ slot: KeySlot) -> String { "\(account)/\(slot.rawValue)" }
    func load(account: UUID, slot: KeySlot) -> StoredKey? { lock.withLock { keys[id(account, slot)] } }
    func save(_ key: StoredKey, account: UUID, slot: KeySlot) -> Bool { lock.withLock { keys[id(account, slot)] = key }; return true }
    func remove(account: UUID, slot: KeySlot) { lock.withLock { _ = keys.removeValue(forKey: id(account, slot)) } }
}

/// The key in the Keychain. The account's key is a synchronizable item (iCloud Keychain, end-to-end
/// encrypted by Apple), readable after the first unlock so sync works in the background. A key being
/// made stays on this device (ThisDeviceOnly) until the server has taken it.
///
/// No `kSecAttrAccessGroup` in any query, on purpose: items go to the default group, the first of
/// the app's `keychain-access-groups` (`$(AppIdentifierPrefix)dev.emilwagman.pane`, the same on the
/// iPhone and the Mac), and reads search every group the app has.
///
/// Builds without the data protection keychain (ad-hoc and Developer ID Macs, which have no
/// provisioning profile: `errSecMissingEntitlement`) keep the key on this device only, where the
/// session is kept (`SessionStorage`); such a device gets the key from the recovery key.
struct KeychainAccountKeyStore: AccountKeyStore {
    static let service = "dev.emilwagman.pane.data-key"

    static let dataProtectionAvailable: Bool = {
        var q = query(UUID(), slot: .synced)
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        return SecItemCopyMatching(q as CFDictionary, nil) != errSecMissingEntitlement
    }()

    var syncs: Bool { Self.dataProtectionAvailable }

    private static func query(_ account: UUID, slot: KeySlot) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: slot == .synced ? service : service + ".pending",
         kSecAttrAccount as String: account.uuidString.lowercased(),
         kSecUseDataProtectionKeychain as String: true,
         kSecAttrSynchronizable as String: kSecAttrSynchronizableAny]
    }

    private static let fallback = SessionStorage()
    private static func fallbackName(_ account: UUID, _ slot: KeySlot) -> String { "data-key-\(slot.rawValue)-\(account.uuidString.lowercased())" }

    func load(account: UUID, slot: KeySlot) -> StoredKey? {
        guard Self.dataProtectionAvailable else {
            guard let data = try? Self.fallback.retrieve(key: Self.fallbackName(account, slot)) else { return nil }
            return StoredKey(encoded: data)
        }
        var q = Self.query(account, slot: slot)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return StoredKey(encoded: data)
    }

    func save(_ key: StoredKey, account: UUID, slot: KeySlot) -> Bool {
        guard Self.dataProtectionAvailable else {
            return (try? Self.fallback.store(key: Self.fallbackName(account, slot), value: key.encoded)) != nil
        }
        remove(account: account, slot: slot)
        var q = Self.query(account, slot: slot)
        q[kSecAttrSynchronizable as String] = slot == .synced
        q[kSecAttrAccessible as String] = slot == .synced ? kSecAttrAccessibleAfterFirstUnlock : kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        q[kSecAttrLabel as String] = "Amber Notes encryption key"
        q[kSecValueData as String] = key.encoded
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func remove(account: UUID, slot: KeySlot) {
        if Self.dataProtectionAvailable {
            SecItemDelete(Self.query(account, slot: slot) as CFDictionary)
        } else {
            try? Self.fallback.remove(key: Self.fallbackName(account, slot))
        }
    }
}

// MARK: Startup: getting this device the account's key

/// The decision at startup, from what the Keychain and the server hold. Pure; `AccountCrypto`
/// carries it out.
enum KeyStartup {
    enum Server: Equatable, Sendable { case unreachable, none, key(ServerKey) }

    enum Decision: Equatable {
        /// Use this key. `verified`: the server confirmed it (not when offline). `promote`: it's the
        /// pending key the server took, so it becomes the synced one.
        case ready(StoredKey, verified: Bool, promote: Bool)
        /// The account has no key: make one. The only way a key is ever made.
        case create
        /// The server has a key this device doesn't: wait for iCloud Keychain, or the recovery key.
        case wait
        /// The Keychain has a key that isn't the account's: never use it.
        case mismatch
        /// Offline with no key here.
        case unreachable
    }

    static func decide(user: UUID, synced: StoredKey?, pending: StoredKey?, server: Server) -> Decision {
        switch server {
        case .unreachable:
            // Offline with the key here: carry on (sync waits for the network anyway); the key
            // is checked once the server answers.
            return synced.map { .ready($0, verified: false, promote: false) } ?? .unreachable
        case .none:
            return .create
        case .key(let s):
            if let synced, synced.matches(s, user: user) { return .ready(synced, verified: true, promote: false) }
            // A key this device made without hearing back that the server took it.
            if let pending, pending.matches(s, user: user) { return .ready(pending, verified: true, promote: true) }
            return synced == nil ? .wait : .mismatch
        }
    }
}

enum KeyError: LocalizedError, Equatable {
    case typo, wrongKey, offline, notReady, confirmation

    var errorDescription: String? {
        switch self {
        case .typo: "That recovery key has a typo. Check it and try again."
        case .wrongKey: "That recovery key isn't the one for this account. Check it and try again."
        case .offline: "You're offline. Connect to the internet and try again."
        case .notReady: "Your notes aren't open on this device yet."
        case .confirmation: "Type \u{201C}\(AccountCrypto.startFreshPhrase)\u{201D} to confirm."
        }
    }
}

// MARK: The account's key on this device

/// Whether this account's notes can be opened here, and what gets it there. Sync runs only once
/// this is `.ready`; `E2EE.sealer` is set then, and only then.
@MainActor
@Observable
final class AccountCrypto {
    enum Phase: Equatable {
        /// Signed out, or sync is off.
        case off
        case checking
        /// The account has a key this device doesn't: polling the Keychain for iCloud to bring it.
        case waiting
        /// The Keychain has a key that isn't the account's: the recovery key is needed. Polling goes on.
        case mismatch
        /// Offline with no key here: retrying.
        case unreachable
        case ready
    }

    static var shared = AccountCrypto(store: MemoryAccountKeyStore())
    nonisolated static let startFreshPhrase = "start fresh"

    private(set) var phase: Phase = .off
    private(set) var account: UUID?
    /// The account's row on the server, as last seen.
    private(set) var serverKey: ServerKey?
    /// Ready with a key the server hasn't confirmed yet (it was offline at startup).
    private(set) var unverified = false
    /// Waiting long enough (or on a device whose Keychain doesn't sync) that the help shows.
    private(set) var showsKeychainHelp = false
    private(set) var polls = 0
    /// "Your notes are encrypted": once per account on each device, when the key is first here.
    private(set) var needsWelcome = false
    private var key: StoredKey?
    private var server: AccountKeyServer?
    let store: AccountKeyStore
    private let defaults: UserDefaults
    private let pollInterval: Duration
    private let retryInterval: Duration
    private let helpAfterPolls: Int
    private let sleep: @Sendable (Duration) async throws -> Void
    /// Bumped whenever what's being worked out changes, so an older answer is ignored.
    private var generation = 0
    private var background: Task<Void, Never>?

    /// Set by the sync side: removes the account's files from Storage when it starts fresh (the
    /// rows go with `start_fresh`; Storage objects can't be deleted from SQL).
    var removeAccountFiles: (@MainActor (UUID) async -> Void)?

    init(store: AccountKeyStore, defaults: UserDefaults = .standard, pollInterval: Duration = .seconds(2),
         helpAfter: Duration = .seconds(20), retryInterval: Duration = .seconds(10),
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.store = store
        self.defaults = defaults
        self.pollInterval = pollInterval
        self.retryInterval = retryInterval
        helpAfterPolls = max(1, Int((helpAfter / pollInterval).rounded()))
        self.sleep = sleep
    }

    var isReady: Bool { phase == .ready }
    /// Sync runs with the key open, or with no account at all.
    var allowsSync: Bool { phase == .ready || phase == .off }
    var dataKey: SymmetricKey? { isReady ? key?.key : nil }
    var keyID: String? { isReady ? key?.keyID : nil }
    /// The recovery key, for Settings › Privacy & Security (behind Face ID or Touch ID there).
    var recoveryKeyText: String? { isReady ? key?.recoveryText : nil }
    var recoverySavedAt: Date? { serverKey?.recovery_saved_at }

    // MARK: Startup

    /// Signed in (or out): gets this device the account's key, or says what's missing.
    func attach(account: UUID?, server: AccountKeyServer?) async {
        if account != self.account { stop(); drop(); serverKey = nil; phase = .off }
        self.account = account
        self.server = server
        guard account != nil, server != nil else { stop(); drop(); phase = .off; return }
        if phase == .ready { await recheck(); return }
        await restart()
    }

    /// Runs startup again (Try again, or after the account's key changed).
    func restart() async {
        stop()
        drop()
        phase = .checking
        await run()
    }

    private func run() async {
        guard let account, let server else { phase = .off; return }
        let gen = generation
        let remote: KeyStartup.Server
        do { remote = try await server.fetch().map { .key($0) } ?? .none } catch { remote = .unreachable }
        guard gen == generation else { return }
        if case .key(let s) = remote { serverKey = s }
        await carryOut(KeyStartup.decide(user: account, synced: store.load(account: account, slot: .synced),
                                         pending: store.load(account: account, slot: .pending), server: remote))
    }

    private func carryOut(_ decision: KeyStartup.Decision) async {
        guard let account else { return }
        switch decision {
        case .ready(let k, let verified, let promote):
            if promote { store.save(k, account: account, slot: .synced) }
            if verified { store.remove(account: account, slot: .pending) }
            open(k, verified: verified)
        case .create:
            await create()
        case .wait:
            phase = .waiting
            startPolling()
        case .mismatch:
            phase = .mismatch
            startPolling()
        case .unreachable:
            phase = .unreachable
            startRetrying()
        }
    }

    /// The account's first launch. The new key stays on this device only until the server has
    /// taken it: a device that loses the race never overwrites the synced key, and one that goes
    /// offline or quits mid-way still has the key if the server took it after all.
    private func create() async {
        guard let account, let server else { return }
        let gen = generation
        let k = StoredKey.generate()
        guard let row = try? k.serverRow(user: account) else { phase = .unreachable; return }
        store.save(k, account: account, slot: .pending)
        do {
            let (winner, created) = try await server.create(row)
            guard gen == generation else { return }
            serverKey = winner
            if created, k.matches(winner, user: account) {
                store.save(k, account: account, slot: .synced)
                store.remove(account: account, slot: .pending)
                open(k, verified: true)
            } else {
                // Another device made the account's key first: that one it is.
                store.remove(account: account, slot: .pending)
                await carryOut(KeyStartup.decide(user: account, synced: store.load(account: account, slot: .synced),
                                                 pending: nil, server: .key(winner)))
            }
        } catch {
            guard gen == generation else { return }
            phase = .unreachable
            startRetrying()
        }
    }

    /// One look in the Keychain while waiting. True when the account's key has arrived.
    @discardableResult func pollKeychain() -> Bool {
        guard let account, let serverKey, phase == .waiting || phase == .mismatch else { return false }
        polls += 1
        if polls >= helpAfterPolls { showsKeychainHelp = true }
        guard let k = store.load(account: account, slot: .synced) else { return false }
        if k.matches(serverKey, user: account) {
            store.remove(account: account, slot: .pending)
            open(k, verified: true)
            return true
        }
        phase = .mismatch
        return false
    }

    /// The server's key again, while running. An account's key never changes, so a different one
    /// (another device started fresh) drops this one and startup runs again. Also confirms a key
    /// that was used offline.
    func recheck() async {
        guard let account, let server, phase == .ready, let key else { return }
        let gen = generation
        let fetched: ServerKey?
        do { fetched = try await server.fetch() } catch { return }
        guard gen == generation, phase == .ready else { return }
        if let fetched, key.matches(fetched, user: account) {
            serverKey = fetched
            if unverified {
                unverified = false
                store.remove(account: account, slot: .pending)
                stop()
            }
            return
        }
        await restart()
    }

    // MARK: The recovery key and starting fresh

    func recover(typed: String) async throws {
        guard let account, let server else { throw KeyError.notReady }
        guard let bytes = E2EE.parseRecoveryKey(typed) else { throw KeyError.typo }
        let gen = generation
        var current = serverKey
        if let fetched = try? await server.fetch() { current = fetched }
        guard gen == generation else { throw KeyError.notReady }
        guard let current else { throw KeyError.offline }
        serverKey = current
        guard let dk = try? E2EE.unwrap(current.recovery_wrap, with: E2EE.recoveryKEK(bytes, user: account), purpose: "recovery", user: account),
              let k = StoredKey(dataKey: E2EE.bytes(dk), recovery: bytes), k.matches(current, user: account) else { throw KeyError.wrongKey }
        store.save(k, account: account, slot: .synced)
        store.remove(account: account, slot: .pending)
        open(k, verified: true)
    }

    /// The last resort: the notes on the server can't be opened by anyone, so they're deleted,
    /// and this device makes the account's new key.
    func startFresh(confirmation: String) async throws {
        guard confirmation.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == Self.startFreshPhrase else { throw KeyError.confirmation }
        guard let account, let server else { throw KeyError.notReady }
        let current: ServerKey?
        do { current = try await server.fetch() } catch { throw KeyError.offline }
        if let current {
            let deleted: Bool
            do { deleted = try await server.startFresh(keyID: current.key_id) } catch { throw KeyError.offline }
            if deleted { await removeAccountFiles?(account) }
        }
        serverKey = nil
        await restart()
    }

    func markRecoveryKeySaved() async throws {
        guard let server else { throw KeyError.notReady }
        let at: Date?
        do { at = try await server.markRecoveryKeySaved() } catch { throw KeyError.offline }
        serverKey?.recovery_saved_at = at ?? .now
    }

    // MARK: First launch

    private func welcomedKey(_ account: UUID) -> String { "e2ee.welcomed.\(account.uuidString.lowercased())" }

    func welcomeShown() {
        if let account { defaults.set(true, forKey: welcomedKey(account)) }
        needsWelcome = false
    }

    // MARK: Leaving

    /// Signing out keeps the key in the Keychain for next time.
    func signedOut() {
        stop()
        drop()
        account = nil
        server = nil
        serverKey = nil
        phase = .off
    }

    /// The account is deleted: its key goes from the Keychain, and so from iCloud Keychain.
    func forgetKey(account: UUID) {
        for slot in KeySlot.allCases { store.remove(account: account, slot: slot) }
        defaults.removeObject(forKey: welcomedKey(account))
        if account == self.account { signedOut() }
    }

    // MARK: AI connections

    /// An authorization code made here, with the data key wrapped under it for /connect/decide.
    func connectionCode() throws -> (code: String, hash: String, wrap: String) {
        guard let account, let dataKey else { throw KeyError.notReady }
        let code = "amb_code_" + E2EE.randomHex()
        return (code, E2EE.sha256Hex(code), try E2EE.wrap(dataKey, with: E2EE.tokenKey(code, purpose: "code"), purpose: "code", user: account))
    }

    /// A `pane_` access token made here, with its hash and the data key wrapped under it.
    func accessToken() throws -> (token: String, hash: String, wrap: String) {
        guard let account, let dataKey else { throw KeyError.notReady }
        let token = "pane_" + E2EE.randomHex()
        return (token, E2EE.sha256Hex(token), try E2EE.wrap(dataKey, with: E2EE.tokenKey(token, purpose: "pane"), purpose: "pane", user: account))
    }

    /// Tests: the key is here.
    func adoptForTesting(_ key: StoredKey, account: UUID, serverKey: ServerKey? = nil) {
        self.account = account
        self.serverKey = serverKey
        open(key, verified: true)
    }

    // MARK: Pieces

    private func open(_ k: StoredKey, verified: Bool) {
        guard let account else { return }
        stop()
        key = k
        unverified = !verified
        showsKeychainHelp = false
        E2EE.sealer = Sealer(key: k.key, user: account)
        needsWelcome = !defaults.bool(forKey: welcomedKey(account))
        phase = .ready
        if !verified { startRetrying() }
    }

    private func drop() {
        generation += 1
        key = nil
        unverified = false
        polls = 0
        showsKeychainHelp = false
        needsWelcome = false
        E2EE.sealer = nil
    }

    private func stop() {
        background?.cancel()
        background = nil
    }

    /// Tests: waits for the polling or retrying in the background to end.
    func waitForBackground() async { await background?.value }

    private func startPolling() {
        stop()
        polls = 0
        showsKeychainHelp = !store.syncs
        let gen = generation, interval = pollInterval, sleep = sleep
        background = Task { [weak self] in
            while true {
                do { try await sleep(interval) } catch { return }
                guard let self, gen == self.generation, self.phase == .waiting || self.phase == .mismatch else { return }
                if self.pollKeychain() { return }
            }
        }
    }

    /// Offline: startup again every little while, or (ready with a key the server hasn't
    /// confirmed) the check.
    private func startRetrying() {
        stop()
        let gen = generation, interval = retryInterval, sleep = sleep
        background = Task { [weak self] in
            while true {
                do { try await sleep(interval) } catch { return }
                guard let self, gen == self.generation else { return }
                // In a task of its own: whatever comes next replaces (and cancels) this loop,
                // and the request mustn't be cancelled with it.
                switch self.phase {
                case .unreachable:
                    self.phase = .checking
                    await Task { await self.run() }.value
                    return
                case .ready where self.unverified:
                    await Task { await self.recheck() }.value
                    if !self.unverified || gen != self.generation { return }
                default:
                    return
                }
            }
        }
    }
}
