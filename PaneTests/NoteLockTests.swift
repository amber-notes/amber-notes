import CryptoKit
import Foundation
import SwiftData
import Testing
@testable import Pane

/// The account's password setup on a pretend server, shared by every "device" in a test.
actor FakeLockRemote: NoteLockRemote {
    private(set) var settings: LockSettings?
    var offline = false

    func fetch() async throws -> LockSettings? {
        if offline { throw URLError(.notConnectedToInternet) }
        return settings
    }

    func create(_ s: LockSettings) async throws {
        if offline { throw URLError(.notConnectedToInternet) }
        guard settings == nil else { throw NoteLockError.alreadySetUp }
        settings = s
    }

    /// What the last password change sent for each note.
    private(set) var resealed: [ResealedNote] = []

    func changePassword(_ s: LockSettings, expecting keyID: String, notes: [ResealedNote]) async throws -> [UUID: Int64] {
        if offline { throw URLError(.notConnectedToInternet) }
        guard settings?.key_id == keyID else { throw NoteLockError.changedElsewhere }
        settings = s
        resealed = notes
        return Dictionary(uniqueKeysWithValues: notes.map { ($0.id, $0.version + 1) })
    }

    func goOffline(_ value: Bool) { offline = value }

    /// Whoever controls the server puts a setup of their own in place.
    func force(_ s: LockSettings) { settings = s }
}

/// What the server accepts as a locked note's text (20260930150000_locked_notes.sql).
private func serverAccepts(_ sealed: String) -> Bool {
    sealed.range(of: #"^amb[12]\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$"#, options: .regularExpression) != nil && sealed.utf8.count <= 3_000_000
}

/// Low iteration counts keep the tests quick; `realIterations` checks the real one once.
private let fast = 1_000

@Suite struct NoteCryptoTests {
    let salt = Data((0..<16).map { UInt8($0) })

    @Test func sealedTextOpensWithTheSameKey() throws {
        let key = NoteCrypto.deriveKey(password: "correct horse", salt: salt, iterations: fast)
        let id = NoteCrypto.keyID(salt: salt)
        let text = "Bank\n\nPIN 1234\n- [ ] Call about the card\n| a | b |\nÅäö 🔒"
        let sealed = try NoteCrypto.seal(text, key: key, keyID: id, context: "note:a")
        #expect(serverAccepts(sealed))
        #expect(!sealed.contains("PIN"))
        #expect(NoteCrypto.keyID(of: sealed) == id)
        #expect(try NoteCrypto.open(sealed, key: key, context: "note:a") == text)
        // Every seal uses a fresh nonce: the same text never looks the same twice.
        #expect(try NoteCrypto.seal(text, key: key, keyID: id, context: "note:a") != sealed)
    }

    @Test func theWrongPasswordOpensNothing() throws {
        let key = NoteCrypto.deriveKey(password: "correct horse", salt: salt, iterations: fast)
        let sealed = try NoteCrypto.seal("Secret", key: key, keyID: NoteCrypto.keyID(salt: salt), context: "note:a")
        let wrong = NoteCrypto.deriveKey(password: "Correct horse", salt: salt, iterations: fast)
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(sealed, key: wrong, context: "note:a") }
        // The same password with another account's salt is another key.
        let otherSalt = NoteCrypto.deriveKey(password: "correct horse", salt: Data(repeating: 7, count: 16), iterations: fast)
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(sealed, key: otherSalt, context: "note:a") }
    }

    @Test func tamperingIsCaught() throws {
        let key = NoteCrypto.deriveKey(password: "pw", salt: salt, iterations: fast)
        let sealed = try NoteCrypto.seal("Secret", key: key, keyID: NoteCrypto.keyID(salt: salt), context: "note:a")
        // Another key id in the (authenticated) header.
        let relabelled = sealed.replacingOccurrences(of: NoteCrypto.keyID(salt: salt), with: "0000000000000000")
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(relabelled, key: key, context: "note:a") }
        #expect(throws: NoteCrypto.Failure.malformed) { try NoteCrypto.open("Secret", key: key, context: "note:a") }
        #expect(throws: NoteCrypto.Failure.malformed) { try NoteCrypto.open("amb2.abc.!!!", key: key, context: "note:a") }
    }

    @Test func aBoxOpensOnlyForTheNoteItWasSealedFor() throws {
        let key = NoteCrypto.deriveKey(password: "pw", salt: salt, iterations: fast)
        let a = UUID(), b = UUID()
        let sealed = try NoteCrypto.seal("Bank\n\nPIN 1234", key: key, keyID: "0123456789abcdef", context: NoteCrypto.context(of: a))
        #expect(sealed.hasPrefix("amb2."))
        #expect(try NoteCrypto.open(sealed, key: key, context: NoteCrypto.context(of: a)) == "Bank\n\nPIN 1234")
        // Moved onto another note by whoever holds the database: it doesn't open.
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(sealed, key: key, context: NoteCrypto.context(of: b)) }
    }

    /// A box from before amb2 (header only authenticated) still opens, for any note.
    @Test func anAmb1BoxStillOpens() throws {
        let key = NoteCrypto.deriveKey(password: "pw", salt: salt, iterations: fast)
        let header = "amb1.0123456789abcdef"
        let box = try AES.GCM.seal(Data("Old note".utf8), using: key, authenticating: Data(header.utf8))
        let sealed = header + "." + box.combined!.base64EncodedString()
        #expect(try NoteCrypto.open(sealed, key: key, context: NoteCrypto.context(of: UUID())) == "Old note")
    }

    @Test func aProofCarriesTheOldKeyToWhoeverHasTheNewOne() throws {
        let old = NoteCrypto.deriveKey(password: "old", salt: salt, iterations: fast)
        let new = NoteCrypto.deriveKey(password: "new", salt: salt, iterations: fast)
        let proof = try NoteCrypto.proof(of: old, oldKeyID: "aaaaaaaaaaaaaaaa", sealedWith: new, newKeyID: "bbbbbbbbbbbbbbbb")
        let back = try #require(NoteCrypto.openProof(proof, with: new, oldKeyID: "aaaaaaaaaaaaaaaa"))
        #expect(back.withUnsafeBytes { Data($0) } == old.withUnsafeBytes { Data($0) })
        #expect(NoteCrypto.openProof(proof, with: old, oldKeyID: "aaaaaaaaaaaaaaaa") == nil)
        #expect(NoteCrypto.openProof(proof, with: new, oldKeyID: "cccccccccccccccc") == nil, "bound to the old key's id")
    }

    @Test func aPasswordTypedDifferentlyOnAnotherDeviceMakesTheSameKey() throws {
        // "é" as one character (iPhone) and as e + combining accent (some Mac input methods).
        let composed = NoteCrypto.deriveKey(password: "caf\u{e9}", salt: salt, iterations: fast)
        let decomposed = NoteCrypto.deriveKey(password: "cafe\u{301}", salt: salt, iterations: fast)
        let sealed = try NoteCrypto.seal("x", key: composed, keyID: "0123456789abcdef", context: "note:a")
        #expect(try NoteCrypto.open(sealed, key: decomposed, context: "note:a") == "x")
    }

    @Test func theVerifierChecksAPassword() throws {
        let key = NoteCrypto.deriveKey(password: "pw", salt: salt, iterations: fast)
        let v = try NoteCrypto.verifier(key: key, keyID: NoteCrypto.keyID(salt: salt))
        #expect(NoteCrypto.check(key, against: v))
        #expect(!NoteCrypto.check(NoteCrypto.deriveKey(password: "pw2", salt: salt, iterations: fast), against: v))
    }

    /// PBKDF2-HMAC-SHA256 as CommonCrypto computes it, against RFC 7914's published vector.
    @Test func keyDerivationMatchesTheStandard() {
        let key = NoteCrypto.deriveKey(password: "passwd", salt: Data("salt".utf8), iterations: 1)
        let hex = key.withUnsafeBytes { Data($0) }.map { String(format: "%02x", $0) }.joined()
        #expect(hex == "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc")
    }

    @Test func realIterations() throws {
        #expect(NoteCrypto.iterations >= 600_000)
        let key = NoteCrypto.deriveKey(password: "pw", salt: salt, iterations: NoteCrypto.iterations)
        let sealed = try NoteCrypto.seal("x", key: key, keyID: "0123456789abcdef", context: "note:a")
        #expect(try NoteCrypto.open(sealed, key: key, context: "note:a") == "x")
    }
}

@MainActor @Suite struct NoteVaultTests {
    let context: ModelContext
    let remote = FakeLockRemote()
    init() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        context = ModelContext(c)
    }

    func scratchContext() throws -> ModelContext {
        ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
    }

    /// One device: its own defaults and key store, the shared server.
    func device(_ remote: NoteLockRemote? = nil, biometry: String? = nil) throws -> NoteVault {
        let defaults = MemoryDefaults()
        let v = NoteVault(keyStore: MemoryKeyStore(biometryName: biometry), remote: remote ?? self.remote, defaults: defaults, iterations: fast)
        v.attach(account: UUID(uuidString: "00000000-0000-0000-0000-00000000000a"), remote: remote ?? self.remote)
        return v
    }

    @Test func lockingSealsTheTextAndKeepsOnlyTheTitle() async throws {
        let vault = try device()
        try await vault.setUp(password: "hunter22", hint: "  the usual  ")
        #expect(vault.isUnlocked)
        #expect(vault.settings?.hint == "the usual")
        let n = context.createNote(in: .all, body: "# Bank\n\nPIN 1234")
        n.dirty = false
        try vault.lock(n)
        #expect(n.isLocked && n.dirty)
        #expect(n.body == "Bank")
        #expect(n.title == "Bank")
        #expect(!n.body.contains("PIN") && !(n.lockedBody ?? "").contains("PIN"))
        #expect(serverAccepts(try #require(n.lockedBody)))
        #expect(vault.text(of: n) == "# Bank\n\nPIN 1234")
        // The server's check: a locked note's body is one line.
        #expect(!n.body.contains("\n"))
    }

    @Test func lockNowHidesEveryLockedNoteUntilThePasswordIsEntered() async throws {
        let vault = try device()
        try await vault.setUp(password: "hunter22", hint: nil)
        let a = context.createNote(in: .all, body: "One\n\nsecret one")
        let b = context.createNote(in: .all, body: "Two\n\nsecret two")
        try vault.lock(a)
        try vault.lock(b)
        vault.lockNow()
        #expect(!vault.isUnlocked)
        #expect(vault.text(of: a) == nil && vault.text(of: b) == nil)
        await #expect(throws: NoteLockError.wrongPassword) { try await vault.unlock(password: "hunter2") }
        #expect(vault.text(of: a) == nil)
        try await vault.unlock(password: "hunter22")
        // One unlock opens them all.
        #expect(vault.text(of: a) == "One\n\nsecret one" && vault.text(of: b) == "Two\n\nsecret two")
    }

    @Test func aFewIdleMinutesLockThemAgain() async throws {
        let vault = try device()
        try await vault.setUp(password: "pw", hint: nil)
        vault.expireIfIdle(now: .now.addingTimeInterval(vault.relockAfter - 10))
        #expect(vault.isUnlocked)
        vault.expireIfIdle(now: .now.addingTimeInterval(vault.relockAfter + 1))
        #expect(!vault.isUnlocked)
    }

    @Test func typingInAnOpenLockedNoteSealsItAgainAndTheTitleFollows() async throws {
        let vault = try device()
        try await vault.setUp(password: "pw", hint: nil)
        let n = context.createNote(in: .all, body: "Diary\n\nDay one")
        try vault.lock(n)
        let first = n.lockedBody
        try vault.write("Journal\n\nDay one\nDay two", to: n)
        #expect(n.lockedBody != first)
        #expect(n.body == "Journal" && n.title == "Journal")
        vault.lockNow()
        try await vault.unlock(password: "pw")
        #expect(vault.text(of: n) == "Journal\n\nDay one\nDay two")
    }

    @Test func removeLockMakesItANormalNoteAgain() async throws {
        let vault = try device()
        try await vault.setUp(password: "pw", hint: nil)
        let n = context.createNote(in: .all, body: "Diary\n\nDay one")
        try vault.lock(n)
        vault.lockNow()
        #expect(throws: NoteLockError.notUnlocked) { try vault.removeLock(n) }
        try await vault.unlock(password: "pw")
        try vault.removeLock(n)
        #expect(!n.isLocked && n.lockedBody == nil)
        #expect(n.body == "Diary\n\nDay one")
    }

    @Test func notesWithFilesOrSubNotesCantBeLocked() async throws {
        let vault = try device()
        try await vault.setUp(password: "pw", hint: nil)
        let file = context.createNote(in: .all, body: "Scan\n\n![x](pane-file:\(UUID().uuidString.lowercased()))")
        let parent = context.createNote(in: .all, body: "Trip\n\n[Hotel](pane-note:\(UUID().uuidString.lowercased()))")
        #expect(throws: NoteLockError.hasFilesOrSubNotes) { try vault.lock(file) }
        #expect(throws: NoteLockError.hasFilesOrSubNotes) { try vault.lock(parent) }
        #expect(!file.isLocked && !parent.isLocked)
    }

    @Test func lockingNeedsThePasswordFirst() async throws {
        let vault = try device()
        let n = context.createNote(in: .all, body: "Plan")
        #expect(throws: NoteLockError.notUnlocked) { try vault.lock(n) }
        try await vault.setUp(password: "pw", hint: nil)
        vault.lockNow()
        #expect(throws: NoteLockError.notUnlocked) { try vault.lock(n) }
    }

    @Test func settingUpNeedsTheServerWhenSignedIn() async throws {
        let vault = try device()
        await remote.goOffline(true)
        await #expect(throws: NoteLockError.offline) { try await vault.setUp(password: "pw", hint: nil) }
        #expect(!vault.isSetUp)
    }

    @Test func lockOnTheMacUnlockOnTheIPhoneWithTheSamePassword() async throws {
        let mac = try device()
        try await mac.setUp(password: "blue whale 7", hint: "the boat")
        let n = context.createNote(in: .all, body: "Codes\n\nGate 4711")
        try mac.lock(n)
        let sealed = try #require(n.lockedBody)

        // The iPhone has only what synced: the note's title and sealed text, and the setup row.
        let phone = try device()
        #expect(!phone.isSetUp)
        let arrived = try scratchContext().createNote(in: .all, body: n.body)
        arrived.id = n.id
        arrived.lockedBody = sealed
        #expect(phone.text(of: arrived) == nil)
        await phone.refresh()
        #expect(phone.isSetUp && phone.settings?.hint == "the boat")
        await #expect(throws: NoteLockError.wrongPassword) { try await phone.unlock(password: "blue whale") }
        try await phone.unlock(password: "blue whale 7")
        #expect(phone.text(of: arrived) == "Codes\n\nGate 4711")
        // And a second device can't set up another password over the first.
        let third = try device()
        await #expect(throws: NoteLockError.alreadySetUp) { try await third.setUp(password: "other", hint: nil) }
        #expect(third.settings?.key_id == mac.settings?.key_id)
    }

    @Test func changingThePasswordSealsEveryLockedNoteAgain() async throws {
        let vault = try device()
        try await vault.setUp(password: "old pw", hint: "old")
        let a = context.createNote(in: .all, body: "One\n\nfirst")
        let b = context.createNote(in: .all, body: "Two\n\nsecond")
        let open = context.createNote(in: .all, body: "Open note")
        try vault.lock(a)
        try vault.lock(b)
        let oldKeyID = try #require(vault.settings?.key_id)
        let before = (a.lockedBody, b.lockedBody)
        a.dirty = false; b.dirty = false; open.dirty = false
        // `a` is on the server (at version 3); `b` hasn't synced yet.
        a.serverVersion = 3

        await #expect(throws: NoteLockError.wrongPassword) {
            try await vault.changePassword(old: "wrong", new: "new pw", hint: nil, in: context)
        }
        #expect(vault.settings?.key_id == oldKeyID)
        try await vault.changePassword(old: "old pw", new: "new pw", hint: "new", in: context)

        let newKeyID = try #require(vault.settings?.key_id)
        #expect(newKeyID != oldKeyID)
        #expect(await remote.settings?.key_id == newKeyID)
        #expect(await remote.settings?.previous.map(\.key_id) == [oldKeyID])
        #expect(a.lockedBody != before.0 && b.lockedBody != before.1)
        #expect(NoteCrypto.keyID(of: a.lockedBody ?? "") == newKeyID && NoteCrypto.keyID(of: b.lockedBody ?? "") == newKeyID)
        // `a` went to the server with the new setup, in the same call; `b` goes up with the next push.
        let sent = await remote.resealed
        #expect(sent.map(\.id) == [a.id] && sent.first?.version == 3 && sent.first?.locked_body == a.lockedBody && sent.first?.body == "One")
        #expect(a.serverVersion == 4 && !a.dirty)
        #expect(b.dirty && !open.dirty)
        #expect(await remote.settings?.previous.last?.proof != nil, "the new setup carries a proof of the old key")
        #expect(a.body == "One" && open.body == "Open note")

        vault.lockNow()
        await #expect(throws: NoteLockError.wrongPassword) { try await vault.unlock(password: "old pw") }
        try await vault.unlock(password: "new pw")
        #expect(vault.text(of: a) == "One\n\nfirst" && vault.text(of: b) == "Two\n\nsecond")
    }

    @Test func aPasswordChangeTheServerRefusesChangesNothing() async throws {
        let vault = try device()
        try await vault.setUp(password: "old pw", hint: nil)
        let n = context.createNote(in: .all, body: "One\n\nfirst")
        try vault.lock(n)
        let sealed = n.lockedBody
        // Another device changed it first.
        let other = try device()
        await other.refresh()
        try await other.changePassword(old: "old pw", new: "their pw", hint: nil, in: try ModelContext(ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))))
        await #expect(throws: NoteLockError.changedElsewhere) {
            try await vault.changePassword(old: "old pw", new: "mine", hint: nil, in: context)
        }
        #expect(n.lockedBody == sealed)
    }

    @Test func aNoteSealedBeforeAPasswordChangeElsewhereOpensWithTheNewPassword() async throws {
        let phone = try device()
        try await phone.setUp(password: "old pw", hint: nil)
        let n = context.createNote(in: .all, body: "Offline edit\n\nwritten on the plane")
        try phone.lock(n)
        phone.lockNow()

        // Meanwhile the Mac changed the password (and couldn't see this note).
        let mac = try device()
        await mac.refresh()
        try await mac.changePassword(old: "old pw", new: "new pw", hint: nil, in: try scratchContext())

        // The phone learns of it. The old password is no use now; the new one opens everything,
        // this note too (the proof chain gives the old key), and writing seals it with the new key.
        await #expect(throws: NoteLockError.changedElsewhere) { try await phone.unlock(password: "old pw") }
        #expect(!phone.isUnlocked)
        try await phone.unlock(password: "new pw")
        #expect(phone.settings?.key_id == mac.settings?.key_id)
        #expect(phone.text(of: n) == "Offline edit\n\nwritten on the plane")
        #expect(!phone.needsEarlierPassword(n))
        try phone.write("Offline edit\n\nwritten on the plane, landed", to: n)
        #expect(NoteCrypto.keyID(of: n.lockedBody ?? "") == phone.settings?.key_id)
    }

    @Test func aSetupTheServerMadeUpIsNotTrusted() async throws {
        let phone = try device()
        try await phone.setUp(password: "mine", hint: nil)
        let n = context.createNote(in: .all, body: "Secret\n\nx")
        try phone.lock(n)
        let mine = try #require(phone.settings)
        phone.lockNow()

        // Whoever holds the database swaps in a salt and verifier of their own, with a history that
        // looks right but a proof that isn't sealed with the old key.
        let salt = NoteCrypto.newSalt(), id = NoteCrypto.keyID(salt: salt)
        let theirs = NoteCrypto.deriveKey(password: "theirs", salt: salt, iterations: fast)
        let bogus = NoteCrypto.deriveKey(password: "guess", salt: mine.saltData, iterations: fast)
        let forged = LockSettings(salt: salt.base64EncodedString(), iterations: fast, key_id: id,
                                  verifier: try NoteCrypto.verifier(key: theirs, keyID: id), hint: "theirs",
                                  previous: [.init(salt: mine.salt, iterations: mine.iterations, key_id: mine.key_id,
                                                   proof: try NoteCrypto.proof(of: bogus, oldKeyID: mine.key_id, sealedWith: theirs, newKeyID: id))])
        await remote.force(forged)
        await #expect(throws: NoteLockError.unverified) { try await phone.unlock(password: "theirs") }
        #expect(phone.settings == mine, "the device keeps the setup it trusts")
        #expect(!phone.isUnlocked)
        // And a new note locked on this device is never sealed with their key.
        #expect(throws: NoteLockError.notUnlocked) { try phone.lock(context.createNote(in: .all, body: "New")) }
    }

    @Test func anAmb1NoteIsSealedAgainAsAmb2OnTheNextSave() async throws {
        let vault = try device()
        try await vault.setUp(password: "pw", hint: nil)
        let s = try #require(vault.settings)
        let key = NoteCrypto.deriveKey(password: "pw", salt: s.saltData, iterations: s.iterations)
        let header = "amb1.\(s.key_id)"
        let box = try AES.GCM.seal(Data("Old\n\nfrom last week".utf8), using: key, authenticating: Data(header.utf8))
        let n = context.createNote(in: .all, body: "Old")
        n.lockedBody = header + "." + box.combined!.base64EncodedString()
        #expect(vault.text(of: n) == "Old\n\nfrom last week")
        try vault.write("Old\n\nfrom last week, edited", to: n)
        #expect(NoteCrypto.format(of: n.lockedBody ?? "") == "amb2")
    }

    @Test func faceIDUnlocksWithTheKeyKeptOnThisDevice() async throws {
        let vault = try device(biometry: "Face ID")
        try await vault.setUp(password: "pw", hint: nil)
        let n = context.createNote(in: .all, body: "Secret\n\nx")
        try vault.lock(n)
        vault.lockNow()
        #expect(await vault.unlockWithBiometrics())
        #expect(vault.text(of: n) == "Secret\n\nx")
        // Turned off: the kept key goes, and Face ID no longer unlocks.
        vault.usesBiometrics = false
        vault.lockNow()
        #expect(await vault.unlockWithBiometrics() == false)
        #expect(!vault.isUnlocked)
    }

    @Test func anotherAccountStartsLocked() async throws {
        let vault = try device()
        try await vault.setUp(password: "pw", hint: nil)
        vault.attach(account: UUID(), remote: FakeLockRemote())
        #expect(!vault.isUnlocked && !vault.isSetUp)
    }
}

extension NetworkFaults {
/// What goes over the wire for a locked note. With the sync tests: it sets the global
/// `NoteDTO.sendsLock` they rely on.
@MainActor @Suite struct LockedNoteWireTests {
    @Test func theSealedTextGoesUpAndComesBack() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let n = ModelContext(c).createNote(in: .all, body: "Bank")
        n.lockedBody = "amb1.0123456789abcdef.AAAA"
        let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteDTO(n))) as? [String: Any]
        #expect(sent?["body"] as? String == "Bank")
        #expect(sent?["locked_body"] as? String == "amb1.0123456789abcdef.AAAA")
        let patch = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteDTO(n).patch)) as? [String: Any]
        #expect(patch?["locked_body"] as? String == "amb1.0123456789abcdef.AAAA")
        var row = NoteDTO(n)
        #expect(SyncEngine.same(row, n))
        row.locked_body = "amb1.0123456789abcdef.BBBB"
        #expect(!SyncEngine.same(row, n), "a new sealed text is a change")
    }

    @Test func removingALockSendsTheEmptyColumnOnlyForAnAccountThatLocks() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let n = ModelContext(c).createNote(in: .all, body: "Plain")
        let was = NoteDTO.sendsLock
        defer { NoteDTO.sendsLock = was }
        NoteDTO.sendsLock = false
        let old = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteDTO(n).patch)) as? [String: Any]
        #expect(old?.keys.contains("locked_body") == false, "a server without the column never sees it")
        NoteDTO.sendsLock = true
        let new = try JSONSerialization.jsonObject(with: JSONEncoder().encode(NoteDTO(n).patch)) as? [String: Any]
        #expect(new?.keys.contains("locked_body") == true && new?["locked_body"] is NSNull)
    }
}
}

extension NetworkFaults {
/// A note locked on one device, through sync (against StubSupabase) to another.
@MainActor @Suite struct LockedNoteSyncTests {
    struct Device {
        let context: ModelContext
        let engine: SyncEngine
        let vault: NoteVault
    }

    let remote = FakeLockRemote()

    init() {
        StubSupabase.reset()
        NetFault.config = .init()
    }

    /// A device on the stub server: its own library, sync engine and vault, the shared setup.
    func device() throws -> Device {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let defaults = MemoryDefaults()
        let vault = NoteVault(keyStore: MemoryKeyStore(), remote: remote, defaults: defaults, iterations: fast)
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: context, defaults: defaults, vault: vault)
        return Device(context: context, engine: engine, vault: vault)
    }

    /// Everything on the server, as one string, to look for text that must not be there.
    func serverText() throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: StubSupabase.rows("notes")), as: UTF8.self)
    }

    func copies(_ d: Device) throws -> [Note] {
        try d.context.fetch(FetchDescriptor<Note>()).filter { $0.title.contains("(conflicted copy)") }
    }

    /// Runs `body` with the account sending locked_body (the app's vault sets this for real).
    func locking(_ body: () async throws -> Void) async rethrows {
        let was = NoteDTO.sendsLock
        NoteDTO.sendsLock = true
        defer { NoteDTO.sendsLock = was }
        try await body()
    }

    @Test func lockedOnTheMacOpenedOnTheIPhone() async throws {
        try await locking {
            let mac = try device()
            let n = mac.context.createNote(in: .all, body: "Bank\n\nPIN 1234\nPUK 5678")
            await mac.engine.sync()
            try await mac.vault.setUp(password: "blue whale 7", hint: nil)
            try mac.vault.lock(n)
            await mac.engine.sync()
            #expect(!n.dirty)

            let row = try #require(StubSupabase.note(n.id))
            #expect(row["body"] as? String == "Bank")
            let sealed = try #require(row["locked_body"] as? String)
            #expect(serverAccepts(sealed) && sealed.hasPrefix("amb2."))
            #expect(try !serverText().contains("PIN") && !serverText().contains("1234"), "the server has no plaintext")

            let phone = try device()
            await phone.engine.sync()
            let arrived = try #require(phone.context.note(n.id))
            #expect(arrived.isLocked && arrived.title == "Bank")
            #expect(phone.vault.text(of: arrived) == nil)
            await phone.vault.refresh()
            try await phone.vault.unlock(password: "blue whale 7")
            #expect(phone.vault.text(of: arrived) == "Bank\n\nPIN 1234\nPUK 5678")

            // Edited on the phone, read on the Mac.
            try phone.vault.write("Bank\n\nPIN 4321", to: arrived)
            await phone.engine.sync()
            await mac.engine.sync()
            #expect(mac.vault.text(of: n) == "Bank\n\nPIN 4321")

            // Unlocked on the Mac: a normal note everywhere.
            try mac.vault.removeLock(n)
            await mac.engine.sync()
            await phone.engine.sync()
            #expect(!arrived.isLocked && arrived.body == "Bank\n\nPIN 4321")
            #expect(StubSupabase.note(n.id)?["locked_body"] is NSNull)
            await mac.engine.stop()
            await phone.engine.stop()
        }
    }

    /// Locked here while another device edited it: the lock wins, and their edit is kept as a
    /// copy that is sealed too, here and on the server.
    @Test func anEditElsewhereNeverUnlocksANote() async throws {
        try await locking {
            let mac = try device()
            let n = mac.context.createNote(in: .all, body: "Plan\n\nours")
            await mac.engine.sync()
            try await mac.vault.setUp(password: "pw", hint: nil)
            try mac.vault.lock(n)
            // Another device, which hasn't seen the lock, edits it later.
            StubSupabase.edit(n.id, body: "Plan\n\ntheirs", updatedAt: .now.addingTimeInterval(30))
            await mac.engine.sync()
            await mac.engine.sync()
            #expect(n.isLocked && StubSupabase.note(n.id)?["locked_body"] as? String == n.lockedBody)
            let copy = try #require(try copies(mac).first)
            #expect(try copies(mac).count == 1)
            #expect(copy.isLocked && !copy.body.contains("theirs"))
            #expect(mac.vault.text(of: copy) == "Plan (conflicted copy)\n\ntheirs")
            #expect(!copy.dirty && StubSupabase.note(copy.id)?["locked_body"] as? String == copy.lockedBody)
            #expect(try !serverText().contains("theirs"), "their text is on the server only sealed")
            await mac.engine.stop()
        }
    }

    /// The same, while the notes are locked here: nothing can be sealed, so nothing goes up and
    /// nothing is lost. The note waits, and syncs once the password is entered.
    @Test func whileNotesAreLockedAConflictWaitsForThePassword() async throws {
        try await locking {
            let mac = try device()
            let n = mac.context.createNote(in: .all, body: "Plan\n\nours")
            await mac.engine.sync()
            try await mac.vault.setUp(password: "pw", hint: nil)
            try mac.vault.lock(n)
            mac.vault.lockNow()
            StubSupabase.edit(n.id, body: "Plan\n\ntheirs", updatedAt: .now.addingTimeInterval(30))
            await mac.engine.sync()
            #expect(n.dirty && n.isLocked)
            #expect(StubSupabase.note(n.id)?["body"] as? String == "Plan\n\ntheirs", "nothing went up")
            #expect(try copies(mac).isEmpty)
            if case .offline(let why) = mac.engine.status { #expect(why.contains("notes password")) } else { Issue.record("says why it's waiting") }

            try await mac.vault.unlock(password: "pw")
            await mac.engine.sync()
            await mac.engine.sync()
            #expect(!n.dirty && StubSupabase.note(n.id)?["locked_body"] as? String == n.lockedBody)
            #expect(try copies(mac).count == 1 && copies(mac).allSatisfy(\.isLocked))
            #expect(try !serverText().contains("theirs"))
            await mac.engine.stop()
        }
    }

    /// sec-review's probe: the phone, offline, edits a note the Mac has since locked. With notes
    /// locked on the phone, nothing of the edit may reach the server.
    @Test func offlineEditElsewhereLeavesNoPlaintext() async throws {
        try await locking {
            let mac = try device(), phone = try device()
            let n = mac.context.createNote(in: .all, body: "Bank\n\nPIN 1234")
            await mac.engine.sync()
            await phone.engine.sync()
            let p = try #require(phone.context.note(n.id))
            // The Mac locks it while the phone is offline.
            try await mac.vault.setUp(password: "pw", hint: nil)
            try mac.vault.lock(n)
            await mac.engine.sync()
            // Still offline, the phone edits the note it has.
            try await Task.sleep(for: .milliseconds(20))
            p.body = "Bank\n\nPIN 1234\nPUK 5678"
            p.touch()
            await phone.engine.sync()
            await phone.engine.sync()
            let everything = try serverText()
            #expect(!everything.contains("PUK") && !everything.contains("1234"), "plaintext of a locked note reached the server")
            await mac.engine.stop()
            await phone.engine.stop()
        }
    }

    /// An edit made offline on the phone before the Mac locked the note: when the phone comes
    /// back, the lock wins and the phone's edit survives as a sealed copy. No plaintext of it
    /// reaches the server, and the phone keeps no readable copy.
    @Test func anOfflineEditFromBeforeTheLockSurvivesSealed() async throws {
        try await locking {
            let mac = try device(), phone = try device()
            let n = mac.context.createNote(in: .all, body: "Plan\n\nshared")
            await mac.engine.sync()
            await phone.engine.sync()
            let p = try #require(phone.context.note(n.id))
            // Offline on the phone: the edit stays here, unpushed (touch() would push it straight away).
            p.body = "Plan\n\nshared\nphone's offline edit"
            p.updatedAt = .now
            p.dirty = true
            // The Mac locks it meanwhile.
            try await mac.vault.setUp(password: "pw", hint: nil)
            try mac.vault.lock(n)
            await mac.engine.sync()

            // Back online, notes locked on the phone: nothing of the edit goes up.
            await phone.engine.sync()
            #expect(try !serverText().contains("offline edit"))
            #expect(p.dirty)

            // Unlocked: the lock wins; the edit becomes a sealed copy, on the phone and the server.
            await phone.vault.refresh()
            try await phone.vault.unlock(password: "pw")
            await phone.engine.sync()
            await phone.engine.sync()
            #expect(p.isLocked && p.lockedBody == n.lockedBody)
            let copy = try #require(try copies(phone).first)
            #expect(copy.isLocked && phone.vault.text(of: copy)?.contains("phone's offline edit") == true)
            #expect(try !serverText().contains("offline edit"), "the server has the edit only sealed")
            let readable = try phone.context.fetch(FetchDescriptor<Note>()).filter { $0.body.contains("offline edit") }
            #expect(readable.isEmpty, "and so does the phone")
            // The Mac gets the copy and can read it.
            await mac.engine.sync()
            let arrived = try #require(mac.context.note(copy.id))
            #expect(mac.vault.text(of: arrived)?.contains("phone's offline edit") == true)
            await mac.engine.stop()
            await phone.engine.stop()
        }
    }
}
}
