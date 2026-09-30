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

    func replace(_ s: LockSettings, expecting keyID: String) async throws {
        if offline { throw URLError(.notConnectedToInternet) }
        guard settings?.key_id == keyID else { throw NoteLockError.changedElsewhere }
        settings = s
    }

    func goOffline(_ value: Bool) { offline = value }
}

/// What the server accepts as a locked note's text (20260930100000_locked_notes.sql).
private func serverAccepts(_ sealed: String) -> Bool {
    sealed.range(of: #"^amb1\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$"#, options: .regularExpression) != nil && sealed.utf8.count <= 3_000_000
}

/// Low iteration counts keep the tests quick; `realIterations` checks the real one once.
private let fast = 1_000

@Suite struct NoteCryptoTests {
    let salt = Data((0..<16).map { UInt8($0) })

    @Test func sealedTextOpensWithTheSameKey() throws {
        let key = NoteCrypto.deriveKey(password: "correct horse", salt: salt, iterations: fast)
        let id = NoteCrypto.keyID(salt: salt)
        let text = "Bank\n\nPIN 1234\n- [ ] Call about the card\n| a | b |\nÅäö 🔒"
        let sealed = try NoteCrypto.seal(text, key: key, keyID: id)
        #expect(serverAccepts(sealed))
        #expect(!sealed.contains("PIN"))
        #expect(NoteCrypto.keyID(of: sealed) == id)
        #expect(try NoteCrypto.open(sealed, key: key) == text)
        // Every seal uses a fresh nonce: the same text never looks the same twice.
        #expect(try NoteCrypto.seal(text, key: key, keyID: id) != sealed)
    }

    @Test func theWrongPasswordOpensNothing() throws {
        let key = NoteCrypto.deriveKey(password: "correct horse", salt: salt, iterations: fast)
        let sealed = try NoteCrypto.seal("Secret", key: key, keyID: NoteCrypto.keyID(salt: salt))
        let wrong = NoteCrypto.deriveKey(password: "Correct horse", salt: salt, iterations: fast)
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(sealed, key: wrong) }
        // The same password with another account's salt is another key.
        let otherSalt = NoteCrypto.deriveKey(password: "correct horse", salt: Data(repeating: 7, count: 16), iterations: fast)
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(sealed, key: otherSalt) }
    }

    @Test func tamperingIsCaught() throws {
        let key = NoteCrypto.deriveKey(password: "pw", salt: salt, iterations: fast)
        let sealed = try NoteCrypto.seal("Secret", key: key, keyID: NoteCrypto.keyID(salt: salt))
        // Another key id in the (authenticated) header.
        let relabelled = sealed.replacingOccurrences(of: NoteCrypto.keyID(salt: salt), with: "0000000000000000")
        #expect(throws: NoteCrypto.Failure.wrongPassword) { try NoteCrypto.open(relabelled, key: key) }
        #expect(throws: NoteCrypto.Failure.malformed) { try NoteCrypto.open("Secret", key: key) }
        #expect(throws: NoteCrypto.Failure.malformed) { try NoteCrypto.open("amb1.abc.!!!", key: key) }
    }

    @Test func aPasswordTypedDifferentlyOnAnotherDeviceMakesTheSameKey() throws {
        // "é" as one character (iPhone) and as e + combining accent (some Mac input methods).
        let composed = NoteCrypto.deriveKey(password: "caf\u{e9}", salt: salt, iterations: fast)
        let decomposed = NoteCrypto.deriveKey(password: "cafe\u{301}", salt: salt, iterations: fast)
        let sealed = try NoteCrypto.seal("x", key: composed, keyID: "0123456789abcdef")
        #expect(try NoteCrypto.open(sealed, key: decomposed) == "x")
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
        let sealed = try NoteCrypto.seal("x", key: key, keyID: "0123456789abcdef")
        #expect(try NoteCrypto.open(sealed, key: key) == "x")
    }
}

@MainActor @Suite struct NoteVaultTests {
    let context: ModelContext
    let remote = FakeLockRemote()
    init() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        context = ModelContext(c)
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
        let arrived = context.createNote(in: .all, body: n.body)
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
        #expect(a.dirty && b.dirty && !open.dirty, "only the locked notes go up again")
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

    @Test func aNoteSealedBeforeAPasswordChangeElsewhereOpensWithTheEarlierPassword() async throws {
        let phone = try device()
        try await phone.setUp(password: "old pw", hint: nil)
        let n = context.createNote(in: .all, body: "Offline edit\n\nwritten on the plane")
        try phone.lock(n)
        phone.lockNow()

        // Meanwhile the Mac changed the password (and couldn't see this note).
        let mac = try device()
        await mac.refresh()
        let macContext = ModelContext(try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        try await mac.changePassword(old: "old pw", new: "new pw", hint: nil, in: macContext)

        // The phone learns of it: the new password opens the vault, but not this note yet.
        try await phone.unlock(password: "new pw")
        #expect(phone.text(of: n) == nil)
        #expect(phone.needsEarlierPassword(n))
        await #expect(throws: NoteLockError.wrongPassword) { try await phone.openEarlier(n, password: "new pw") }
        try await phone.openEarlier(n, password: "old pw")
        #expect(phone.text(of: n) == "Offline edit\n\nwritten on the plane")
        #expect(NoteCrypto.keyID(of: n.lockedBody ?? "") == phone.settings?.key_id, "sealed again with the current password")
        #expect(!phone.needsEarlierPassword(n))
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

/// What goes over the wire for a locked note.
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

extension NetworkFaults {
/// A note locked on one device, through sync (against StubSupabase) to another.
@MainActor @Suite struct LockedNoteSyncTests {
    @Test func lockedOnTheMacOpenedOnTheIPhone() async throws {
        StubSupabase.reset()
        NetFault.config = .init()
        let was = NoteDTO.sendsLock
        defer { NoteDTO.sendsLock = was }
        let remote = FakeLockRemote()
        func device() throws -> (ModelContext, SyncEngine, NoteVault) {
            let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
            let context = ModelContext(c)
            let defaults = MemoryDefaults()
            let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: context, defaults: defaults)
            let vault = NoteVault(keyStore: MemoryKeyStore(), remote: remote, defaults: defaults, iterations: fast)
            return (context, engine, vault)
        }
        let (macContext, mac, macVault) = try device()
        let n = macContext.createNote(in: .all, body: "Bank\n\nPIN 1234\nPUK 5678")
        await mac.sync()
        try await macVault.setUp(password: "blue whale 7", hint: nil)
        try macVault.lock(n)
        await mac.sync()
        #expect(!n.dirty)

        let row = try #require(StubSupabase.note(n.id))
        #expect(row["body"] as? String == "Bank")
        let sealed = try #require(row["locked_body"] as? String)
        #expect(serverAccepts(sealed))
        let everything = String(decoding: try JSONSerialization.data(withJSONObject: StubSupabase.rows("notes")), as: UTF8.self)
        #expect(!everything.contains("PIN") && !everything.contains("1234"), "the server has no plaintext")

        let (phoneContext, phone, phoneVault) = try device()
        await phone.sync()
        let arrived = try #require(phoneContext.note(n.id))
        #expect(arrived.isLocked && arrived.title == "Bank")
        #expect(phoneVault.text(of: arrived) == nil)
        await phoneVault.refresh()
        try await phoneVault.unlock(password: "blue whale 7")
        #expect(phoneVault.text(of: arrived) == "Bank\n\nPIN 1234\nPUK 5678")

        // Edited on the phone, read on the Mac.
        try phoneVault.write("Bank\n\nPIN 4321", to: arrived)
        await phone.sync()
        await mac.sync()
        #expect(macVault.text(of: n) == "Bank\n\nPIN 4321")

        // Unlocked on the Mac: a normal note everywhere.
        try macVault.removeLock(n)
        await mac.sync()
        await phone.sync()
        #expect(!arrived.isLocked && arrived.body == "Bank\n\nPIN 4321")
        #expect(StubSupabase.note(n.id)?["locked_body"] is NSNull)
        await mac.stop()
        await phone.stop()
    }

    /// Locked on one device while the other edited it: the lock wins, the edit is kept as a copy.
    @Test func anEditElsewhereNeverUnlocksANote() async throws {
        StubSupabase.reset()
        NetFault.config = .init()
        let was = NoteDTO.sendsLock
        defer { NoteDTO.sendsLock = was }
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = ModelContext(c)
        let defaults = MemoryDefaults()
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com"), context: context, defaults: defaults)
        let vault = NoteVault(keyStore: MemoryKeyStore(), remote: FakeLockRemote(), defaults: defaults, iterations: fast)
        let n = context.createNote(in: .all, body: "Plan\n\nours")
        await engine.sync()
        try await vault.setUp(password: "pw", hint: nil)
        try vault.lock(n)
        // Another device, which hasn't seen the lock, edits it later.
        StubSupabase.edit(n.id, body: "Plan\n\ntheirs", updatedAt: .now.addingTimeInterval(30))
        await engine.sync()
        #expect(n.isLocked && StubSupabase.note(n.id)?["locked_body"] as? String == n.lockedBody)
        let copies = try context.fetch(FetchDescriptor<Note>()).filter { $0.body.contains("(conflicted copy)") }
        #expect(copies.count == 1 && copies.first?.body.contains("theirs") == true && copies.first?.isLocked == false)
        await engine.stop()
    }
}
}
