import Foundation
import Testing
@testable import Pane

/// Getting a device the account's key (`AccountCrypto`, `KeyStartup`), with a fake Keychain and a
/// fake server. The loops in the background are switched off (their sleep throws) unless a test
/// runs them; the tests poll and retry by hand.
@MainActor @Suite(.serialized) struct KeyStartupTests {
    /// iCloud Keychain: what each device has saved, delivered to the others when they receive.
    final class Cloud: @unchecked Sendable {
        var keys: [UUID: StoredKey] = [:]
    }

    /// One device's Keychain. Its synced items go to the cloud; it has the cloud's only after
    /// `receive()` (or right away with `autoReceive`). Pending items stay here.
    final class FakeKeychain: AccountKeyStore, @unchecked Sendable {
        let cloud: Cloud
        var syncs = true
        var autoReceive: Bool
        /// Lagging sync: the cloud's key shows up on the load after this many.
        var receiveAfterLoads: Int?
        private(set) var loads = 0
        var synced: [UUID: StoredKey] = [:]
        var pending: [UUID: StoredKey] = [:]
        var previous: [UUID: StoredKey] = [:]
        /// The key another device handed over (Add a device): on this device only.
        var local: [UUID: StoredKey] = [:]
        private(set) var syncedWrites = 0

        init(cloud: Cloud, autoReceive: Bool = true) {
            self.cloud = cloud
            self.autoReceive = autoReceive
        }

        func receive() { synced.merge(cloud.keys) { _, new in new } }

        func load(account: UUID, slot: KeySlot) -> StoredKey? {
            if slot == .previous { return previous[account] }
            if slot == .local { return local[account] }
            guard slot == .synced else { return pending[account] }
            loads += 1
            if autoReceive || receiveAfterLoads.map({ loads > $0 }) == true { receive() }
            return synced[account]
        }

        func save(_ key: StoredKey, account: UUID, slot: KeySlot) -> Bool {
            if slot == .pending { pending[account] = key; return true }
            if slot == .previous { previous[account] = key; return true }
            if slot == .local { local[account] = key; return true }
            syncedWrites += 1
            synced[account] = key
            cloud.keys[account] = key
            return true
        }

        func remove(account: UUID, slot: KeySlot) {
            switch slot {
            case .pending: pending[account] = nil
            case .previous: previous[account] = nil
            case .local: local[account] = nil
            case .synced: synced[account] = nil; cloud.keys[account] = nil
            }
        }
    }

    final class FakeServer: AccountKeyServer, @unchecked Sendable {
        var row: ServerKey?
        /// account_key_resets.generation: bumped by start_fresh.
        var generation = 0
        var offline = false
        /// Answers nothing (a request that hangs).
        var hangs = false
        /// start_fresh wants a recent sign-in.
        var needsReauth = false
        /// start_fresh within 72 hours of a password reset: refused until this.
        var pausedUntil: Date?
        /// The insert lands but the answer is lost.
        var loseCreateResponse = false
        private(set) var creates = 0
        private(set) var startedFresh: [String] = []

        private(set) var fetches = 0

        func fetch() async throws -> ServerKeyState {
            fetches += 1
            if hangs { try await Task.sleep(for: .seconds(3600)) }
            if offline { throw URLError(.notConnectedToInternet) }
            return ServerKeyState(key: row, generation: generation)
        }

        /// The generation each create said it read.
        private(set) var createGenerations: [Int] = []

        func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) {
            if offline { throw URLError(.notConnectedToInternet) }
            createGenerations.append(generation)
            // create_account_key: a key for a generation the account has moved past is refused.
            if generation < self.generation { throw KeyError.staleGeneration }
            creates += 1
            let made = row == nil
            if made { row = key }
            if loseCreateResponse { throw URLError(.networkConnectionLost) }
            return (row!, made)
        }

        func markRecoveryKeySaved() async throws -> Date? {
            if offline { throw URLError(.notConnectedToInternet) }
            row?.recovery_saved_at = Date(timeIntervalSince1970: 1000)
            return row?.recovery_saved_at
        }

        func startFresh(keyID: String) async throws -> Bool {
            if offline { throw URLError(.notConnectedToInternet) }
            if let pausedUntil { throw KeyError.pausedAfterReset(until: pausedUntil) }
            if needsReauth { throw KeyError.reauth }
            startedFresh.append(keyID)
            guard row?.key_id == keyID else { return false }
            row = nil
            generation += 1
            return true
        }
    }

    let user = UUID()
    let cloud = Cloud()
    let server = FakeServer()
    let defaults = UserDefaults(suiteName: "key-startup-\(UUID())")!

    /// Runs the loops in the background at once: their waits only yield. The fetch's time limits
    /// (12 s, and 1 s with the key here) get a sleep that throws, which sets no limit; a limit that
    /// only yields races the fake server's answer, and on a busy machine it wins and the device
    /// looks unreachable.
    static let loopsRunAtOnce: @Sendable (Duration) async throws -> Void = { wait in
        if wait >= .seconds(12) || wait == AccountCrypto.defaultQuickCheck { throw CancellationError() }
        await Task.yield()
    }

    func device(_ keychain: FakeKeychain? = nil, sleep: @escaping @Sendable (Duration) async throws -> Void = { _ in throw CancellationError() }) -> (AccountCrypto, FakeKeychain) {
        let k = keychain ?? FakeKeychain(cloud: cloud)
        return (AccountCrypto(store: k, defaults: defaults, sleep: sleep), k)
    }

    /// The account already has a key, made on another device.
    func existingKey() throws -> StoredKey {
        let k = StoredKey.generate()
        server.row = try k.serverRow(user: user)
        return k
    }

    // MARK: The decision alone

    @Test func theDecision() throws {
        let k = StoredKey.generate(), other = StoredKey.generate()
        let row = try k.serverRow(user: user)
        #expect(KeyStartup.decide(user: user, synced: k, pending: nil, server: .key(row)) == .ready(k, verified: true, promote: false))
        #expect(KeyStartup.decide(user: user, synced: nil, pending: k, server: .key(row)) == .ready(k, verified: true, promote: true))
        #expect(KeyStartup.decide(user: user, synced: nil, pending: nil, server: .key(row)) == .wait)
        #expect(KeyStartup.decide(user: user, synced: other, pending: nil, server: .key(row)) == .mismatch)
        #expect(KeyStartup.decide(user: user, synced: other, pending: other, server: .key(row)) == .mismatch)
        #expect(KeyStartup.decide(user: user, synced: k, pending: nil, server: .key(try k.serverRow(user: UUID()))) == .mismatch,
                "another account's verifier")
        #expect(KeyStartup.decide(user: user, synced: nil, pending: nil, server: .none(generation: 0)) == .create(generation: 0))
        #expect(KeyStartup.decide(user: user, synced: nil, pending: nil, server: .none(generation: 3)) == .create(generation: 3))
        // A synced key and no row: the same key again unless the account started fresh since.
        #expect(KeyStartup.decide(user: user, synced: other, pending: nil, server: .none(generation: 0)) == .reregister(other))
        let later = StoredKey.generate(generation: 2)
        #expect(KeyStartup.decide(user: user, synced: later, pending: nil, server: .none(generation: 2)) == .reregister(later))
        #expect(KeyStartup.decide(user: user, synced: later, pending: nil, server: .none(generation: 1)) == .reregister(later))
        #expect(KeyStartup.decide(user: user, synced: later, pending: nil, server: .none(generation: 3)) == .replace(previous: later, generation: 3))
        #expect(KeyStartup.decide(user: user, synced: k, pending: nil, server: .unreachable) == .ready(k, verified: false, promote: false))
        #expect(KeyStartup.decide(user: user, synced: nil, pending: k, server: .unreachable) == .unreachable)
    }

    // MARK: Startup

    @Test func foundInTheKeychain() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && !crypto.unverified)
        #expect(E2EE.sealer?.keyID == k.keyID)
        #expect(crypto.recoveryKeyText == k.recoveryText)
        #expect(server.creates == 0)
        crypto.signedOut()
        #expect(E2EE.sealer == nil)
    }

    @Test func theAccountsFirstLaunchMakesTheKey() async throws {
        let (crypto, keychain) = device()
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready)
        let made = try #require(keychain.synced[user])
        let row = try #require(server.row)
        #expect(made.matches(row, user: user))
        #expect(keychain.pending[user] == nil)
        #expect(server.creates == 1)
        #expect(crypto.needsWelcome)
        crypto.welcomeShown()
        #expect(!crypto.needsWelcome)
        crypto.signedOut()
        #expect(keychain.synced[user] == made, "signing out keeps the key")
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && !crypto.needsWelcome && server.creates == 1)
        crypto.signedOut()
    }

    @Test func aNewDeviceWelcomesOnceToo() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        #expect(crypto.needsWelcome)
        crypto.signedOut()
    }

    @Test func laggingICloudKeychain() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting && E2EE.sealer == nil)
        for _ in 0 ..< 9 { #expect(!crypto.pollKeychain()) }
        #expect(!crypto.showsKeychainHelp, "no help for the first 20 seconds")
        #expect(!crypto.pollKeychain())
        #expect(crypto.showsKeychainHelp)
        cloud.keys[user] = k
        keychain.receive()
        #expect(crypto.pollKeychain())
        #expect(crypto.phase == .ready && E2EE.sealer?.keyID == k.keyID)
        #expect(server.creates == 0, "waiting never makes a key")
        #expect(keychain.syncedWrites == 0)
        crypto.signedOut()
    }

    @Test func laggingICloudKeychainPolledInTheBackground() async throws {
        let k = try existingKey()
        cloud.keys[user] = k
        let keychain = FakeKeychain(cloud: cloud, autoReceive: false)
        keychain.receiveAfterLoads = 4
        let (crypto, _) = device(keychain, sleep: Self.loopsRunAtOnce)
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting)
        await crypto.waitForBackground()
        #expect(crypto.phase == .ready && crypto.polls == 4)
        crypto.signedOut()
    }

    @Test func aDeviceThatCantSyncShowsTheRecoveryWayAtOnce() async throws {
        _ = try existingKey()
        let keychain = FakeKeychain(cloud: cloud)
        keychain.syncs = false
        let (crypto, _) = device(keychain)
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting && crypto.showsKeychainHelp)
        crypto.signedOut()
    }

    @Test func aKeyThatIsntTheAccountsIsNeverUsed() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = StoredKey.generate()
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .mismatch && E2EE.sealer == nil)
        #expect(!crypto.pollKeychain())
        #expect(crypto.phase == .mismatch)
        try await crypto.recover(typed: k.recoveryText)
        #expect(crypto.phase == .ready && keychain.synced[user] == k)
        crypto.signedOut()
    }

    @Test func aWaitingDeviceFindingAWrongKeyGoesToRecovery() async throws {
        _ = try existingKey()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting)
        keychain.synced[user] = StoredKey.generate()
        #expect(!crypto.pollKeychain())
        #expect(crypto.phase == .mismatch)
        crypto.signedOut()
    }

    // MARK: The recovery key

    @Test func recovery() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting)
        await #expect(throws: KeyError.typo) { try await crypto.recover(typed: "not a key") }
        var typo = Array(k.recoveryText)
        typo[0] = typo[0] == "Z" ? "Y" : "Z"
        await #expect(throws: KeyError.typo) { try await crypto.recover(typed: String(typo)) }
        await #expect(throws: KeyError.wrongKey) { try await crypto.recover(typed: StoredKey.generate().recoveryText) }
        #expect(crypto.phase == .waiting && keychain.synced[user] == nil)
        // Lowercase, spaces for dashes, O for 0: all fine.
        let typed = k.recoveryText.lowercased().replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "0", with: "o")
        try await crypto.recover(typed: typed)
        #expect(crypto.phase == .ready && E2EE.sealer?.keyID == k.keyID)
        #expect(keychain.synced[user] == k && cloud.keys[user] == k, "saved to iCloud Keychain for the next device")
        crypto.signedOut()
    }

    @Test func recoverySavedStatus() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        #expect(crypto.recoverySavedAt == nil)
        try await crypto.markRecoveryKeySaved()
        #expect(crypto.recoverySavedAt != nil && server.row?.recovery_saved_at != nil)
        crypto.signedOut()
    }

    @Test func unlockingWithTheRecoveryKeyCountsAsSavingIt() async throws {
        let k = try existingKey()
        let (crypto, _) = device(FakeKeychain(cloud: Cloud(), autoReceive: false))
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting && !crypto.recoveryKeySaved)
        try await crypto.recover(typed: k.recoveryText)
        #expect(crypto.phase == .ready)
        #expect(crypto.recoveryKeySaved && server.row?.recovery_saved_at != nil, "Settings › Security says Saved, here and on other devices")
        crypto.signedOut()
    }

    @Test func unlockingWithTheRecoveryKeyWhileTheServerCantBeToldTellsItLater() async throws {
        let k = try existingKey()
        let (crypto, _) = device(FakeKeychain(cloud: Cloud(), autoReceive: false))
        // The key row is read; then the connection drops before "saved" can be sent.
        final class Flaky: AccountKeyServer, @unchecked Sendable {
            let inner: FakeServer
            var failMark = true
            init(_ inner: FakeServer) { self.inner = inner }
            func fetch() async throws -> ServerKeyState { try await inner.fetch() }
            func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) { try await inner.create(key, generation: generation) }
            func markRecoveryKeySaved() async throws -> Date? {
                if failMark { throw URLError(.networkConnectionLost) }
                return try await inner.markRecoveryKeySaved()
            }
            func startFresh(keyID: String) async throws -> Bool { try await inner.startFresh(keyID: keyID) }
        }
        let flaky = Flaky(server)
        await crypto.attach(account: user, server: flaky)
        try await crypto.recover(typed: k.recoveryText)
        #expect(crypto.recoveryKeySaved, "this device knows")
        #expect(server.row?.recovery_saved_at == nil)
        flaky.failMark = false
        await crypto.recheck()
        #expect(server.row?.recovery_saved_at != nil, "and tells the server on its next check")
        #expect(!defaults.bool(forKey: AccountCrypto.recoveryProvenKey(user)))
        crypto.signedOut()
    }

    @Test func aServerThatDoesntAnswerAtStartupEndsInTryAgainNotASpinner() async throws {
        _ = try existingKey()
        server.hangs = true
        let crypto = AccountCrypto(store: FakeKeychain(cloud: Cloud(), autoReceive: false), defaults: defaults,
                                   retryInterval: .seconds(3600), fetchTimeout: .milliseconds(50))
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .unreachable)
        crypto.signedOut()
    }

    @Test func withoutTheKeyTheCodeForAnotherDeviceComesFirstAndNothingSpinsForever() {
        typealias G = KeyGateView
        #expect(G.shown(.waiting, .auto) == .addDevice, "no key here: a code another device scans, iCloud Keychain checked behind it")
        #expect(G.shown(.mismatch, .auto) == .addDevice)
        #expect(G.shown(.waiting, .recovery) == .recovery, "the recovery key is a choice, never the first ask")
        #expect(G.shown(.mismatch, .recovery) == .recovery)
        #expect(G.shown(.waiting, .noDevice) == .noDevice && G.shown(.mismatch, .noDevice) == .noDevice)
        #expect(G.shown(.waiting, .keychain) == .waiting, "waiting is a choice")
        #expect(G.shown(.mismatch, .keychain) == .addDevice, "a wrong key here can't be waited out")
        #expect(G.shown(.waiting, .startFresh) == .startFresh)
        #expect(G.shown(.ready, .keychain) == .welcome, "the key arrived while you were typing")
        #expect(G.shown(.unreachable, .auto) == .unreachable)
        #expect(G.shown(.checking, .auto) == .checking)
    }

    @Test func choosingToWaitSpinsOnlyUntilTheHelpShows() async throws {
        _ = try existingKey()
        let crypto = AccountCrypto(store: FakeKeychain(cloud: Cloud(), autoReceive: false), defaults: defaults,
                                   pollInterval: .seconds(2), helpAfter: .seconds(20), sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting && !crypto.showsKeychainHelp)
        for _ in 0 ..< 10 { crypto.pollKeychain() }
        #expect(crypto.showsKeychainHelp, "after about 20 seconds the spinner gives way to what to check")
        crypto.signedOut()
    }

    // MARK: Starting fresh

    @Test func startFresh() async throws {
        let old = try existingKey()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        var removedFiles: [UUID] = []
        crypto.removeAccountFiles = { removedFiles.append($0) }
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .waiting)
        await #expect(throws: KeyError.confirmation) { try await crypto.startFresh(confirmation: "yes") }
        #expect(server.row?.key_id == old.keyID)
        try await crypto.startFresh(confirmation: " Start Fresh ")
        #expect(server.startedFresh == [old.keyID])
        #expect(removedFiles == [user])
        #expect(crypto.phase == .ready)
        let new = try #require(keychain.synced[user])
        let row = try #require(server.row)
        #expect(new != old && new.matches(row, user: user))
        #expect(new.generation == 1 && server.generation == 1, "made in the new generation")
        #expect(defaults.bool(forKey: SyncEngine.uploadAgainKey(user)), "what this device holds is to go up again")
        crypto.signedOut()
    }

    /// The key screens say only what's known. A Mac that lost its key may be the account's only
    /// device, with all its notes still on it: Start fresh there keeps them and says so.
    @Test func theKeyScreensSayWhatIsTrue() {
        #expect(!AddDeviceCopy.gateWhy.contains("another device") && AddDeviceCopy.gateWhy.contains("doesn\u{2019}t have the key"))
        let empty = KeyCopy.startFreshMessage(notesHere: 0), holding = KeyCopy.startFreshMessage(notesHere: 113)
        #expect(empty.count == 2 && empty[1].contains("your account starts empty"))
        #expect(holding.count == 2 && holding[0] == empty[0])
        #expect(holding[1].contains("are kept and uploaded again under a new key") && !holding[1].contains("starts empty"))
        #expect(holding[1].contains("You lose version history, shared links, AI connections, and files that aren't on this"))
        for line in empty + holding + [AddDeviceCopy.gateWhy] { #expect(!line.contains("\u{2014}") && !line.contains("\u{2013}")) }
    }

    @Test func startFreshAfterAnotherDeviceAlreadyDid() async throws {
        _ = try existingKey()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        var removedFiles: [UUID] = []
        crypto.removeAccountFiles = { removedFiles.append($0) }
        await crypto.attach(account: user, server: server)
        // Meanwhile another device started fresh and made the new key.
        let theirs = StoredKey.generate()
        server.row = try theirs.serverRow(user: user)
        try await crypto.startFresh(confirmation: "start fresh")
        #expect(server.startedFresh == [theirs.keyID], "the key it saw is the one it gives up")
        #expect(removedFiles == [user] && crypto.phase == .ready)
        let mine = try #require(keychain.synced[user])
        let row = try #require(server.row)
        #expect(mine != theirs && mine.matches(row, user: user))
        crypto.signedOut()
    }

    // MARK: Two devices at once

    @Test func twoDevicesRacingToMakeTheKeyEndWithTheSameKey() async throws {
        let (a, keychainA) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        let (b, keychainB) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        // B asked first and heard there's no key; A makes one before B's insert lands.
        let server = server, user = user
        await b.attach(account: user, server: SlowFirstServer(inner: server) { await a.attach(account: user, server: server) })
        #expect(a.phase == .ready)
        let aKey = try #require(keychainA.synced[user])
        let row = try #require(server.row)
        #expect(aKey.matches(row, user: user))
        #expect(b.phase == .waiting, "B lost: it waits for A's key")
        #expect(keychainB.pending[user] == nil && keychainB.synced[user] == nil, "the loser never saves its key")
        #expect(cloud.keys[user] == aKey, "and never overwrites the winner's in iCloud Keychain")
        keychainB.receive()
        #expect(b.pollKeychain())
        #expect(keychainB.synced[user] == aKey)
        #expect(server.creates == 2)
        a.signedOut()
        b.signedOut()
    }

    /// Runs `between` after the first fetch and before the first insert, as another device would.
    final class SlowFirstServer: AccountKeyServer, @unchecked Sendable {
        let inner: FakeServer
        var between: (@Sendable () async -> Void)?
        init(inner: FakeServer, between: @escaping @Sendable () async -> Void) {
            self.inner = inner
            self.between = between
        }
        func fetch() async throws -> ServerKeyState { try await inner.fetch() }
        func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) {
            if let between { self.between = nil; await between() }
            return try await inner.create(key, generation: generation)
        }
        func markRecoveryKeySaved() async throws -> Date? { try await inner.markRecoveryKeySaved() }
        func startFresh(keyID: String) async throws -> Bool { try await inner.startFresh(keyID: keyID) }
    }

    @Test func aKeyWhoseCreationWentUnansweredIsKept() async throws {
        let (crypto, keychain) = device()
        server.loseCreateResponse = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .unreachable)
        let pending = try #require(keychain.pending[user])
        let row = try #require(server.row)
        #expect(pending.matches(row, user: user), "the server took it")
        server.loseCreateResponse = false
        await crypto.restart()
        #expect(crypto.phase == .ready && server.creates == 1)
        #expect(keychain.synced[user] == pending && keychain.pending[user] == nil)
        crypto.signedOut()
    }

    // MARK: Offline

    @Test func offlineWithTheKeyCarriesOnAndChecksLater() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        server.offline = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && crypto.unverified)
        await crypto.recheck()
        #expect(crypto.unverified)
        server.offline = false
        await crypto.recheck()
        #expect(crypto.phase == .ready && !crypto.unverified)
        crypto.signedOut()
    }

    /// A plane's Wi-Fi before you pay, or a dead connection: requests hang instead of failing.
    /// With the key here the notes open after the quick check, not after the full 12 s; the
    /// key is checked once the server answers.
    @Test func aHungServerDoesNotHoldBackTheNotesWhenTheKeyIsHere() async throws {
        let k = try existingKey()
        let keychain = FakeKeychain(cloud: cloud)
        keychain.synced[user] = k
        server.hangs = true
        let crypto = AccountCrypto(store: keychain, defaults: defaults, retryInterval: .seconds(3600),
                                   fetchTimeout: .seconds(12), quickCheck: .milliseconds(100))
        let t = ContinuousClock.now
        await crypto.attach(account: user, server: server)
        let took = ContinuousClock.now - t
        print("PERF key check on a hung server with the key here: notes open after \(took)")
        #expect(crypto.phase == .ready && crypto.unverified && E2EE.sealer != nil)
        #expect(took < .seconds(2), "not the full 12 s")
        server.hangs = false
        await crypto.recheck()
        #expect(crypto.phase == .ready && !crypto.unverified, "checked once the server answers")
        crypto.signedOut()
    }

    /// Without the key there's nothing to open: startup waits the full limit for the server.
    @Test func aHungServerWithoutTheKeyStillGetsTheFullWait() async throws {
        _ = try existingKey()
        server.hangs = true
        let crypto = AccountCrypto(store: FakeKeychain(cloud: Cloud(), autoReceive: false), defaults: defaults, retryInterval: .seconds(3600),
                                   fetchTimeout: .milliseconds(400), quickCheck: .milliseconds(10))
        let t = ContinuousClock.now
        await crypto.attach(account: user, server: server)
        #expect(ContinuousClock.now - t >= .milliseconds(380))
        #expect(crypto.phase == .unreachable)
        crypto.signedOut()
    }

    /// Hours offline: with no network at all the key check doesn't run; on a network that lets
    /// nothing through it runs less and less often, up to once a minute.
    @Test func longOfflineChecksTheKeyRarelyAndNotAtAllWithoutANetwork() async throws {
        let k = try existingKey()
        final class Waits: @unchecked Sendable { var list: [Duration] = [] }
        let waits = Waits()
        let keychain = FakeKeychain(cloud: cloud)
        keychain.synced[user] = k
        server.offline = true
        let crypto = AccountCrypto(store: keychain, defaults: defaults, retryInterval: .seconds(10), sleep: { wait in
            // The fetch's time limits: none.
            if wait == .seconds(12) || wait == AccountCrypto.defaultQuickCheck { throw CancellationError() }
            waits.list.append(wait)
            if waits.list.count >= 6 { throw CancellationError() }
            await Task.yield()
        })
        var up = false
        crypto.networkUp = { up }
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && crypto.unverified)
        await crypto.waitForBackground()
        #expect(server.fetches == 1, "no network: only the startup read")
        #expect(waits.list.allSatisfy { $0 == .seconds(10) }, "and nothing backs off while it waits for one")

        // A network that lets nothing through.
        waits.list = []
        up = true
        crypto.signedOut()
        await crypto.attach(account: user, server: server)
        await crypto.waitForBackground()
        #expect(waits.list == [.seconds(10), .seconds(20), .seconds(40), .seconds(60), .seconds(60), .seconds(60)])
        print("PERF key check on a network that lets nothing through: waits \(waits.list)")

        // The network is back: checked at once.
        server.offline = false
        await crypto.networkReturned()
        #expect(crypto.phase == .ready && !crypto.unverified)
        crypto.signedOut()
    }

    @Test func comingBackOnlineWithoutTheKeyStartsAgainAtOnce() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        server.offline = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .unreachable)
        server.offline = false
        keychain.synced[user] = k
        await crypto.networkReturned()
        #expect(crypto.phase == .ready && !crypto.unverified)
        crypto.signedOut()
    }

    @Test func offlineWithAKeyTheServerNoLongerHas() async throws {
        let (crypto, keychain) = device()
        keychain.synced[user] = StoredKey.generate()
        _ = try existingKey()
        server.offline = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready)
        server.offline = false
        await crypto.recheck()
        #expect(crypto.phase == .mismatch && E2EE.sealer == nil)
        crypto.signedOut()
    }

    @Test func offlineWithoutTheKey() async throws {
        let (crypto, keychain) = device()
        server.offline = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .unreachable && E2EE.sealer == nil && server.creates == 0)
        server.offline = false
        await crypto.restart()
        #expect(crypto.phase == .ready && keychain.synced[user] != nil)
        crypto.signedOut()
    }

    @Test func offlineRetriesInTheBackground() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device(sleep: Self.loopsRunAtOnce)
        server.offline = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .unreachable)
        server.offline = false
        keychain.synced[user] = k
        await crypto.waitForBackground()
        #expect(crypto.phase == .ready && !crypto.unverified && server.creates == 0)
        crypto.signedOut()
    }

    @Test func aKeyUsedOfflineIsCheckedInTheBackground() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device(sleep: Self.loopsRunAtOnce)
        keychain.synced[user] = k
        server.offline = true
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && crypto.unverified)
        server.offline = false
        await crypto.waitForBackground()
        #expect(crypto.phase == .ready && !crypto.unverified)
        crypto.signedOut()
    }

    // MARK: While running

    @Test func theServersKeyChangingDropsThisOne() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready)
        await crypto.recheck()
        #expect(crypto.phase == .ready, "the same key: nothing changes")
        // Another device started fresh and made a new key.
        let theirs = StoredKey.generate()
        server.row = try theirs.serverRow(user: user)
        await crypto.recheck()
        #expect(crypto.phase == .mismatch && E2EE.sealer == nil && crypto.dataKey == nil)
        cloud.keys[user] = theirs
        keychain.receive()
        #expect(crypto.pollKeychain())
        #expect(crypto.phase == .ready && E2EE.sealer?.keyID == theirs.keyID)
        crypto.signedOut()
    }

    @Test func theServersKeyGoneMidwayWithoutAResetComesBackTheSame() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        server.row = nil
        await crypto.recheck()
        #expect(crypto.phase == .ready && keychain.synced[user] == k, "no new key: the row goes back")
        #expect(k.matches(try #require(server.row), user: user))
        #expect(keychain.previous[user] == nil && !crypto.recoveryKeyChanged)
        crypto.signedOut()
    }

    @Test func theServersKeyGoneMidwayAfterAResetMakesANewOne() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        server.row = nil
        server.generation = 1
        await crypto.recheck()
        let new = try #require(keychain.synced[user])
        #expect(crypto.phase == .ready && new != k && new.generation == 1)
        #expect(new.matches(try #require(server.row), user: user))
        #expect(keychain.previous[user] == k, "the old key is kept aside on this device")
        #expect(crypto.recoveryKeyChanged)
        crypto.signedOut()
    }

    // MARK: A synced key is never replaced without a reset

    @Test func aKeyRowTheServerLostIsRegisteredAgainNotReplaced() async throws {
        let k = StoredKey.generate()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        // The server says the account has no key, but it never started fresh.
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && E2EE.sealer?.keyID == k.keyID)
        let row = try #require(server.row)
        #expect(row.key_id == k.keyID && row.verifier == E2EE.verifier(of: k.key, user: user), "the same key's verifier")
        #expect(E2EE.bytes(try E2EE.unwrap(row.recovery_wrap, with: E2EE.recoveryKEK(k.recovery, user: user), purpose: "recovery", user: user)) == k.dataKey,
                "and its recovery wrap: the recovery key the person saved still works")
        #expect(keychain.synced[user] == k && keychain.syncedWrites == 0 && keychain.previous[user] == nil)
        #expect(!crypto.recoveryKeyChanged && !crypto.recoveryKeyChangeNeedsSaying)
        crypto.signedOut()
    }

    @Test func aKeyFromBeforeAStartFreshIsKeptAsideAndTheChangeIsSaidOnce() async throws {
        let old = StoredKey.generate(generation: 0)
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        keychain.synced[user] = old
        server.generation = 1
        await crypto.attach(account: user, server: server)
        let new = try #require(keychain.synced[user])
        #expect(crypto.phase == .ready && new != old && new.generation == 1)
        #expect(new.matches(try #require(server.row), user: user))
        #expect(keychain.previous[user] == old)
        #expect(crypto.recoveryKeyChanged && crypto.recoveryKeyChangeNeedsSaying)
        crypto.recoveryKeyChangeShown()
        #expect(crypto.recoveryKeyChanged && !crypto.recoveryKeyChangeNeedsSaying, "Settings › Security keeps saying it")
        crypto.signedOut()
        // Said once: not again on the next launch, until the new key is saved.
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .ready && crypto.recoveryKeyChanged && !crypto.recoveryKeyChangeNeedsSaying)
        try await crypto.markRecoveryKeySaved()
        #expect(!crypto.recoveryKeyChanged)
        crypto.signedOut()
    }

    @Test func twoDevicesRegisteringTheSameKeyAgainAtOnceBothKeepIt() async throws {
        let k = StoredKey.generate()
        cloud.keys[user] = k
        let (a, keychainA) = device(FakeKeychain(cloud: cloud))
        let (b, keychainB) = device(FakeKeychain(cloud: cloud))
        let server = server, user = user
        // B heard there's no key; A registers it again before B's insert lands.
        await b.attach(account: user, server: SlowFirstServer(inner: server) { await a.attach(account: user, server: server) })
        #expect(a.phase == .ready && b.phase == .ready)
        #expect(keychainA.synced[user] == k && keychainB.synced[user] == k && cloud.keys[user] == k, "nobody made a new key")
        #expect(k.matches(try #require(server.row), user: user) && server.creates == 2)
        #expect(keychainA.previous[user] == nil && keychainB.previous[user] == nil)
        a.signedOut()
        b.signedOut()
    }

    @Test func aDeviceWithAnOldKeyLosingTheRaceWaitsForTheNewOne() async throws {
        let old = StoredKey.generate(generation: 0)
        server.generation = 1
        let (a, keychainA) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        keychainA.synced[user] = old
        let (b, keychainB) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        let server = server, user = user
        // A kept its old key aside and is making the new one; B makes it first.
        await a.attach(account: user, server: SlowFirstServer(inner: server) { await b.attach(account: user, server: server) })
        let theirs = try #require(keychainB.synced[user])
        #expect(b.phase == .ready && theirs.generation == 1)
        #expect(a.phase == .mismatch && E2EE.sealer?.keyID != old.keyID)
        #expect(keychainA.previous[user] == old && keychainA.pending[user] == nil)
        #expect(cloud.keys[user] == theirs, "the loser never overwrites the winner's key")
        keychainA.receive()
        #expect(a.pollKeychain())
        #expect(a.phase == .ready && keychainA.synced[user] == theirs && a.recoveryKeyChanged)
        a.signedOut()
        b.signedOut()
    }

    // MARK: A key made for a generation the account has moved past

    /// Another device starts fresh after this one read "no key, generation 0" and before its key
    /// lands: the server refuses it, and startup reads again and ends on the current generation.
    @Test func aCreateRefusedForAStaleGenerationReadsAgainAndEndsRight() async throws {
        let (crypto, keychain) = device()
        let server = server
        await crypto.attach(account: user, server: SlowFirstServer(inner: server) { server.generation = 1 })
        #expect(server.createGenerations == [0, 1], "refused for 0, then made for the generation read again")
        let k = try #require(keychain.synced[user])
        #expect(crypto.phase == .ready && k.generation == 1 && E2EE.sealer?.keyID == k.keyID)
        #expect(k.matches(try #require(server.row), user: user) && server.creates == 1)
        #expect(keychain.pending[user] == nil, "the refused key is gone")
        crypto.signedOut()
    }

    /// The same, for a device registering its synced key again: the reset wins, the old key is
    /// kept aside and a new one is made.
    @Test func aKeyRegisteredAgainAfterAResetItDidntSeeIsReplaced() async throws {
        let old = StoredKey.generate(generation: 0)
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        keychain.synced[user] = old
        let server = server
        await crypto.attach(account: user, server: SlowFirstServer(inner: server) { server.generation = 1 })
        let new = try #require(keychain.synced[user])
        #expect(crypto.phase == .ready && new != old && new.generation == 1)
        #expect(new.matches(try #require(server.row), user: user))
        #expect(keychain.previous[user] == old && crypto.recoveryKeyChanged)
        crypto.signedOut()
    }

    /// A server that refuses every generation is never looped on: it's retried as unreachable.
    @Test func aServerThatKeepsRefusingIsntLoopedOn() async throws {
        final class Refusing: AccountKeyServer, @unchecked Sendable {
            var creates = 0
            func fetch() async throws -> ServerKeyState { ServerKeyState(key: nil, generation: 0) }
            func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) {
                creates += 1
                throw KeyError.staleGeneration
            }
            func markRecoveryKeySaved() async throws -> Date? { nil }
            func startFresh(keyID: String) async throws -> Bool { false }
        }
        let refusing = Refusing()
        let (crypto, keychain) = device()
        await crypto.attach(account: user, server: refusing)
        #expect(crypto.phase == .unreachable && refusing.creates == 3)
        #expect(keychain.synced[user] == nil && keychain.pending[user] == nil)
        crypto.signedOut()
    }

    @Test func startFreshNeedsARecentSignIn() async throws {
        let old = try existingKey()
        let (crypto, _) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        var removedFiles: [UUID] = []
        crypto.removeAccountFiles = { removedFiles.append($0) }
        await crypto.attach(account: user, server: server)
        server.needsReauth = true
        await #expect(throws: KeyError.reauth) { try await crypto.startFresh(confirmation: "start fresh") }
        #expect(server.row?.key_id == old.keyID && removedFiles.isEmpty && crypto.phase == .waiting)
        #expect(!defaults.bool(forKey: AccountCrypto.startedFreshHereKey(user)))
        // Signed in again: it goes through.
        server.needsReauth = false
        try await crypto.startFresh(confirmation: "start fresh")
        #expect(crypto.phase == .ready && server.generation == 1 && removedFiles == [user])
        #expect(defaults.bool(forKey: AccountCrypto.startedFreshHereKey(user)), "this device's own notice isn't news here")
        crypto.signedOut()
    }

    @Test func startFreshIsPausedAfterAPasswordResetAndSaysUntilWhen() async throws {
        let old = try existingKey()
        let (crypto, _) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        var removedFiles: [UUID] = []
        crypto.removeAccountFiles = { removedFiles.append($0) }
        await crypto.attach(account: user, server: server)
        let until = Date(timeIntervalSince1970: 1_790_000_000)
        server.pausedUntil = until
        do {
            try await crypto.startFresh(confirmation: "start fresh")
            Issue.record("start fresh went through during the pause")
        } catch let e as KeyError {
            #expect(e == .pausedAfterReset(until: until), "not turned into offline")
            let text = e.localizedDescription
            #expect(text.hasPrefix("Start fresh is paused for 72 hours after a password reset, to protect your notes. Try again on "))
            #expect(text.contains(until.formatted(date: .long, time: .shortened)))
        }
        #expect(server.row?.key_id == old.keyID && removedFiles.isEmpty)
        // After the window the server lets it through.
        server.pausedUntil = nil
        try await crypto.startFresh(confirmation: "start fresh")
        #expect(server.generation == 1 && removedFiles == [user])
        crypto.signedOut()
    }

    @Test func theServersPauseTimeIsRead() {
        #expect(SupabaseAccountKeys.pausedUntil("2026-10-05T14:30:00Z") == Date(timeIntervalSince1970: 1_791_210_600))
        #expect(SupabaseAccountKeys.pausedUntil(nil) == nil)
        #expect(SupabaseAccountKeys.pausedUntil("soon") == nil)
        #expect(KeyError.pausedAfterReset(until: nil).localizedDescription.hasSuffix("Try again in 3 days."))
    }

    @Test func deletingTheAccountSaysWhenItsPausedAndUntilWhen() throws {
        let body = Data(#"{"error":"x","hint":"paused_after_reset","until":"2026-10-05T14:30:00.000Z"}"#.utf8)
        let until = Date(timeIntervalSince1970: 1_791_210_600)
        #expect(Backend.deletePausedMessage(body) == "Deleting your account is paused for 72 hours after a password reset, to protect your notes. Try again on \(until.formatted(date: .long, time: .shortened)).")
        #expect(Backend.deletePausedMessage(Data(#"{"error":"Couldn't delete the account."}"#.utf8)) == nil, "other refusals keep their own words")
        #expect(Backend.deletePausedMessage(Data("not json".utf8)) == nil)
    }

    @Test func startingFreshWithAWrongKeyHereKeepsItAsideQuietly() async throws {
        _ = try existingKey()
        let other = StoredKey.generate()
        let (crypto, keychain) = device(FakeKeychain(cloud: cloud, autoReceive: false))
        keychain.synced[user] = other
        await crypto.attach(account: user, server: server)
        #expect(crypto.phase == .mismatch)
        try await crypto.startFresh(confirmation: "start fresh")
        let new = try #require(keychain.synced[user])
        #expect(crypto.phase == .ready && new != other && new.generation == 1 && keychain.previous[user] == other)
        #expect(!crypto.recoveryKeyChanged, "the person chose it here: no alert about it")
        crypto.signedOut()
    }

    // MARK: Leaving

    @Test func deletingTheAccountForgetsTheKey() async throws {
        let (crypto, keychain) = device()
        await crypto.attach(account: user, server: server)
        #expect(keychain.synced[user] != nil)
        crypto.forgetKey(account: user)
        #expect(keychain.synced[user] == nil && cloud.keys[user] == nil && keychain.pending[user] == nil)
        #expect(crypto.phase == .off && E2EE.sealer == nil)
    }
}

/// The session's last real sign-in, read from its access token's `amr` claim, as the server reads it.
/// Just signed in: the key gate's spinner waits on the key check alone.
@MainActor @Suite struct SignedInStartupTests {
    @Test(.timeLimit(.minutes(1))) func theKeyCheckDoesNotWaitForTheNoteLock() async {
        var checked = false
        // A server that takes the connection and never answers.
        let (never, close) = AsyncStream<Void>.makeStream()
        await SignedInStartup(refreshLock: { for await _ in never {} }, checkKey: { checked = true }).run()
        #expect(checked)
        close.finish()
    }
}

@Suite struct SignInRecencyTests {
    private func token(_ payload: [String: Any]) throws -> String {
        let json = try JSONSerialization.data(withJSONObject: payload)
        let b64url = json.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "eyJhbGciOiJIUzI1NiJ9.\(b64url).c2lnbmF0dXJl"
    }

    @Test func theNewestSignInThatIsntARefresh() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let t = try token(["sub": "x", "amr": [["method": "password", "timestamp": 1_800_000_000 - 3600],
                                              ["method": "id_token", "timestamp": 1_800_000_000 - 120],
                                              ["method": "token_refresh", "timestamp": 1_800_000_000 - 5]]])
        #expect(SignInRecency.signedInAt(accessToken: t) == now.addingTimeInterval(-120))
        #expect(SignInRecency.isRecent(accessToken: t, now: now))
        #expect(!SignInRecency.isRecent(accessToken: t, now: now.addingTimeInterval(9 * 60)), "eleven minutes on")
    }

    @Test func onlyARefreshIsNoSignIn() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let refreshed = try token(["amr": [["method": "token_refresh", "timestamp": 1_800_000_000 - 5],
                                           ["method": "password", "timestamp": 1_800_000_000 - 7200]]])
        #expect(SignInRecency.signedInAt(accessToken: refreshed) == now.addingTimeInterval(-7200))
        #expect(!SignInRecency.isRecent(accessToken: refreshed, now: now), "a fresh refresh of an old sign-in")
        let onlyRefresh = try token(["amr": [["method": "token_refresh", "timestamp": 1_800_000_000]]])
        #expect(SignInRecency.signedInAt(accessToken: onlyRefresh) == nil && !SignInRecency.isRecent(accessToken: onlyRefresh, now: now))
        #expect(SignInRecency.signedInAt(accessToken: try token(["sub": "x"])) == nil, "no amr")
        #expect(SignInRecency.signedInAt(accessToken: "not a jwt") == nil)
        #expect(SignInRecency.signedInAt(accessToken: "a.%%%.c") == nil)
        // Apple and links count like a password (and so does a method the app doesn't know).
        for method in ["oauth", "otp", "magiclink", "anything"] {
            #expect(SignInRecency.isRecent(accessToken: try token(["amr": [["method": method, "timestamp": 1_800_000_000 - 60]]]), now: now))
        }
    }
}

/// Where the data key is kept: the data protection keychain unless this build can't write to it.
@Suite struct KeychainChoiceTests {
    @Test func aBuildWithTheKeychainGroupUsesIt() {
        #expect(KeychainAccountKeyStore.usable(read: errSecItemNotFound, write: errSecSuccess))
    }

    /// The sandboxed Developer ID beta: the read passes, the synced write is refused.
    @Test func aReadThatPassesIsNotEnoughWhenTheWriteIsRefused() {
        #expect(!KeychainAccountKeyStore.usable(read: errSecItemNotFound, write: errSecMissingEntitlement))
    }

    /// The unsandboxed download (Developer ID, no profile) and ad-hoc builds.
    @Test func noEntitlementForTheReadMeansTheFallback() {
        #expect(!KeychainAccountKeyStore.usable(read: errSecMissingEntitlement, write: errSecMissingEntitlement))
    }

    /// A locked device or a busy keychain doesn't move the key somewhere else.
    @Test func aMomentaryFailureKeepsTheKeychain() {
        #expect(KeychainAccountKeyStore.usable(read: errSecInteractionNotAllowed, write: errSecInteractionNotAllowed))
        #expect(KeychainAccountKeyStore.usable(read: errSecItemNotFound, write: errSecDuplicateItem))
    }
}
