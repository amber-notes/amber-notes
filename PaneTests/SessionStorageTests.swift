import Foundation
import Testing
@testable import Pane

@Suite struct SessionStorageTests {
    #if os(macOS)
    /// Unsigned test builds use the file fallback: it must be owner-only from the start.
    @Test func fallbackFileIsOwnerOnlyAndRoundTrips() throws {
        let storage = SessionStorage()
        let key = "test-\(UUID().uuidString)"
        let secret = Data("refresh-token-\(UUID())".utf8)
        try storage.store(key: key, value: secret)
        defer { try? storage.remove(key: key) }
        #expect(try storage.retrieve(key: key) == secret)
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane")
        let file = dir.appending(path: "session-\(key).bin")
        if FileManager.default.fileExists(atPath: file.path) {
            let mode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int
            #expect(mode == 0o600)
        }
        // Overwriting keeps it private too.
        try storage.store(key: key, value: Data("second".utf8))
        #expect(try storage.retrieve(key: key) == Data("second".utf8))
        if FileManager.default.fileExists(atPath: file.path) {
            #expect((try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int) == 0o600)
        }
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".tmp") }
        #expect(leftovers.isEmpty)
    }
    #endif

    // MARK: A Keychain item that can't be changed

    /// A Keychain in memory that can be told to refuse, as the real one did on the Mac download
    /// after the update to 1.2 (-34018 on every delete).
    final class FakeKeychain: SessionKeychain, @unchecked Sendable {
        var items: [String: Data] = [:]
        var refusesDelete = false
        var refusesUpdate = false
        var refusesAdd = false
        func read(_ key: String) -> (status: OSStatus, data: Data?) { items[key].map { (errSecSuccess, $0) } ?? (errSecItemNotFound, nil) }
        func add(_ key: String, _ value: Data) -> OSStatus {
            if refusesAdd { return errSecMissingEntitlement }
            guard items[key] == nil else { return errSecDuplicateItem }
            items[key] = value
            return errSecSuccess
        }
        func update(_ key: String, _ value: Data) -> OSStatus {
            guard items[key] != nil else { return errSecItemNotFound }
            if refusesUpdate { return errSecMissingEntitlement }
            items[key] = value
            return errSecSuccess
        }
        func delete(_ key: String) -> OSStatus {
            guard items[key] != nil else { return errSecItemNotFound }
            if refusesDelete { return errSecMissingEntitlement }
            items[key] = nil
            return errSecSuccess
        }
    }

    final class Folder {
        let url = FileManager.default.temporaryDirectory.appending(path: "session-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        deinit { try? FileManager.default.removeItem(at: url) }
        func has(_ name: String) -> Bool { FileManager.default.fileExists(atPath: url.appending(path: name).path) }
    }

    let key = "sb-test-auth-token"
    let old = Data("the session an earlier version saved".utf8)
    let fresh = Data("the session as it is now".utf8)

    @Test func aWorkingKeychainHoldsTheSessionAndNoFileIsLeft() throws {
        let keychain = FakeKeychain(), folder = Folder()
        let storage = SessionStorage(keychain: keychain, directory: folder.url)
        try storage.store(key: key, value: old)
        try storage.store(key: key, value: fresh)
        #expect(keychain.items[key] == fresh)
        #expect(try storage.retrieve(key: key) == fresh)
        #expect(!folder.has("session-\(key).bin") && !folder.has("session-\(key).dead"))
        try storage.remove(key: key)
        #expect(keychain.items[key] == nil)
        #expect(try storage.retrieve(key: key) == nil)
    }

    /// The bug in Mac 1.2: the item an earlier version wrote can be read and can't be changed or
    /// deleted. Sign Out removed the file, the item stayed, and the next read signed in again.
    @Test func signingOutStaysSignedOutWhenTheItemCantBeDeleted() throws {
        let keychain = FakeKeychain(), folder = Folder()
        keychain.items[key] = old
        keychain.refusesDelete = true
        keychain.refusesUpdate = true
        let storage = SessionStorage(keychain: keychain, directory: folder.url)
        #expect(try storage.retrieve(key: key) == old, "until something is refused, the item is the session")

        // A refreshed session: the Keychain won't take it, the file does, and the file is what's read.
        try storage.store(key: key, value: fresh)
        #expect(keychain.items[key] == old)
        #expect(try storage.retrieve(key: key) == fresh, "the newest, never the item that couldn't be replaced")

        // Sign out.
        try storage.remove(key: key)
        #expect(keychain.items[key] == old, "still there: it can't be removed")
        #expect(try storage.retrieve(key: key) == nil, "and never read again")
        // The next launch too.
        let relaunched = SessionStorage(keychain: keychain, directory: folder.url)
        #expect(try relaunched.retrieve(key: key) == nil)

        // Signing in again works, and is what the launch after that finds.
        let again = Data("a new sign-in".utf8)
        try relaunched.store(key: key, value: again)
        #expect(try SessionStorage(keychain: keychain, directory: folder.url).retrieve(key: key) == again)
        try relaunched.remove(key: key)
        #expect(try SessionStorage(keychain: keychain, directory: folder.url).retrieve(key: key) == nil)
    }

    /// A Mac already in that state when the fix arrives: the old item in the Keychain, the session
    /// in the file, and no mark yet.
    @Test func theFileWinsOverAnItemLeftFromBefore() throws {
        let keychain = FakeKeychain(), folder = Folder()
        keychain.items[key] = old
        try FileManager.default.createDirectory(at: folder.url, withIntermediateDirectories: true)
        try fresh.write(to: folder.url.appending(path: "session-\(key).bin"))
        keychain.refusesDelete = true
        keychain.refusesUpdate = true
        let storage = SessionStorage(keychain: keychain, directory: folder.url)
        #expect(try storage.retrieve(key: key) == fresh)
        try storage.remove(key: key)
        #expect(try storage.retrieve(key: key) == nil)
        #expect(try SessionStorage(keychain: keychain, directory: folder.url).retrieve(key: key) == nil)
    }

    /// Deleting is refused but changing isn't: the item is replaced in place, and Sign Out empties it.
    @Test func anItemThatCantBeDeletedIsChangedInPlaceAndEmptiedOnSignOut() throws {
        let keychain = FakeKeychain(), folder = Folder()
        keychain.items[key] = old
        keychain.refusesDelete = true
        let storage = SessionStorage(keychain: keychain, directory: folder.url)
        try storage.store(key: key, value: fresh)
        #expect(keychain.items[key] == fresh && !folder.has("session-\(key).bin"))
        try storage.remove(key: key)
        #expect(keychain.items[key] == Data(), "no token is left in it")
        // Even with the mark gone, an emptied item is no session.
        try FileManager.default.removeItem(at: folder.url.appending(path: "session-\(key).dead"))
        #expect(try storage.retrieve(key: key) == nil)
    }

    @Test func aKeychainThatWorksAgainTakesTheSessionBack() throws {
        let keychain = FakeKeychain(), folder = Folder()
        keychain.items[key] = old
        keychain.refusesDelete = true
        keychain.refusesUpdate = true
        let storage = SessionStorage(keychain: keychain, directory: folder.url)
        try storage.store(key: key, value: fresh)
        #expect(folder.has("session-\(key).bin") && folder.has("session-\(key).dead"))
        keychain.refusesDelete = false
        keychain.refusesUpdate = false
        let newer = Data("after the Keychain came back".utf8)
        try storage.store(key: key, value: newer)
        #expect(keychain.items[key] == newer)
        #expect(try storage.retrieve(key: key) == newer)
        #expect(!folder.has("session-\(key).bin") && !folder.has("session-\(key).dead"))
    }

    /// The Keychain takes nothing at all (a locked device, a build it won't serve): the file is the session.
    @Test func aKeychainThatRefusesEverythingLeavesTheSessionInTheFile() throws {
        let keychain = FakeKeychain(), folder = Folder()
        keychain.refusesAdd = true
        let storage = SessionStorage(keychain: keychain, directory: folder.url)
        try storage.store(key: key, value: fresh)
        #expect(try storage.retrieve(key: key) == fresh)
        try storage.remove(key: key)
        #expect(try storage.retrieve(key: key) == nil)
    }

    /// `-sessionFault stuck`, for walking this on a device: development builds only, and its
    /// stand-in Keychain behaves like the one in the bug.
    @Test func theSessionFaultSwitchIsForDevelopmentBuildsOnly() throws {
        #expect(SessionFault.from(["Pane", "-sessionFault", "stuck"], development: true) == .stuck)
        #expect(SessionFault.from(["Pane", "-sessionFault", "stuck"], development: false) == nil)
        #expect(SessionFault.from(["Pane", "-sessionFault"], development: true) == nil)
        #expect(SessionFault.from(["Pane", "-sessionFault", "other"], development: true) == nil)
        #expect(SessionFault.active == nil)

        let folder = Folder()
        let stuck = SessionFault.stuck.keychain(in: folder.url)
        #expect(stuck.add(key, old) == errSecSuccess && stuck.add(key, fresh) == errSecDuplicateItem)
        #expect(stuck.update(key, fresh) == errSecMissingEntitlement && stuck.delete(key) == errSecMissingEntitlement)
        // Still there at the next launch.
        #expect(SessionFault.stuck.keychain(in: folder.url).read(key).data == old)
        let storage = SessionStorage(keychain: SessionFault.stuck.keychain(in: folder.url), directory: folder.url)
        try storage.store(key: key, value: fresh)
        #expect(try storage.retrieve(key: key) == fresh)
        try storage.remove(key: key)
        #expect(try SessionStorage(keychain: SessionFault.stuck.keychain(in: folder.url), directory: folder.url).retrieve(key: key) == nil)
    }
}
