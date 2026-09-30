import CryptoKit
import Foundation
import SwiftData
import Testing
@testable import Pane

/// The shared formats: every box in supabase/functions/_shared/e2ee-vectors.json, sealed here with
/// its fixed nonce, comes out byte for byte the same as the server's and the web page's, and opens.
@Suite struct E2EEVectorTests {
    struct Vectors: Decodable {
        struct Text: Decodable { var text: String?; var json: String?; var name: String?; var context: String; var sealed: String }
        struct File: Decodable { var plain: String; var attachment_id: String; var sealed: String }
        struct Password: Decodable { var password: String; var salt: String; var iterations: Int; var wrap: String }
        struct Recovery: Decodable { var typed: String; var normalized: String; var wrap: String }
        struct Tokens: Decodable { var access: String; var code: String; var pane: String; var wraps: [String: String] }
        var data_key: String
        var key_id: String
        var nonce: String
        var user_id: String
        var note_id: String
        var body: Text
        var head: Text
        var folder: Text
        var file_meta: Text
        var file: File
        var password: Password
        var recovery: Recovery
        var tokens: Tokens
    }

    static func load() throws -> Vectors {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "supabase/functions/_shared/e2ee-vectors.json")
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    let v: Vectors
    let key: SymmetricKey
    let nonce: AES.GCM.Nonce
    let user: UUID

    init() throws {
        v = try Self.load()
        key = SymmetricKey(data: Data(base64Encoded: v.data_key)!)
        nonce = try AES.GCM.Nonce(data: Data(base64Encoded: v.nonce)!)
        user = UUID(uuidString: v.user_id)!
    }

    @Test func theDataKeysIDMatches() {
        #expect(E2EE.keyID(of: key) == v.key_id)
    }

    @Test func textBoxesSealAndOpenAlike() throws {
        let note = UUID(uuidString: v.note_id)!
        #expect(E2EE.body(note) == v.body.context && E2EE.head(note) == v.head.context)
        #expect(E2EE.folder(note) == v.folder.context && E2EE.fileMeta(note) == v.file_meta.context)
        for t in [v.body, v.head, v.folder, v.file_meta] {
            let plain = t.text ?? t.json ?? t.name ?? ""
            #expect(try NoteCrypto.seal(plain, key: key, keyID: v.key_id, context: t.context, nonce: nonce) == t.sealed)
            #expect(try NoteCrypto.open(t.sealed, key: key, context: t.context) == plain)
        }
        #expect(throws: (any Error).self) { try NoteCrypto.open(v.body.sealed, key: key, context: v.head.context) }
        let head = try JSONDecoder().decode(NoteHead.self, from: Data(v.head.json!.utf8))
        #expect(head == NoteHead(title: "Lisbon", preview: "Pastéis at 9 ✓"))
        #expect(NoteHead.of(v.body.text!) == head, "the app's title and preview are the ones the server reads")
    }

    @Test func filesSealAndOpenAlike() throws {
        let id = UUID(uuidString: v.file.attachment_id)!
        let plain = Data(base64Encoded: v.file.plain)!
        #expect(try E2EE.sealFile(plain, key: key, keyID: v.key_id, id: id, nonce: nonce).base64EncodedString() == v.file.sealed)
        #expect(try E2EE.openFile(Data(base64Encoded: v.file.sealed)!, key: key, id: id) == plain)
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.openFile(Data(base64Encoded: v.file.sealed)!, key: key, id: UUID()) }
        #expect(!E2EE.isSealedFile(plain))
    }

    @Test func wrapsAgreeWithTheServerAndTheWeb() throws {
        let pw = NoteCrypto.deriveKey(password: v.password.password, salt: Data(base64Encoded: v.password.salt)!, iterations: v.password.iterations)
        #expect(try E2EE.wrap(key, with: pw, purpose: "password", user: user, nonce: nonce) == v.password.wrap)
        #expect(E2EE.bytes(try E2EE.unwrap(v.password.wrap, with: pw, purpose: "password", user: user)) == E2EE.bytes(key))
        let wrong = NoteCrypto.deriveKey(password: "wrong", salt: Data(base64Encoded: v.password.salt)!, iterations: v.password.iterations)
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.unwrap(v.password.wrap, with: wrong, purpose: "password", user: user) }

        #expect(E2EE.normalizeRecoveryKey(v.recovery.typed) == v.recovery.normalized)
        #expect(try E2EE.wrap(key, with: E2EE.recoveryKEK(v.recovery.typed, user: user), purpose: "recovery", user: user, nonce: nonce) == v.recovery.wrap)
        _ = try E2EE.unwrap(v.recovery.wrap, with: E2EE.recoveryKEK(v.recovery.normalized.lowercased(), user: user), purpose: "recovery", user: user)

        for (purpose, secret) in [("access", v.tokens.access), ("code", v.tokens.code), ("pane", v.tokens.pane)] {
            #expect(try E2EE.wrap(key, with: E2EE.tokenKey(secret, purpose: purpose), purpose: purpose, user: user, nonce: nonce) == v.tokens.wraps[purpose])
        }
        // Another account's user id doesn't open it.
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.unwrap(v.tokens.wraps["pane"]!, with: E2EE.tokenKey(v.tokens.pane, purpose: "pane"), purpose: "pane", user: UUID()) }
    }

    @Test func recoveryKeysAreSevenGroupsOfFourWithoutLookalikes() {
        let k = E2EE.newRecoveryKey()
        let groups = k.split(separator: "-")
        #expect(groups.count == 7 && groups.allSatisfy { $0.count == 4 })
        #expect(E2EE.normalizeRecoveryKey(k).allSatisfy { E2EE.recoveryAlphabet.contains($0) })
        #expect(E2EE.normalizeRecoveryKey(" 7k4p q2wm ") == "7K4PQ2WM")
        #expect(E2EE.newRecoveryKey() != k)
    }

    @Test func theAppAddsItsCodeToTheReturnAddress() {
        let url = URL(string: "https://claude.ai/api/mcp/auth_callback?state=abc&iss=https%3A%2F%2Fmcp.ambernotes.app")!
        let out = ConnectAPI.withCode(url, "amb_code_12")
        let items = URLComponents(url: out, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(items.first { $0.name == "code" }?.value == "amb_code_12")
        #expect(items.first { $0.name == "state" }?.value == "abc")
    }
}

extension NetworkFaults {
/// The account's encryption password, recovery key and connection secrets, against a fake server.
/// With the sync tests: opening a key sets the global sealer they rely on.
@MainActor @Suite struct AccountCryptoTests {
    final class FakeRemote: AccountKeysRemote, @unchecked Sendable {
        var keys: AccountKeys?
        func fetch() async throws -> AccountKeys? { keys }
        func create(_ k: AccountKeys) async throws {
            if keys != nil { throw AccountCryptoError.alreadySetUp }
            keys = k
        }
        func update(_ k: AccountKeys) async throws { keys = k }
    }

    let user = UUID()
    let remote = FakeRemote()

    func device() -> AccountCrypto { AccountCrypto(store: MemoryDataKeyStore(), iterations: 1000) }

    @Test func theFirstDeviceSetsUpAndAnotherTypesThePassword() async throws {
        let first = device()
        await first.attach(account: user, remote: remote)
        #expect(first.phase == .needsSetup)
        await #expect(throws: AccountCryptoError.tooShort) { _ = try await first.setUp(password: "short", confirm: "short", recovery: false) }
        await #expect(throws: AccountCryptoError.mismatch) { _ = try await first.setUp(password: "long enough", confirm: "long enougH", recovery: false) }
        let recovery = try await first.setUp(password: "long enough", confirm: "long enough", recovery: true)
        #expect(first.phase == .ready && recovery != nil)
        #expect(remote.keys?.password_wrap.hasPrefix("amb2.\(remote.keys!.key_id).") == true)
        #expect(remote.keys?.key_id == E2EE.keyID(of: first.dataKey!))

        let second = device()
        await second.attach(account: user, remote: remote)
        #expect(second.phase == .needsPassword)
        await #expect(throws: AccountCryptoError.wrongPassword) { try await second.unlock(password: "not it at all") }
        try await second.unlock(password: "long enough")
        #expect(second.phase == .ready && E2EE.bytes(second.dataKey!) == E2EE.bytes(first.dataKey!))

        let third = device()
        await third.attach(account: user, remote: remote)
        try await third.unlock(recoveryKey: recovery!.lowercased().replacingOccurrences(of: "-", with: " "))
        #expect(E2EE.bytes(third.dataKey!) == E2EE.bytes(first.dataKey!))

        // Another device got there first: this one is told to type that password instead.
        let late = device()
        let empty = FakeRemote()
        await late.attach(account: user, remote: empty)
        empty.keys = remote.keys
        await #expect(throws: AccountCryptoError.alreadySetUp) { _ = try await late.setUp(password: "long enough", confirm: "long enough", recovery: false) }
        first.signedOut(); second.signedOut(); third.signedOut(); late.signedOut()
    }

    @Test func aNewPasswordOrRecoveryKeyWrapsTheSameKey() async throws {
        let d = device()
        await d.attach(account: user, remote: remote)
        let oldRecovery = try await d.setUp(password: "first password", confirm: "first password", recovery: true)!
        let key = E2EE.bytes(d.dataKey!)
        await #expect(throws: AccountCryptoError.wrongPassword) { try await d.changePassword(old: "nope nope", new: "second password", confirm: "second password") }
        try await d.changePassword(old: "first password", new: "second password", confirm: "second password")
        let newRecovery = try await d.newRecoveryKey()

        let other = device()
        await other.attach(account: user, remote: remote)
        await #expect(throws: AccountCryptoError.wrongPassword) { try await other.unlock(password: "first password") }
        await #expect(throws: AccountCryptoError.wrongRecoveryKey) { try await other.unlock(recoveryKey: oldRecovery) }
        try await other.unlock(password: "second password")
        #expect(E2EE.bytes(other.dataKey!) == key)
        let viaKey = device()
        await viaKey.attach(account: user, remote: remote)
        try await viaKey.unlock(recoveryKey: newRecovery)
        #expect(E2EE.bytes(viaKey.dataKey!) == key)
        d.signedOut(); other.signedOut(); viaKey.signedOut()
    }

    @Test func aDeviceWithTheKeyInItsKeychainNeedsNoPassword() async throws {
        let store = MemoryDataKeyStore()
        let first = AccountCrypto(store: store, iterations: 1000)
        await first.attach(account: user, remote: remote)
        _ = try await first.setUp(password: "long enough", confirm: "long enough", recovery: false)
        // iCloud Keychain brought the same item to another device.
        let synced = AccountCrypto(store: store, iterations: 1000)
        await synced.attach(account: user, remote: remote)
        #expect(synced.phase == .ready)
        first.signedOut(); synced.signedOut()
    }

    @Test func connectionSecretsWrapTheKeyForTheServer() async throws {
        let d = device()
        await d.attach(account: user, remote: remote)
        _ = try await d.setUp(password: "long enough", confirm: "long enough", recovery: false)
        let code = try d.connectionCode()
        #expect(code.code.hasPrefix("amb_code_") && code.code.count == 9 + 64)
        #expect(code.hash == E2EE.sha256Hex(code.code))
        let opened = try E2EE.unwrap(code.wrap, with: E2EE.tokenKey(code.code, purpose: "code"), purpose: "code", user: user)
        #expect(E2EE.bytes(opened) == E2EE.bytes(d.dataKey!))
        let token = try d.accessToken()
        #expect(token.token.hasPrefix("pane_") && token.token.count == 5 + 64)
        _ = try E2EE.unwrap(token.wrap, with: E2EE.tokenKey(token.token, purpose: "pane"), purpose: "pane", user: user)
        d.signedOut()
    }
}
}
