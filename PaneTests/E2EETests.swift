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
        struct Recovery: Decodable {
            var bytes: String; var text: String; var typed: String; var canonical: String; var wrap: String
            var typed_nbsp: String; var typed_en_dash: String
        }
        struct ShareTag: Decodable { var note_id: String; var slug: String; var include_subnotes: Bool; var tag: String; var tag_without_subnotes: String }
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
            var request_id: String; var code: String; var match_number: String; var browser_private: String; var browser_public: String
            var device_ephemeral_private: String; var sealed: String
            var page_nonce: String; var device_nonce: String; var commit: String
        }
        var handoff: Handoff
        var share_tag: ShareTag
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
        // Pasted from a page or a PDF: no-break spaces, en dashes.
        #expect(v.recovery.typed_nbsp.contains("\u{00A0}") && v.recovery.typed_en_dash.contains("\u{2013}"))
        #expect(E2EE.canonicalRecoveryKey(v.recovery.typed_nbsp) == v.recovery.canonical)
        #expect(E2EE.canonicalRecoveryKey(v.recovery.typed_en_dash) == v.recovery.canonical)
        #expect(E2EE.parseRecoveryKey(v.recovery.typed_nbsp) == bytes && E2EE.parseRecoveryKey(v.recovery.typed_en_dash) == bytes)
        #expect(E2EE.parseRecoveryKey(v.recovery.text.replacingOccurrences(of: "-", with: "\u{2010}")) == bytes, "a hyphen character")
        #expect(E2EE.parseRecoveryKey(v.recovery.text.replacingOccurrences(of: "-", with: "\u{2015}")) == bytes, "a horizontal bar")
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

    @Test func theCommitAndTheMatchNumberAreThePages() throws {
        let h = v.handoff
        let request = try #require(UUID(uuidString: h.request_id))
        let pagePublic = try #require(Data(base64Encoded: h.browser_public))
        let np = try #require(E2EE.fromHex(h.page_nonce)), nd = try #require(E2EE.fromHex(h.device_nonce))
        #expect(np.count == 16 && nd.count == 16)
        #expect(E2EE.matchCommit(browserKey: pagePublic, pageNonce: np) == h.commit)
        #expect(E2EE.commitOpens(h.commit, browserKey: pagePublic, pageNonce: np))
        #expect(E2EE.matchNumber(browserKey: pagePublic, pageNonce: np, deviceNonce: nd, requestID: request) == h.match_number)
        #expect(E2EE.matchNumber(browserKey: pagePublic, pageNonce: np, deviceNonce: nd,
                                 requestID: UUID(uuidString: h.request_id.uppercased())!) == h.match_number, "the id goes in lowercase")
        // Always two digits, 00 to 99.
        for _ in 0 ..< 200 {
            let n = E2EE.matchNumber(browserKey: P256.KeyAgreement.PrivateKey().publicKey.x963Representation, pageNonce: E2EE.randomBytes(16),
                                     deviceNonce: E2EE.randomBytes(16), requestID: UUID())
            #expect(n.count == 2 && n.allSatisfy(\.isNumber))
        }
    }

    /// Whoever can write the ask swaps in their own key but keeps the page's commit, and replays
    /// the page's revealed nonce: the commit doesn't open, so no number shows.
    @Test func aSwappedKeyWithThePagesNonceFailsTheCommit() throws {
        let h = v.handoff
        let request = try #require(UUID(uuidString: h.request_id))
        let np = try #require(E2EE.fromHex(h.page_nonce)), nd = try #require(E2EE.fromHex(h.device_nonce))
        let swapped = P256.KeyAgreement.PrivateKey().publicKey.x963Representation
        #expect(!E2EE.commitOpens(h.commit, browserKey: swapped, pageNonce: np))
        let row = ConnectAskMatch(browser_key: swapped.base64EncodedString(), match_commit: h.commit, device_nonce: h.device_nonce, page_nonce: h.page_nonce)
        #expect(ConnectMatch.check(row, deviceNonce: nd, requestID: request) == .broken)
        // The page's own ask shows the page's number.
        let page = ConnectAskMatch(browser_key: h.browser_public, match_commit: h.commit, device_nonce: h.device_nonce, page_nonce: h.page_nonce)
        #expect(ConnectMatch.check(page, deviceNonce: nd, requestID: request) == .number(h.match_number))
        // A reveal of another nonce doesn't open it either, nor does a malformed one.
        var other = page
        other.page_nonce = E2EE.hex(E2EE.randomBytes(16))
        #expect(ConnectMatch.check(other, deviceNonce: nd, requestID: request) == .broken)
        other.page_nonce = "XYZ"
        #expect(ConnectMatch.check(other, deviceNonce: nd, requestID: request) == .broken)
    }

    @Test func theNumberWaitsForBothNoncesAndOnlyForThisDevices() throws {
        let h = v.handoff
        let request = try #require(UUID(uuidString: h.request_id))
        let nd = try #require(E2EE.fromHex(h.device_nonce))
        var row = ConnectAskMatch(browser_key: h.browser_public, match_commit: h.commit)
        #expect(ConnectMatch.check(row, deviceNonce: nd, requestID: request) == .waiting, "this device's nonce isn't on it yet")
        row.device_nonce = h.device_nonce
        #expect(ConnectMatch.check(row, deviceNonce: nd, requestID: request) == .waiting, "the page hasn't revealed")
        row.page_nonce = h.page_nonce
        #expect(ConnectMatch.check(row, deviceNonce: nd, requestID: request) == .number(h.match_number))
        #expect(ConnectMatch.check(row, deviceNonce: E2EE.randomBytes(16), requestID: request) == .otherDevice,
                "another device's nonce: never a number made from a nonce this device didn't pick")
        let bad = ConnectAskMatch(browser_key: "AAAA", match_commit: h.commit, device_nonce: h.device_nonce, page_nonce: h.page_nonce)
        #expect(ConnectMatch.check(bad, deviceNonce: nd, requestID: request) == .broken)
    }

    @Test func theHandoffPayloadIsTheServersJSON() throws {
        let h = v.handoff
        let payload = try #require(try JSONSerialization.jsonObject(with: Data(h.code.utf8)) as? [String: String])
        let code = try #require(payload["code"]), redirect = try #require(payload["redirect"])
        #expect(E2EE.handoffPayload(code: code, redirect: redirect) == h.code)
        // The redirect in it is the one the server builds from the client's address, state and issuer.
        #expect(ConnectAPI.clientRedirect("https://claude.ai/api/mcp/auth_callback", state: "s1", iss: "https://mcp.ambernotes.app") == redirect)
        let request = try #require(UUID(uuidString: h.request_id))
        let page = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64Encoded: h.browser_private)!)
        #expect(try E2EE.openHandoff(h.sealed, browserPrivate: page, requestID: request) == E2EE.handoffPayload(code: code, redirect: redirect))
    }

    @Test func shareTagsMatch() throws {
        let t = v.share_tag
        let note = try #require(UUID(uuidString: t.note_id))
        #expect(E2EE.shareTag(key, note: note, slug: t.slug, includeSubNotes: true) == t.tag)
        #expect(E2EE.shareTag(key, note: note, slug: t.slug, includeSubNotes: false) == t.tag_without_subnotes)
        #expect(E2EE.shareTag(key, note: UUID(uuidString: t.note_id.uppercased())!, slug: t.slug, includeSubNotes: true) == t.tag)
        let sealer = Sealer(key: key, user: user)
        #expect(sealer.shareTagMatches(note: note, slug: t.slug, includeSubNotes: t.include_subnotes, tag: t.tag))
        #expect(!sealer.shareTagMatches(note: note, slug: t.slug, includeSubNotes: false, tag: t.tag), "sub-notes are part of it")
        #expect(!sealer.shareTagMatches(note: note, slug: t.slug + "x", includeSubNotes: true, tag: t.tag), "so is the slug")
        #expect(!sealer.shareTagMatches(note: UUID(), slug: t.slug, includeSubNotes: true, tag: t.tag), "and the note")
        #expect(!sealer.shareTagMatches(note: note, slug: t.slug, includeSubNotes: true, tag: nil))
        #expect(!sealer.shareTagMatches(note: note, slug: t.slug, includeSubNotes: true, tag: String(t.tag.dropLast())))
        #expect(!Sealer(key: SymmetricKey(size: .bits256), user: user).shareTagMatches(note: note, slug: t.slug, includeSubNotes: true, tag: t.tag),
                "another key's tag doesn't verify")
    }
}

@Suite struct StoredKeyTests {
    @Test func encodesDataKeyAndRecoveryKeyTogether() throws {
        let k = StoredKey.generate()
        #expect(k.encoded.count == 53 && k.encoded.first == 2)
        #expect(StoredKey(encoded: k.encoded) == k)
        let later = StoredKey.generate(generation: 70_000)
        #expect(StoredKey(encoded: later.encoded) == later && StoredKey(encoded: later.encoded)?.generation == 70_000, "the reset generation it was made in")
        #expect(StoredKey(encoded: Data([1]) + k.dataKey + k.recovery) == nil, "the old format isn't read")
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
