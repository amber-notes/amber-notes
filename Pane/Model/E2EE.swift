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
    /// A note's page (prototype, NotePage).
    static func page(_ id: UUID) -> String { "page:" + id.uuidString.lowercased() }
    /// A page's own data (prototype, NotePageData).
    static func pageData(_ id: UUID) -> String { "page-data:" + id.uuidString.lowercased() }
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

    // MARK: Share tags: which notes the account's devices chose to share
    //
    // A shared page is readable, so a device publishes a note only for a share the account made
    // itself. The share's tag, written when it's made, is an HMAC under a subkey of DK: a share row
    // planted or changed by anyone without the key doesn't verify, and nothing is published.

    private static func shareKey(_ key: SymmetricKey) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: key, salt: hkdfSalt, info: Data("share".utf8), outputByteCount: 32)
    }

    /// hex(HMAC-SHA256(HKDF(DK, info "share"), "share|<note id>|<slug>|<1 or 0>")).
    static func shareTag(_ key: SymmetricKey, note: UUID, slug: String, includeSubNotes: Bool) -> String {
        let msg = "share|\(note.uuidString.lowercased())|\(slug)|\(includeSubNotes ? 1 : 0)"
        return hex(HMAC<SHA256>.authenticationCode(for: Data(msg.utf8), using: shareKey(key)))
    }

    /// Whether `tag` is the one this key makes for the share. Compared in constant time.
    static func shareTagMatches(_ key: SymmetricKey, note: UUID, slug: String, includeSubNotes: Bool, tag: String?) -> Bool {
        guard let tag, tag.utf8.count == 64 else { return false }
        let mine = Array(shareTag(key, note: note, slug: slug, includeSubNotes: includeSubNotes).utf8)
        var diff: UInt8 = 0
        for (a, b) in zip(mine, Array(tag.utf8)) { diff |= a ^ b }
        return diff == 0
    }

    // MARK: Number matching: the page and the device show the same two digits

    // Commit, then reveal (matchCommit/matchNumber in supabase/functions/_shared/e2ee.ts). The page
    // commits to its key and a nonce Np (16 bytes) when it asks; the device then writes its own
    // nonce Nd; only after that does the page reveal Np. Whoever swaps the page's key on the way
    // had to commit to Np before seeing Nd, so they can't grind a key or nonce that lands on the
    // same two digits: they get one guess in a hundred.

    /// hex SHA-256(browser key raw ‖ Np).
    static func matchCommit(browserKey: Data, pageNonce: Data) -> String {
        hex(SHA256.hash(data: browserKey + pageNonce))
    }

    /// Whether the page's revealed nonce opens its commit for this key. Constant time.
    static func commitOpens(_ commit: String, browserKey: Data, pageNonce: Data) -> Bool {
        let mine = Array(matchCommit(browserKey: browserKey, pageNonce: pageNonce).utf8), theirs = Array(commit.lowercased().utf8)
        guard mine.count == theirs.count else { return false }
        var diff: UInt8 = 0
        for (a, b) in zip(mine, theirs) { diff |= a ^ b }
        return diff == 0
    }

    /// The two digits both screens show: SHA-256(browser key raw ‖ Np ‖ Nd ‖ request id,
    /// lowercase), the first four bytes as a big-endian number, mod 100.
    static func matchNumber(browserKey: Data, pageNonce: Data, deviceNonce: Data, requestID: UUID) -> String {
        let d = Array(SHA256.hash(data: browserKey + pageNonce + deviceNonce + Data(requestID.uuidString.lowercased().utf8)))
        let n = UInt32(d[0]) << 24 | UInt32(d[1]) << 16 | UInt32(d[2]) << 8 | UInt32(d[3])
        return String(format: "%02d", n % 100)
    }

    /// Lowercase hex to bytes; nil for anything else.
    static func fromHex(_ s: String) -> Data? {
        let chars = Array(s.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        func nibble(_ c: UInt8) -> UInt8? {
            switch c {
            case UInt8(ascii: "0") ... UInt8(ascii: "9"): c - UInt8(ascii: "0")
            case UInt8(ascii: "a") ... UInt8(ascii: "f"): c - UInt8(ascii: "a") + 10
            default: nil
            }
        }
        var i = 0
        while i < chars.count {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }

    /// What a device hands the page: the code and the redirect it goes to, sealed together so
    /// nobody on the way can send the page elsewhere. `{"code":…,"redirect":…}`, as the server's
    /// `handoffPayload` writes it.
    static func handoffPayload(code: String, redirect: String) -> String {
        struct Payload: Encodable { var code: String; var redirect: String }
        return String(decoding: (try? JSONEncoder.sorted.encode(Payload(code: code, redirect: redirect))) ?? Data(), as: UTF8.self)
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
    static func canonicalRecoveryKey(_ typed: String) -> String? { canonicalCrockford(typed, count: 28) }

    /// Typed Crockford base32, read forgivingly: case, spaces and dashes don't matter, O reads as
    /// 0, I and L as 1. Nil unless it comes to exactly `count` characters of the alphabet.
    static func canonicalCrockford(_ typed: String, count: Int) -> String? {
        let separators: Set<Character> = ["-", "_", ".", "\u{2010}", "\u{2011}", "\u{2012}", "\u{2013}", "\u{2014}", "\u{2015}"]
        let s = String(typed.uppercased().filter { !$0.isWhitespace && !separators.contains($0) }.map { c -> Character in
            switch c {
            case "O": "0"
            case "I", "L": "1"
            default: c
            }
        })
        return s.count == count && s.allSatisfy(crockford.contains) ? s : nil
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
        // The same title and preview the list shows (a table previews by its latest row).
        let head = NoteText.head(of: body)
        return NoteHead(title: head.title, preview: head.preview)
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

    func shareTag(note: UUID, slug: String, includeSubNotes: Bool) -> String {
        E2EE.shareTag(key, note: note, slug: slug, includeSubNotes: includeSubNotes)
    }

    func shareTagMatches(note: UUID, slug: String, includeSubNotes: Bool, tag: String?) -> Bool {
        E2EE.shareTagMatches(key, note: note, slug: slug, includeSubNotes: includeSubNotes, tag: tag)
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
/// device with the one can show the other, and the account's reset generation the key was made in
/// (`account_key_resets`): a key from an older generation belongs to notes someone chose to delete.
/// Stored as version (2) ‖ DK (32) ‖ recovery key (16) ‖ generation (4, big-endian).
struct StoredKey: Equatable, Sendable {
    static let version: UInt8 = 2
    let dataKey: Data
    let recovery: Data
    let generation: Int

    init?(dataKey: Data, recovery: Data, generation: Int = 0) {
        guard dataKey.count == 32, recovery.count == 16, generation >= 0, generation <= Int(UInt32.max) else { return nil }
        self.dataKey = dataKey
        self.recovery = recovery
        self.generation = generation
    }

    init?(encoded: Data) {
        let b = Array(encoded)
        guard b.count == 53, b[0] == Self.version else { return nil }
        let generation = Int(UInt32(b[49]) << 24 | UInt32(b[50]) << 16 | UInt32(b[51]) << 8 | UInt32(b[52]))
        self.init(dataKey: Data(b[1 ..< 33]), recovery: Data(b[33 ..< 49]), generation: generation)
    }

    static func generate(generation: Int = 0) -> StoredKey {
        StoredKey(dataKey: E2EE.bytes(E2EE.newDataKey()), recovery: E2EE.randomBytes(16), generation: generation)!
    }

    var encoded: Data {
        let g = UInt32(generation)
        return Data([Self.version]) + dataKey + recovery + Data([UInt8(g >> 24), UInt8(g >> 16 & 0xff), UInt8(g >> 8 & 0xff), UInt8(g & 0xff)])
    }
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

/// How a device came to hold the key, as the list in Settings › Security says it.
enum KeyHow: String, Codable, Sendable {
    /// Made on it (the account's first device).
    case made
    /// Brought by iCloud Keychain.
    case keychain
    /// Handed over by another device (Add a device).
    case added
    /// Opened with the recovery key.
    case recovery
    /// It already had the key when it first listed itself: where from isn't known.
    case unknown
}

/// The account's key row (nil when it has none) and its reset generation (`account_key_resets`,
/// 0 when it never started fresh).
struct ServerKeyState: Equatable, Sendable {
    var key: ServerKey?
    var generation: Int = 0
}

/// The account's key on the server. Every call throws when the server can't be reached.
protocol AccountKeyServer: Sendable {
    /// The account's key (nil when it has none) and its reset generation.
    func fetch() async throws -> ServerKeyState
    /// `create_account_key`: insert-if-absent. The account's key, whoever made it, and whether
    /// this call did. `generation` is the reset generation read with the missing key (`fetch`):
    /// the server refuses one older than its own (another device started fresh since) with
    /// `KeyError.staleGeneration`.
    func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool)
    func markRecoveryKeySaved() async throws -> Date?
    /// `start_fresh`: deletes the account's notes and key, if `keyID` is still its key. Throws
    /// `KeyError.reauth` when the server wants a recent sign-in first.
    func startFresh(keyID: String) async throws -> Bool
}

enum KeySlot: String, Sendable, CaseIterable {
    /// The account's key, synced by iCloud Keychain.
    case synced
    /// A key being made, on this device only until the server has taken it (see `AccountCrypto`).
    case pending
    /// The key from before the account started fresh, kept on this device only: never used for
    /// sync, never deleted by the app except with the account.
    case previous
    /// The account's key as another device handed it over (Add a device), on this device only:
    /// it never joins iCloud Keychain, so removing this device removes exactly this copy.
    case local
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
/// made stays on this device (ThisDeviceOnly) until the server has taken it, and so does the key
/// from before starting fresh.
///
/// No `kSecAttrAccessGroup` in any query, on purpose: items go to the default group, the first of
/// the app's `keychain-access-groups` (`$(AppIdentifierPrefix)dev.emilwagman.pane`, the same on the
/// iPhone and the Mac), and reads search every group the app has.
///
/// Builds without the data protection keychain (ad-hoc and Developer ID Macs, which have no
/// provisioning profile: `errSecMissingEntitlement`) keep the key on this device only, where the
/// session is kept (`SessionStorage`); such a device gets the key from the recovery key.
struct KeychainAccountKeyStore: AccountKeyStore {
    static let service = AppIdentity.keychainPrefix + ".data-key"

    static let dataProtectionAvailable: Bool = {
        var q = query(UUID(), slot: .synced)
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        let read = SecItemCopyMatching(q as CFDictionary, nil)
        guard read != errSecMissingEntitlement else { return false }
        // A read can pass where a write can't: the sandboxed Developer ID beta has no keychain access
        // group (that needs a provisioning profile), so its synced key was never saved and every
        // launch asked for the recovery key again. A throwaway synced item, written and removed, says.
        let probe: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service + ".probe",
                                    kSecAttrAccount as String: "probe",
                                    kSecUseDataProtectionKeychain as String: true,
                                    kSecAttrSynchronizable as String: true]
        SecItemDelete(probe as CFDictionary)
        var add = probe
        add[kSecValueData as String] = Data([0])
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let write = SecItemAdd(add as CFDictionary, nil)
        SecItemDelete(probe as CFDictionary)
        return usable(read: read, write: write)
    }()

    /// Whether the data protection keychain can hold the key, from a read and a write of a synced
    /// item. Only a missing entitlement rules it out: a locked device or a busy keychain is a moment,
    /// not a reason to move the key somewhere else.
    nonisolated static func usable(read: OSStatus, write: OSStatus) -> Bool {
        read != errSecMissingEntitlement && write != errSecMissingEntitlement
    }

    var syncs: Bool { Self.dataProtectionAvailable }

    private static func query(_ account: UUID, slot: KeySlot) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: slot == .synced ? service : service + "." + slot.rawValue,
         kSecAttrAccount as String: account.uuidString.lowercased(),
         kSecUseDataProtectionKeychain as String: true,
         kSecAttrSynchronizable as String: kSecAttrSynchronizableAny]
    }

    private static let fallback = SessionStorage()
    private static func fallbackName(_ account: UUID, _ slot: KeySlot) -> String { "data-key-\(slot.rawValue)-\(account.uuidString.lowercased())" }

    func load(account: UUID, slot: KeySlot) -> StoredKey? {
        guard Self.dataProtectionAvailable else { return fallbackKey(account, slot) }
        var q = Self.query(account, slot: slot)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else {
            // A key the Keychain refused to take was kept in the fallback (see `save`).
            return Self.fallsBack(slot) ? fallbackKey(account, slot) : nil
        }
        return StoredKey(encoded: data)
    }

    private func fallbackKey(_ account: UUID, _ slot: KeySlot) -> StoredKey? {
        guard let data = try? Self.fallback.retrieve(key: Self.fallbackName(account, slot)) else { return nil }
        return StoredKey(encoded: data)
    }

    /// The slots that live on this device only can also live where the session does, when the
    /// Keychain refuses a write. Never the synced one: what's there counts as in iCloud Keychain.
    nonisolated static func fallsBack(_ slot: KeySlot) -> Bool { slot != .synced }

    func save(_ key: StoredKey, account: UUID, slot: KeySlot) -> Bool {
        #if DEBUG || QA
        // `-keyFault`: a write refused on purpose, before anything is touched (KeyFault).
        if KeyFault.active?.refuses(slot) == true { return false }
        #endif
        guard Self.dataProtectionAvailable else {
            return (try? Self.fallback.store(key: Self.fallbackName(account, slot), value: key.encoded)) != nil
        }
        remove(account: account, slot: slot)
        var q = Self.query(account, slot: slot)
        q[kSecAttrSynchronizable as String] = slot == .synced
        q[kSecAttrAccessible as String] = slot == .synced ? kSecAttrAccessibleAfterFirstUnlock : kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        q[kSecAttrLabel as String] = slot == .previous ? "Pinto Notes encryption key (before starting fresh)"
            : slot == .local ? "Pinto Notes encryption key (this device)" : "Pinto Notes encryption key"
        q[kSecValueData as String] = key.encoded
        if SecItemAdd(q as CFDictionary, nil) == errSecSuccess { return true }
        // The Keychain was there when the app started and refused this write all the same. A key
        // that stays on this device anyway is kept where the session is instead; without that, the
        // notes would open now and ask for the recovery key at the next launch.
        guard Self.fallsBack(slot) else { return false }
        return (try? Self.fallback.store(key: Self.fallbackName(account, slot), value: key.encoded)) != nil
    }

    func remove(account: UUID, slot: KeySlot) {
        if Self.dataProtectionAvailable {
            SecItemDelete(Self.query(account, slot: slot) as CFDictionary)
            if Self.fallsBack(slot) { try? Self.fallback.remove(key: Self.fallbackName(account, slot)) }
        } else {
            try? Self.fallback.remove(key: Self.fallbackName(account, slot))
        }
    }
}

// MARK: Startup: getting this device the account's key

/// The decision at startup, from what the Keychain and the server hold. Pure; `AccountCrypto`
/// carries it out.
enum KeyStartup {
    enum Server: Equatable, Sendable {
        case unreachable
        /// The account has no key row. `generation`: how many times it started fresh.
        case none(generation: Int)
        case key(ServerKey)
    }

    enum Decision: Equatable {
        /// Use this key. `verified`: the server confirmed it (not when offline). `promote`: it's the
        /// pending key the server took, so it becomes the synced one.
        case ready(StoredKey, verified: Bool, promote: Bool)
        /// The account has never had a key here: make one, in this generation.
        case create(generation: Int)
        /// The server has no key, but no reset happened since this key was made: the server lost
        /// or dropped the row. Register the same key again; never make a new one.
        case reregister(StoredKey)
        /// The account started fresh since this key was made: keep it aside on this device, make
        /// the new one, and say the recovery key changed.
        case replace(previous: StoredKey, generation: Int)
        /// The server has a key this device doesn't: wait for iCloud Keychain, or the recovery key.
        case wait
        /// The Keychain has a key that isn't the account's: never use it.
        case mismatch
        /// Offline with no key here.
        case unreachable
    }

    /// `local`: the key another device handed this one (Add a device), kept on this device only.
    /// It stands in wherever the synced key is missing or isn't the account's.
    static func decide(user: UUID, synced: StoredKey?, pending: StoredKey?, local: StoredKey? = nil, server: Server) -> Decision {
        // With no server row to check against, the key of the later reset generation is the
        // account's. A tie goes to the handed-over key: it was checked against the server when it
        // came, at a moment the synced item was missing or wrong.
        let held: StoredKey? = switch (synced, local) {
        case (let s?, let l?): s.generation > l.generation ? s : l
        case (let s?, nil): s
        case (nil, let l): l
        }
        switch server {
        case .unreachable:
            // Offline with the key here: carry on (sync waits for the network anyway); the key
            // is checked once the server answers.
            return held.map { .ready($0, verified: false, promote: false) } ?? .unreachable
        case .none(let generation):
            // A key is replaced only after a reset the server counted (start_fresh): a server
            // that merely forgets the row gets the same key back.
            guard let held else { return .create(generation: generation) }
            return held.generation >= generation ? .reregister(held) : .replace(previous: held, generation: generation)
        case .key(let s):
            if let synced, synced.matches(s, user: user) { return .ready(synced, verified: true, promote: false) }
            if let local, local.matches(s, user: user) { return .ready(local, verified: true, promote: false) }
            // A key this device made without hearing back that the server took it.
            if let pending, pending.matches(s, user: user) { return .ready(pending, verified: true, promote: true) }
            return synced == nil ? .wait : .mismatch
        }
    }
}

enum KeyError: LocalizedError, Equatable {
    var isPausedAfterReset: Bool { if case .pausedAfterReset = self { true } else { false } }

    case typo, wrongKey, offline, notReady, confirmation
    /// Starting fresh needs a sign-in in the last few minutes.
    case reauth
    /// A key made for a reset generation the account has moved past: startup runs again.
    case staleGeneration
    /// Signed in again for Start fresh, yet the session doesn't show a recent sign-in.
    case reauthUnconfirmed
    /// A key handed over by another device that isn't the account's: never used.
    case notAccountsKey
    /// This device was itself removed, so it can't remove another.
    case removedHere
    /// The server refuses Start fresh for 72 hours after a password reset (or a sign-in link) was
    /// asked for, until `until` (docs/Technical/password-reset.md).
    case pausedAfterReset(until: Date?)

    var errorDescription: String? {
        switch self {
        case .reauth: "Sign in again to start fresh."
        case .staleGeneration: "Your notes were reset on another device."
        case .reauthUnconfirmed: "Couldn't confirm your sign-in. Sign out and in again, then try Start fresh."
        case .typo: "That recovery key has a typo. Check it and try again."
        case .wrongKey: "That recovery key isn't the one for this account. Check it and try again."
        case .offline: "You're offline. Connect to the internet and try again."
        case .notReady: "Your notes aren't open on this device yet."
        case .confirmation: "Type \u{201C}\(AccountCrypto.startFreshPhrase)\u{201D} to confirm."
        case .removedHere: "This device was removed from another of your devices, so it can\u{2019}t remove one."
        case .notAccountsKey: "What the other device sent isn't this account's key. Show a new code and try again."
        case .pausedAfterReset(let until):
            "Start fresh is paused for 72 hours after a password reset, to protect your notes."
                + (until.map { " Try again on \($0.formatted(date: .long, time: .shortened))." } ?? " Try again in 3 days.")
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
    /// The account started fresh since this device's key was made, so the recovery key it had is
    /// void: said once (`recoveryKeyChangeShown`), and in Settings › Security until the new one is saved.
    private(set) var recoveryKeyChanged = false
    private(set) var recoveryKeyChangeNeedsSaying = false
    /// How the key got here, when it arrived while the app was running (nil: it was already here).
    private(set) var arrivedHow: KeyHow?
    /// The open key is kept as an iCloud Keychain item (which reaches the person's other iPhone
    /// and Mac when iCloud Keychain is on), not on this device only.
    private(set) var backedUp = false
    /// The key is open but couldn't be saved anywhere on this device, so the next launch will ask
    /// for it again: said once, plainly, so nobody finds out by being locked out.
    private(set) var keyNotSaved = false
    /// The account's reset generation, as last seen.
    private var serverGeneration = 0
    private var startingFresh = false
    private var key: StoredKey?
    private var server: AccountKeyServer?
    let store: AccountKeyStore
    private let defaults: UserDefaults
    private let pollInterval: Duration
    private let retryInterval: Duration
    private let helpAfterPolls: Int
    /// How long startup waits for the server before saying it can't reach it (with Try again).
    private let fetchTimeout: Duration
    /// With the key already on this device, how long startup waits for the server before opening
    /// the notes anyway (and checking the key once the server answers): a plane's Wi-Fi or a dead
    /// connection never holds the notes back for the full `fetchTimeout`.
    private let quickCheck: Duration
    nonisolated static let defaultQuickCheck: Duration = .seconds(1)
    private let sleep: @Sendable (Duration) async throws -> Void
    /// Bumped whenever what's being worked out changes, so an older answer is ignored.
    private var generation = 0
    private var background: Task<Void, Never>?

    /// Set by the sync side: removes the account's files from Storage when it starts fresh (the
    /// rows go with `start_fresh`; Storage objects can't be deleted from SQL).
    var removeAccountFiles: (@MainActor (UUID) async -> Void)?
    /// Whether there's a network at all (NetworkPath): the retries wait while there isn't, and
    /// `networkReturned` runs them at once when it's back.
    var networkUp: @MainActor () -> Bool = { true }

    init(store: AccountKeyStore, defaults: UserDefaults = .standard, pollInterval: Duration = .seconds(2),
         helpAfter: Duration = .seconds(20), retryInterval: Duration = .seconds(10), fetchTimeout: Duration = .seconds(12),
         quickCheck: Duration = AccountCrypto.defaultQuickCheck,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.store = store
        self.defaults = defaults
        self.pollInterval = pollInterval
        self.retryInterval = retryInterval
        self.fetchTimeout = fetchTimeout
        self.quickCheck = quickCheck
        helpAfterPolls = max(1, Int((helpAfter / pollInterval).rounded()))
        self.sleep = sleep
    }

    var isReady: Bool { phase == .ready }
    /// Sync runs with the key open, or with no account at all.
    var allowsSync: Bool { phase == .ready || phase == .off }
    var dataKey: SymmetricKey? { isReady ? key?.key : nil }
    var keyID: String? { isReady ? key?.keyID : nil }
    /// The recovery key, for Settings › Security (behind Face ID or Touch ID there).
    var recoveryKeyText: String? { isReady ? key?.recoveryText : nil }
    var recoverySavedAt: Date? { serverKey?.recovery_saved_at }
    /// The recovery key is saved somewhere: printed, exported or copied on some device, or typed
    /// here to unlock (which proves it), even while that couldn't reach the server yet.
    var recoveryKeySaved: Bool {
        recoverySavedAt != nil || (account.map { defaults.bool(forKey: Self.recoveryProvenKey($0)) } ?? false)
    }

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

    /// Launching signed in: the key this device already holds for the account, opened at once,
    /// before anything is drawn, so the notes show without a key screen first. `attach` checks it
    /// with the server quietly afterwards (recheck, and the retries of an unverified key); only a
    /// key that's really missing or replaced brings the key screens. False when there's no key here.
    @discardableResult
    func openHeld(account: UUID) -> Bool {
        guard self.account == nil, phase == .off else { return false }
        let decision = KeyStartup.decide(user: account, synced: store.load(account: account, slot: .synced),
                                         pending: store.load(account: account, slot: .pending),
                                         local: store.load(account: account, slot: .local), server: .unreachable)
        guard case .ready(let k, _, _) = decision else { return false }
        self.account = account
        open(k, verified: false)
        return true
    }

    /// Runs startup again (Try again, or after the account's key changed).
    func restart() async {
        stop()
        drop()
        phase = .checking
        await run()
    }

    private static func remote(_ state: ServerKeyState) -> KeyStartup.Server {
        state.key.map { .key($0) } ?? .none(generation: state.generation)
    }

    private func run() async {
        guard let account, let server else { phase = .off; return }
        let gen = generation
        // What the Keychain holds, read once: whether to wait long, and then the decision.
        let synced = store.load(account: account, slot: .synced), local = store.load(account: account, slot: .local)
        let held = synced != nil || local != nil
        let remote: KeyStartup.Server
        var timedOut = false
        do {
            let state = try await Self.within(held ? quickCheck : fetchTimeout, sleep: sleep) { try await server.fetch() }
            remote = Self.remote(state)
            serverGeneration = state.generation
        } catch {
            timedOut = error is TimedOut
            remote = .unreachable
        }
        guard gen == generation else { return }
        if case .key(let s) = remote { serverKey = s }
        await carryOut(KeyStartup.decide(user: account, synced: synced, pending: store.load(account: account, slot: .pending),
                                         local: local, server: remote))
        // The server was only slow: the check goes on now, not after the first retry interval.
        if timedOut, phase == .ready, unverified { Task { await recheck() } }
    }

    private func carryOut(_ decision: KeyStartup.Decision) async {
        guard let account else { return }
        switch decision {
        case .ready(let k, let verified, let promote):
            // A pending key that couldn't be kept anywhere else stays where it is, and the next
            // launch tries again.
            let kept = promote ? keep(k, account: account) : true
            if verified, kept { store.remove(account: account, slot: .pending) }
            open(k, verified: verified)
        case .create(let g):
            await create(generation: g)
        case .reregister(let k):
            await reregister(k)
        case .replace(let previous, let g):
            // Kept on this device, never synced and never used: notes someone chose to delete
            // may still be in a backup somewhere, and this is the only key to them.
            store.save(previous, account: account, slot: .previous)
            // The handed-over copy goes only when it's the key just kept aside.
            if store.load(account: account, slot: .local) == previous { store.remove(account: account, slot: .local) }
            // Whichever device makes the new key, the recovery key this person saved is void.
            // (Not news on the device where they just chose to start fresh.)
            if !startingFresh { defaults.set(true, forKey: Self.recoveryChangedKey(account)) }
            await create(generation: g)
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

    /// Saves the account's key on this device: in the synced slot, or, when the Keychain refuses
    /// that write, on this device only (the slot a handed-over key uses, which startup accepts
    /// wherever the synced one is missing). The result of a save used to be ignored: the notes
    /// opened, and the next launch had no key and asked for the recovery key. False when it
    /// couldn't be kept in either.
    private func keep(_ k: StoredKey, account: UUID) -> Bool {
        store.save(k, account: account, slot: .synced) || store.save(k, account: account, slot: .local)
    }

    /// "Your key couldn't be saved" was shown.
    func keyNotSavedShown() { keyNotSaved = false }

    /// The account's first launch. The new key stays on this device only until the server has
    /// taken it: a device that loses the race never overwrites the synced key, and one that goes
    /// offline or quits mid-way still has the key if the server took it after all.
    private func create(generation g: Int) async {
        guard let account, let server else { return }
        let gen = generation
        let k = StoredKey.generate(generation: g)
        guard let row = try? k.serverRow(user: account) else { phase = .unreachable; return }
        let pendingKept = store.save(k, account: account, slot: .pending)
        do {
            let (winner, created) = try await server.create(row, generation: g)
            guard gen == generation else { return }
            serverKey = winner
            if created, k.matches(winner, user: account) {
                // The pending copy goes only once the key is kept somewhere else on this device;
                // while it stays, the next launch finds it and tries again.
                let kept = keep(k, account: account)
                if kept { store.remove(account: account, slot: .pending) }
                open(k, verified: true, how: .made)
                keyNotSaved = !kept && !pendingKept
            } else {
                // Another device made the account's key first: that one it is.
                store.remove(account: account, slot: .pending)
                await carryOut(KeyStartup.decide(user: account, synced: store.load(account: account, slot: .synced),
                                                 pending: nil, local: store.load(account: account, slot: .local), server: .key(winner)))
            }
        } catch KeyError.staleGeneration {
            guard gen == generation else { return }
            // Another device started fresh after this one read the account: this key is for
            // notes that are gone. It never reached the server, so it goes.
            store.remove(account: account, slot: .pending)
            await staleRestart()
        } catch {
            guard gen == generation else { return }
            phase = .unreachable
            startRetrying()
        }
    }

    /// Consecutive startups refused for a stale generation. One more read normally settles it; a
    /// server that keeps refusing is treated as unreachable (retried), never looped on.
    private var staleRestarts = 0

    private func staleRestart() async {
        staleRestarts += 1
        guard staleRestarts <= 2 else {
            staleRestarts = 0
            phase = .unreachable
            startRetrying()
            return
        }
        await restart()
    }

    /// The server has no key row, yet the account never started fresh since this key was made:
    /// the same key goes back (its verifier and recovery wrap), so nothing the server does short
    /// of a counted reset gets a device to make a new key. Two devices doing this at once both
    /// end with it.
    private func reregister(_ k: StoredKey) async {
        guard let account, let server else { return }
        let gen = generation
        guard let row = try? k.serverRow(user: account) else { phase = .unreachable; return }
        do {
            let (winner, _) = try await server.create(row, generation: serverGeneration)
            guard gen == generation else { return }
            serverKey = winner
            await carryOut(KeyStartup.decide(user: account, synced: k, pending: nil, server: .key(winner)))
        } catch KeyError.staleGeneration {
            guard gen == generation else { return }
            // The account started fresh since it was read: startup decides again (this key is
            // then kept aside and a new one made).
            await staleRestart()
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
            open(k, verified: true, how: .keychain)
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
        let state: ServerKeyState
        do { state = try await server.fetch() } catch { return }
        guard gen == generation, phase == .ready else { return }
        serverGeneration = state.generation
        if let fetched = state.key, key.matches(fetched, user: account) {
            serverKey = fetched
            // Unlocked with the recovery key while the server couldn't be told: tell it now.
            if fetched.recovery_saved_at == nil, defaults.bool(forKey: Self.recoveryProvenKey(account)) {
                try? await markRecoveryKeySaved()
            }
            if unverified {
                unverified = false
                store.remove(account: account, slot: .pending)
                stop()
            }
            return
        }
        await restart()
    }

    // MARK: Add a device

    /// The key another device sealed for this one (Add a device), opened. It's used only when
    /// it's the account's by the server's id and verifier and its recovery key opens the
    /// account's recovery wrap; then it's kept on this device only.
    func adopt(added k: StoredKey) throws {
        guard let account, let serverKey, phase == .waiting || phase == .mismatch else { throw KeyError.notReady }
        guard k.matches(serverKey, user: account),
              let opened = try? E2EE.unwrap(serverKey.recovery_wrap, with: E2EE.recoveryKEK(k.recovery, user: account), purpose: "recovery", user: account),
              E2EE.bytes(opened) == k.dataKey else { throw KeyError.notAccountsKey }
        guard store.save(k, account: account, slot: .local) else { throw KeyError.notReady }
        store.remove(account: account, slot: .pending)
        open(k, verified: true, how: .added)
    }

    /// The key as this device holds it, to seal for a device being added. Only while it's open
    /// and the server has confirmed it.
    var keyToHandOver: StoredKey? { isReady && !unverified ? key : nil }

    /// The same, for an account that isn't attached (a removal being finished at launch).
    func forgetLocalKey(of account: UUID) {
        store.remove(account: account, slot: .local)
        if !store.syncs {
            store.remove(account: account, slot: .synced)
            store.remove(account: account, slot: .pending)
        }
        if account == self.account, phase != .off { stop(); drop(); phase = .checking }
    }

    /// This device was removed from another one that has the key (the removal's tag was checked
    /// against this device's own key): the copy that lives only here goes. A copy iCloud Keychain
    /// holds is never touched, since deleting it would take it from every device. On a build whose
    /// Keychain doesn't sync (the Developer ID Mac), every slot lives only here, so they all go.
    func forgetLocalKey() {
        guard let account else { return }
        forgetLocalKey(of: account)
        stop()
        drop()
        phase = .checking
    }

    // MARK: The recovery key and starting fresh

    func recover(typed: String) async throws {
        guard let account, let server else { throw KeyError.notReady }
        guard let bytes = E2EE.parseRecoveryKey(typed) else { throw KeyError.typo }
        let gen = generation
        var current = serverKey
        if let fetched = try? await server.fetch() {
            current = fetched.key
            serverGeneration = fetched.generation
        }
        guard gen == generation else { throw KeyError.notReady }
        guard let current else { throw KeyError.offline }
        serverKey = current
        // The account's key was made after its last reset, so it's of the current generation.
        guard let dk = try? E2EE.unwrap(current.recovery_wrap, with: E2EE.recoveryKEK(bytes, user: account), purpose: "recovery", user: account),
              let k = StoredKey(dataKey: E2EE.bytes(dk), recovery: bytes, generation: serverGeneration),
              k.matches(current, user: account) else { throw KeyError.wrongKey }
        let kept = keep(k, account: account)
        store.remove(account: account, slot: .pending)
        open(k, verified: true, how: .recovery)
        keyNotSaved = !kept
        // Typing the recovery key proves it's saved somewhere: Settings › Security says so, here
        // and on the account's other devices. Offline, this device remembers and tells the server later.
        if current.recovery_saved_at == nil || recoveryKeyChanged {
            defaults.set(true, forKey: Self.recoveryProvenKey(account))
            try? await markRecoveryKeySaved()
        }
    }

    /// The last resort: the notes on the server can't be opened by anyone, so they're deleted,
    /// and this device makes the account's new key.
    func startFresh(confirmation: String) async throws {
        guard confirmation.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == Self.startFreshPhrase else { throw KeyError.confirmation }
        guard let account, let server else { throw KeyError.notReady }
        let current: ServerKey?
        do { current = try await server.fetch().key } catch { throw KeyError.offline }
        if let current {
            let deleted: Bool
            do { deleted = try await server.startFresh(keyID: current.key_id) }
            catch KeyError.reauth { throw KeyError.reauth }
            catch let paused as KeyError where paused.isPausedAfterReset { throw paused }
            catch { throw KeyError.offline }
            if deleted {
                // Every device hears of it (account_notices); this one did it, so it doesn't say so.
                defaults.set(true, forKey: Self.startedFreshHereKey(account))
                // What this device holds goes up again under the new key (SyncEngine.adoptKeyIfChanged).
                defaults.set(true, forKey: SyncEngine.uploadAgainKey(account))
                await removeAccountFiles?(account)
            }
        }
        serverKey = nil
        startingFresh = true
        defer { startingFresh = false }
        await restart()
    }

    func markRecoveryKeySaved() async throws {
        guard let server else { throw KeyError.notReady }
        let at: Date?
        do { at = try await server.markRecoveryKeySaved() } catch { throw KeyError.offline }
        serverKey?.recovery_saved_at = at ?? .now
        if let account {
            defaults.removeObject(forKey: Self.recoveryChangedKey(account))
            defaults.removeObject(forKey: Self.recoveryChangeSaidKey(account))
            defaults.removeObject(forKey: Self.recoveryProvenKey(account))
        }
        recoveryKeyChanged = false
        recoveryKeyChangeNeedsSaying = false
    }

    /// "Your recovery key changed" was shown.
    func recoveryKeyChangeShown() {
        if let account { defaults.set(true, forKey: Self.recoveryChangeSaidKey(account)) }
        recoveryKeyChangeNeedsSaying = false
    }

    nonisolated static func recoveryChangedKey(_ account: UUID) -> String { "e2ee.recoveryChanged.\(account.uuidString.lowercased())" }
    nonisolated static func recoveryChangeSaidKey(_ account: UUID) -> String { "e2ee.recoveryChangeSaid.\(account.uuidString.lowercased())" }
    /// The recovery key was typed here to unlock, and the server hasn't been told yet.
    nonisolated static func recoveryProvenKey(_ account: UUID) -> String { "e2ee.recoveryProven.\(account.uuidString.lowercased())" }
    /// This device started fresh: the notice every device gets about it isn't news here.
    nonisolated static func startedFreshHereKey(_ account: UUID) -> String { "e2ee.startedFreshHere.\(account.uuidString.lowercased())" }

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
        for key in [welcomedKey(account), Self.recoveryChangedKey(account), Self.recoveryChangeSaidKey(account), Self.startedFreshHereKey(account),
                    Self.recoveryProvenKey(account), SyncEngine.uploadAgainKey(account)] {
            defaults.removeObject(forKey: key)
        }
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

    private func open(_ k: StoredKey, verified: Bool, how: KeyHow? = nil) {
        guard let account else { return }
        stop()
        staleRestarts = 0
        key = k
        if let how { arrivedHow = how }
        backedUp = store.syncs && store.load(account: account, slot: .synced) == k
        unverified = !verified
        showsKeychainHelp = false
        E2EE.sealer = Sealer(key: k.key, user: account)
        needsWelcome = !defaults.bool(forKey: welcomedKey(account))
        recoveryKeyChanged = defaults.bool(forKey: Self.recoveryChangedKey(account))
        recoveryKeyChangeNeedsSaying = recoveryKeyChanged && !defaults.bool(forKey: Self.recoveryChangeSaidKey(account))
        phase = .ready
        if !verified { startRetrying() }
    }

    private func drop() {
        generation += 1
        key = nil
        arrivedHow = nil
        backedUp = false
        unverified = false
        polls = 0
        keyNotSaved = false
        showsKeychainHelp = false
        needsWelcome = false
        recoveryKeyChanged = false
        recoveryKeyChangeNeedsSaying = false
        E2EE.sealer = nil
    }

    private func stop() {
        background?.cancel()
        background = nil
    }

    struct TimedOut: Error {}

    /// `work`, or `TimedOut` after `limit`. A `sleep` that throws (tests) sets no limit.
    static func within<T: Sendable>(_ limit: Duration, sleep: @escaping @Sendable (Duration) async throws -> Void,
                                    _ work: @escaping @Sendable () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T?.self) { group in
            group.addTask { try await work() }
            group.addTask {
                do { try await sleep(limit) } catch { try await Task.sleep(for: .seconds(3600 * 24)) }
                return nil
            }
            defer { group.cancelAll() }
            guard let first = try await group.next(), let value = first else { throw TimedOut() }
            return value
        }
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

    /// The network is back: startup or the key check runs now, not at the next retry.
    func networkReturned() async {
        switch phase {
        case .unreachable: await restart()
        case .ready where unverified: await recheck()
        default: break
        }
    }

    /// Offline: startup again every little while, or (ready with a key the server hasn't
    /// confirmed) the check. Not while there's no network at all; on a network that lets nothing
    /// through (a plane's Wi-Fi), less often the longer it lasts: up to every minute.
    private func startRetrying() {
        stop()
        let gen = generation, interval = retryInterval, sleep = sleep
        background = Task { [weak self] in
            var tries = 0
            while true {
                do { try await sleep(interval * min(1 << min(tries, 3), 6)) } catch { return }
                guard let self, gen == self.generation else { return }
                guard self.networkUp() else { continue }
                tries += 1
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
