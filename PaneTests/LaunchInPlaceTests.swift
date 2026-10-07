#if os(macOS)
import AppKit
import Foundation
import Supabase
import Testing
@testable import Pane

/// Emil, dev build with #251: "when I open the new build it shows up on one screen, starts
/// flashing because it loads state, and then moves back to where it was last time." A signed-in
/// launch drew the card, then the key check, then the notes, then moved the window to where the
/// notes were. Now the session and the key this device kept are read before anything is drawn,
/// and the window is shaped before it's first shown.
@MainActor @Suite struct LaunchInPlaceTests {
    final class MemoryAuthStorage: AuthLocalStorage, @unchecked Sendable {
        private var items: [String: Data] = [:]
        func store(key: String, value: Data) throws { items[key] = value }
        func retrieve(key: String) throws -> Data? { items[key] }
        func remove(key: String) throws { items[key] = nil }
    }

    private struct Server: AccountKeyServer {
        let key: ServerKey?
        func fetch() async throws -> ServerKeyState { ServerKeyState(key: key) }
        func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) { (key, true) }
        func markRecoveryKeySaved() async throws -> Date? { .now }
        func startFresh(keyID: String) async throws -> Bool { false }
    }

    private static func session(_ user: UUID) -> Session {
        Session(accessToken: "access", tokenType: "bearer", expiresIn: 3600, expiresAt: Date.now.timeIntervalSince1970 + 3600,
                refreshToken: "refresh",
                user: User(id: user, appMetadata: [:], userMetadata: [:], aud: "authenticated", email: "sara@example.com",
                           createdAt: .now, updatedAt: .now))
    }

    @Test func theSessionKeyIsTheClientsOwn() {
        #expect(Backend.sessionKey(URL(string: "https://rodegaeruhyybqilrnpn.supabase.co")!) == "sb-rodegaeruhyybqilrnpn-auth-token")
    }

    /// Stored the way the Supabase client stores it (plain JSONEncoder, after its migrations).
    @Test func aKeptSessionIsSignedInBeforeTheFirstFrame() throws {
        let user = UUID()
        let storage = MemoryAuthStorage()
        try storage.store(key: "sb-x-auth-token", value: JSONEncoder().encode(Self.session(user)))
        let backend = Backend()
        var adopted: UUID?
        backend.willSignIn = { adopted = $0 }
        #expect(backend.restore(from: storage, key: "sb-x-auth-token") == user)
        #expect(backend.state == .signedIn(email: "sara@example.com"))
        #expect(backend.userID == user)
        #expect(adopted == user, "the library is handed to the account first, as at any sign-in")
    }

    @Test func noKeptSessionChangesNothing() {
        let backend = Backend()
        let before = backend.state
        #expect(backend.restore(from: MemoryAuthStorage(), key: "sb-x-auth-token") == nil)
        #expect(backend.state == before)
    }

    private func crypto(holding key: StoredKey?, for user: UUID, welcomed: Bool) -> AccountCrypto {
        let store = MemoryAccountKeyStore(syncs: true)
        if let key { store.save(key, account: user, slot: .synced) }
        let defaults = UserDefaults(suiteName: "launch-in-place-\(UUID())")!
        if welcomed { defaults.set(true, forKey: "e2ee.welcomed.\(user.uuidString.lowercased())") }
        return AccountCrypto(store: store, defaults: defaults)
    }

    @Test func theKeyHereOpensTheNotesWithNoGateInBetween() async throws {
        let user = UUID()
        let key = try StoredKey.generate()
        let crypto = crypto(holding: key, for: user, welcomed: true)
        let backend = Backend()
        _ = backend.restore(from: { let s = MemoryAuthStorage(); try? s.store(key: "k", value: JSONEncoder().encode(Self.session(user))); return s }(), key: "k")
        #expect(crypto.openHeld(account: user))
        #expect(crypto.phase == .ready)
        #expect(!AppGate.keyGateShown(crypto: crypto, backend: backend), "no key screen on the first frame")
        #expect(!AppGate.cardShown(crypto: crypto, backend: backend), "the notes window, not the card")
        // The quiet check with the server afterwards: the key stays open throughout.
        await crypto.attach(account: user, server: Server(key: try key.serverRow(user: user)))
        #expect(crypto.phase == .ready)
        #expect(!AppGate.keyGateShown(crypto: crypto, backend: backend))
    }

    @Test func aKeyReplacedOnTheServerStillBringsTheGate() async throws {
        let user = UUID()
        let crypto = crypto(holding: try StoredKey.generate(), for: user, welcomed: true)
        #expect(crypto.openHeld(account: user))
        await crypto.attach(account: user, server: Server(key: try StoredKey.generate().serverRow(user: user)))
        #expect(crypto.phase != .ready)
    }

    @Test func noKeyHereMeansTheGateAsBefore() {
        let user = UUID()
        let crypto = crypto(holding: nil, for: user, welcomed: true)
        #expect(!crypto.openHeld(account: user))
        #expect(crypto.phase == .off)
    }

    @Test func theFirstWelcomeOfTheKeyStillShowsOnce() throws {
        let user = UUID()
        let crypto = crypto(holding: try StoredKey.generate(), for: user, welcomed: false)
        #expect(crypto.openHeld(account: user))
        #expect(crypto.needsWelcome)
    }

    /// The window has its frame (the saved notes frame) as soon as the view joins it, before it's
    /// drawn, and is see-through until then. Off screen, borderless, never ordered front.
    @Test func theWindowIsShapedBeforeItsFirstFrame() async {
        let saved = CGRect(x: -20000, y: -20000, width: 1300, height: 820)
        let window = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 1180, height: 760),
                              styleMask: [.borderless], backing: .buffered, defer: true)
        let view = ShaperView()
        view.shape = { $0.setFrame(saved, display: false) }
        window.contentView = NSView()
        window.contentView?.addSubview(view)
        #expect(window.frame == saved, "shaped synchronously, in viewDidMoveToWindow")
        #expect(window.alphaValue == 0, "hidden while it's shaped")
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(50))
        #expect(window.alphaValue == 1)
    }
}
#endif
