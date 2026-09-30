import CryptoKit
import Foundation
import Testing
@testable import Pane

/// The shared formats: every box in supabase/functions/_shared/e2ee-vectors.json, sealed here with
/// its fixed nonce, comes out byte for byte the same as the server's, and opens.
@Suite struct E2EEVectorTests {
    struct Vectors: Decodable {
        struct Text: Decodable { var text: String?; var json: String?; var name: String?; var context: String; var sealed: String }
        struct File: Decodable { var plain: String; var attachment_id: String; var sealed: String }
        struct Recovery: Decodable { var bytes: String; var text: String; var typed: String; var canonical: String; var wrap: String }
        struct Tokens: Decodable { var access: String; var refresh: String; var code: String; var pane: String; var wraps: [String: String] }
        var data_key: String
        var key_id: String
        var verifier: String
        var nonce: String
        var user_id: String
        var note_id: String
        var body: Text
        var head: Text
        var locked_head: Text
        var folder: Text
        var file_meta: Text
        var file: File
        var recovery: Recovery
        var tokens: Tokens
        struct Handoff: Decodable {
            var request_id: String; var code: String; var browser_private: String; var browser_public: String
            var device_ephemeral_private: String; var sealed: String
        }
        var handoff: Handoff
    }

    /// supabase/functions/_shared/e2ee-vectors.json, the one file the server tests too, copied into
    /// the test bundle at build time (project.yml).
    static func load() throws -> Vectors {
        let url = try #require(Bundle(for: VectorsToken.self).url(forResource: "e2ee-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    let v: Vectors
    let key: SymmetricKey
    let nonce: AES.GCM.Nonce
    let user: UUID
    let note: UUID

    init() throws {
        v = try Self.load()
        key = SymmetricKey(data: Data(base64Encoded: v.data_key)!)
        nonce = try AES.GCM.Nonce(data: Data(base64Encoded: v.nonce)!)
        user = UUID(uuidString: v.user_id)!
        note = UUID(uuidString: v.note_id)!
    }

    @Test func theKeysIDAndVerifierMatch() {
        #expect(E2EE.keyID(of: key) == v.key_id)
        #expect(E2EE.verifier(of: key, user: user) == v.verifier)
        #expect(E2EE.verifier(of: key, user: UUID()) != v.verifier, "a verifier is bound to its account")
    }

    @Test func contextsMatch() {
        #expect(E2EE.body(note) == v.body.context)
        #expect(E2EE.head(note) == v.head.context && E2EE.head(note) == v.locked_head.context)
        #expect(E2EE.folder(note) == v.folder.context)
        #expect(E2EE.fileMeta(note) == v.file_meta.context)
    }

    @Test(arguments: ["body", "head", "locked_head", "folder", "file_meta"])
    func textBoxesSealExactlyAndOpen(_ name: String) throws {
        let box = [("body", v.body), ("head", v.head), ("locked_head", v.locked_head), ("folder", v.folder), ("file_meta", v.file_meta)]
            .first { $0.0 == name }!.1
        let plain = try #require(box.text ?? box.json ?? box.name)
        #expect(try NoteCrypto.seal(plain, key: key, keyID: v.key_id, context: box.context, nonce: nonce) == box.sealed)
        #expect(try NoteCrypto.open(box.sealed, key: key, context: box.context) == plain)
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(box.sealed, key: key, context: box.context + "x") }
    }

    @Test func headsAreTheServersJSON() throws {
        #expect(NoteHead(title: "Lisbon", preview: "Pastéis at 9 ✓").json == v.head.json)
        #expect(NoteHead(title: "Passwords").json == v.locked_head.json, "a locked note's head is its title only")
        #expect(NoteHead(title: "Passwords", preview: "").json == v.locked_head.json)
        #expect(NoteHead.of(v.body.text!) == NoteHead(title: "Lisbon", preview: "Pastéis at 9 ✓"))
        let sealer = Sealer(key: key, user: user)
        #expect(sealer.openHead(v.head.sealed, note: note) == NoteHead(title: "Lisbon", preview: "Pastéis at 9 ✓"))
        #expect(sealer.openHead(v.locked_head.sealed, note: note) == NoteHead(title: "Passwords"))
        #expect(sealer.open(v.body.sealed, context: E2EE.body(note)) == v.body.text)
    }

    @Test func fileSealsExactlyAndOpens() throws {
        let plain = Data(base64Encoded: v.file.plain)!
        let id = UUID(uuidString: v.file.attachment_id)!
        #expect(try E2EE.sealFile(plain, key: key, keyID: v.key_id, id: id, nonce: nonce).base64EncodedString() == v.file.sealed)
        #expect(try E2EE.openFile(Data(base64Encoded: v.file.sealed)!, key: key, id: id) == plain)
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.openFile(Data(base64Encoded: v.file.sealed)!, key: key, id: UUID()) }
        #expect(!E2EE.isSealedFile(plain))
    }

    @Test func recoveryKeyTextAndParsing() throws {
        let bytes = Data(base64Encoded: v.recovery.bytes)!
        #expect(E2EE.recoveryKeyText(bytes) == v.recovery.text)
        #expect(E2EE.canonicalRecoveryKey(v.recovery.typed) == v.recovery.canonical)
        #expect(E2EE.canonicalRecoveryKey(v.recovery.text) == v.recovery.canonical)
        #expect(E2EE.parseRecoveryKey(v.recovery.typed) == bytes)
        #expect(E2EE.parseRecoveryKey(v.recovery.text) == bytes)
        #expect(E2EE.parseRecoveryKey(v.recovery.canonical.lowercased()) == bytes)
        #expect(E2EE.parseRecoveryKey("60RK\u{2013}4CSM 6MV3 EE1S_78XK.RF9Y 7Y0P") == bytes, "any dash, space or dot")
        #expect(E2EE.parseRecoveryKey(String(v.recovery.canonical.dropLast())) == nil, "too short")
        #expect(E2EE.parseRecoveryKey(v.recovery.canonical.replacingOccurrences(of: "K", with: "U")) == nil, "U isn't in the alphabet")
        // A typo in any one place is caught by the check.
        let chars = Array(v.recovery.canonical)
        for i in chars.indices {
            var typo = chars
            typo[i] = typo[i] == "Z" ? "Y" : "Z"
            #expect(E2EE.parseRecoveryKey(String(typo)) == nil, "a typo at \(i)")
        }
    }

    @Test func recoveryKeysRoundTrip() {
        for _ in 0 ..< 200 {
            let bytes = E2EE.randomBytes(16)
            let text = E2EE.recoveryKeyText(bytes)
            #expect(text.count == 34 && text.split(separator: "-").count == 7)
            #expect(E2EE.parseRecoveryKey(text) == bytes)
        }
    }

    @Test func recoveryWrapSealsExactlyAndOpens() throws {
        let bytes = Data(base64Encoded: v.recovery.bytes)!
        let kek = E2EE.recoveryKEK(bytes, user: user)
        #expect(try E2EE.wrap(key, with: kek, purpose: "recovery", user: user, nonce: nonce) == v.recovery.wrap)
        #expect(E2EE.bytes(try E2EE.unwrap(v.recovery.wrap, with: kek, purpose: "recovery", user: user)) == E2EE.bytes(key))
        #expect(throws: E2EE.Failure.wrongKey) {
            try E2EE.unwrap(v.recovery.wrap, with: E2EE.recoveryKEK(E2EE.randomBytes(16), user: user), purpose: "recovery", user: user)
        }
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.unwrap(v.recovery.wrap, with: kek, purpose: "recovery", user: UUID()) }
    }

    @Test(arguments: ["access", "refresh", "code", "pane"])
    func tokenWrapsSealExactlyAndOpen(_ purpose: String) throws {
        let secret = [("access", v.tokens.access), ("refresh", v.tokens.refresh), ("code", v.tokens.code), ("pane", v.tokens.pane)].first { $0.0 == purpose }!.1
        let kek = E2EE.tokenKey(secret, purpose: purpose)
        #expect(try E2EE.wrap(key, with: kek, purpose: purpose, user: user, nonce: nonce) == v.tokens.wraps[purpose])
        #expect(E2EE.bytes(try E2EE.unwrap(v.tokens.wraps[purpose]!, with: kek, purpose: purpose, user: user)) == E2EE.bytes(key))
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.unwrap(v.tokens.wraps[purpose]!, with: kek, purpose: purpose, user: UUID()) }
    }

    @Test func handoffSealsExactlyAndOpensOnlyForThePage() throws {
        let h = v.handoff
        let request = try #require(UUID(uuidString: h.request_id))
        let page = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64Encoded: h.browser_private)!)
        let pagePublic = Data(base64Encoded: h.browser_public)!
        #expect(page.publicKey.x963Representation == pagePublic)
        let ephemeral = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64Encoded: h.device_ephemeral_private)!)
        #expect(try E2EE.sealHandoff(code: h.code, browserKey: pagePublic, requestID: request, ephemeral: ephemeral, nonce: nonce) == h.sealed)
        #expect(try E2EE.openHandoff(h.sealed, browserPrivate: page, requestID: request) == h.code)

        // Sealed here at random: the page opens it; another page or another request can't.
        let sealed = try E2EE.sealHandoff(code: h.code, browserKey: pagePublic, requestID: request)
        #expect(sealed != h.sealed && sealed.hasPrefix("amb2h."))
        #expect(try E2EE.openHandoff(sealed, browserPrivate: page, requestID: request) == h.code)
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.openHandoff(sealed, browserPrivate: .init(), requestID: request) }
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.openHandoff(sealed, browserPrivate: page, requestID: UUID()) }
        #expect(throws: E2EE.Failure.malformed) { try E2EE.sealHandoff(code: h.code, browserKey: pagePublic.prefix(33), requestID: request) }
    }
}

@Suite struct StoredKeyTests {
    @Test func encodesDataKeyAndRecoveryKeyTogether() throws {
        let k = StoredKey.generate()
        #expect(k.encoded.count == 49)
        #expect(StoredKey(encoded: k.encoded) == k)
        #expect(StoredKey(encoded: k.dataKey) == nil, "a bare key isn't a stored key")
        let user = UUID()
        let row = try k.serverRow(user: user)
        #expect(k.matches(row, user: user))
        #expect(!k.matches(row, user: UUID()))
        #expect(!StoredKey.generate().matches(row, user: user))
        let fromRecovery = try E2EE.unwrap(row.recovery_wrap, with: E2EE.recoveryKEK(E2EE.parseRecoveryKey(k.recoveryText)!, user: user),
                                           purpose: "recovery", user: user)
        #expect(E2EE.bytes(fromRecovery) == k.dataKey)
    }

    @Test func theSealerKeepsAnUnchangedBox() {
        let sealer = Sealer(key: E2EE.newDataKey(), user: UUID())
        let id = UUID()
        let a = sealer.seal("hello", context: E2EE.body(id))
        #expect(a != nil && sealer.seal("hello", context: E2EE.body(id)) == a)
        #expect(sealer.seal("hello!", context: E2EE.body(id)) != a)
    }
}

@MainActor @Suite struct ConnectionWrapTests {
    @Test func codesAndTokensCarryTheDataKey() throws {
        let crypto = AccountCrypto(store: MemoryAccountKeyStore(), defaults: UserDefaults(suiteName: "e2ee-\(UUID())")!)
        #expect(throws: KeyError.notReady) { try crypto.connectionCode() }
        let user = UUID(), k = StoredKey.generate()
        crypto.adoptForTesting(k, account: user)
        defer { crypto.signedOut() }
        let code = try crypto.connectionCode()
        #expect(code.code.hasPrefix("amb_code_") && code.code.count == 9 + 64)
        #expect(code.hash == E2EE.sha256Hex(code.code))
        #expect(E2EE.bytes(try E2EE.unwrap(code.wrap, with: E2EE.tokenKey(code.code, purpose: "code"), purpose: "code", user: user)) == k.dataKey)
        let token = try crypto.accessToken()
        #expect(token.token.hasPrefix("pane_") && token.token.count == 5 + 64)
        #expect(token.hash == E2EE.sha256Hex(token.token))
        #expect(E2EE.bytes(try E2EE.unwrap(token.wrap, with: E2EE.tokenKey(token.token, purpose: "pane"), purpose: "pane", user: user)) == k.dataKey)
    }
}

private final class VectorsToken {}
