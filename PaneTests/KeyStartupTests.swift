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
        private(set) var syncedWrites = 0

        init(cloud: Cloud, autoReceive: Bool = true) {
            self.cloud = cloud
            self.autoReceive = autoReceive
        }

        func receive() { synced.merge(cloud.keys) { _, new in new } }

        func load(account: UUID, slot: KeySlot) -> StoredKey? {
            guard slot == .synced else { return pending[account] }
            loads += 1
            if autoReceive || receiveAfterLoads.map({ loads > $0 }) == true { receive() }
            return synced[account]
        }

        func save(_ key: StoredKey, account: UUID, slot: KeySlot) -> Bool {
            if slot == .pending { pending[account] = key; return true }
            syncedWrites += 1
            synced[account] = key
            cloud.keys[account] = key
            return true
        }

        func remove(account: UUID, slot: KeySlot) {
            if slot == .pending { pending[account] = nil } else { synced[account] = nil; cloud.keys[account] = nil }
        }
    }

    final class FakeServer: AccountKeyServer, @unchecked Sendable {
        var row: ServerKey?
        var offline = false
        /// The insert lands but the answer is lost.
        var loseCreateResponse = false
        private(set) var creates = 0
        private(set) var startedFresh: [String] = []

        func fetch() async throws -> ServerKey? {
            if offline { throw URLError(.notConnectedToInternet) }
            return row
        }

        func create(_ key: ServerKey) async throws -> (key: ServerKey, created: Bool) {
            if offline { throw URLError(.notConnectedToInternet) }
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
            startedFresh.append(keyID)
            guard row?.key_id == keyID else { return false }
            row = nil
            return true
        }
    }

    let user = UUID()
    let cloud = Cloud()
    let server = FakeServer()
    let defaults = UserDefaults(suiteName: "key-startup-\(UUID())")!

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
        #expect(KeyStartup.decide(user: user, synced: nil, pending: nil, server: .none) == .create)
        #expect(KeyStartup.decide(user: user, synced: other, pending: nil, server: .none) == .create)
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
        let (crypto, _) = device(keychain, sleep: { _ in await Task.yield() })
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
        crypto.signedOut()
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
        func fetch() async throws -> ServerKey? { try await inner.fetch() }
        func create(_ key: ServerKey) async throws -> (key: ServerKey, created: Bool) {
            if let between { self.between = nil; await between() }
            return try await inner.create(key)
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
        let (crypto, keychain) = device(sleep: { _ in await Task.yield() })
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
        let (crypto, keychain) = device(sleep: { _ in await Task.yield() })
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

    @Test func theServersKeyGoneMidwayMakesANewOne() async throws {
        let k = try existingKey()
        let (crypto, keychain) = device()
        keychain.synced[user] = k
        await crypto.attach(account: user, server: server)
        server.row = nil
        await crypto.recheck()
        #expect(crypto.phase == .ready && keychain.synced[user] != k)
        #expect(keychain.synced[user]!.matches(server.row!, user: user))
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
