#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The steps between sign-in and the notes (adding this Mac, "No device left?", the recovery key,
/// starting fresh) in the welcome's 900-point card, picture on the left: Emil saw the device link
/// in a tall, narrow window of its own. Each step fits the card's half without spilling, and with
/// PANE_SNAPSHOT_DIR set each is rendered offscreen, light and dark.
@MainActor
@Suite struct KeyGateCardSnapshotTests {
    private struct Server: AccountKeyServer {
        let key: ServerKey?
        func fetch() async throws -> ServerKeyState { ServerKeyState(key: key) }
        func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) { (key, true) }
        func markRecoveryKeySaved() async throws -> Date? { .now }
        func startFresh(keyID: String) async throws -> Bool { false }
    }

    /// An account whose key lives on another device: this Mac waits for it.
    private func waiting() async throws -> AccountCrypto {
        let user = UUID()
        let crypto = AccountCrypto(store: MemoryAccountKeyStore(syncs: true), defaults: UserDefaults(suiteName: "keygate-card-\(UUID())")!)
        await crypto.attach(account: user, server: Server(key: try StoredKey.generate().serverRow(user: user)))
        return crypto
    }

    @Test func everyKeyStepFitsTheCard() async throws {
        let crypto = try await waiting()
        let session = NewDeviceSession(crypto: crypto, server: nil,
                                       preview: .showing(qr: E2EE.addDeviceQR(secret: Data((0x80 ..< 0x90).map { UInt8($0) })), code: "J699-754N-JTBS"))
        let screens: [(String, KeyGateView.Screen)] = [("add-device", .auto), ("no-device", .noDevice), ("recovery", .recovery), ("start-fresh", .startFresh)]
        let card = CGSize(width: WelcomeFlow.size.width, height: WelcomeFlow.size.height + 32)
        for (name, screen) in screens {
            let gate = KeyGateView(crypto: crypto, backend: Backend(), screen: screen, session: session)
            // The step on its own, at its half's width: its natural height has to fit the card.
            let side = NSHostingView(rootView: gate.frame(width: card.width / 2).fixedSize(horizontal: false, vertical: true))
            #expect(side.fittingSize.height <= card.height, "\(name) fits the card (\(side.fittingSize.height) pt)")
            guard let dir = ProcessInfo.processInfo.environment["PANE_SNAPSHOT_DIR"] else { continue }
            for dark in [false, true] {
                let host = NSHostingView(rootView: CardLayout { KeyGateView(crypto: crypto, backend: Backend(), screen: screen, session: session) }
                    .frame(width: card.width, height: card.height))
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                host.frame = CGRect(origin: .zero, size: card)
                host.layoutSubtreeIfNeeded()
                try await Task.sleep(for: .milliseconds(300))
                host.layoutSubtreeIfNeeded()
                let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.cacheDisplay(in: host.bounds, to: rep)
                let png = try #require(rep.representation(using: .png, properties: [:]))
                try png.write(to: URL(fileURLWithPath: dir).appending(path: "keygate-\(name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
}
#endif
