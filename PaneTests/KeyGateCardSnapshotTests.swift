#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The steps between sign-in and the notes (adding this Mac, "No device left?", the recovery key,
/// starting fresh) in the welcome's 900-point card, picture on the left: Emil saw the device link
/// in a tall, narrow window of its own. Each step fits the card's half without spilling, and with
/// PANE_SNAPSHOT_DIR (or the snapshot run's AMBER_HIG_SHOTS) set each is rendered offscreen, light
/// and dark. The recovery key, the start-fresh phrase and its password are one plain field each,
/// drawn like the sign-in screen's: the pictures are where a box inside the box would show.
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
        // Start fresh twice: with no notes on this Mac, and with notes it keeps (a longer message).
        let screens: [(String, KeyGateView.Screen, Int)] = [("add-device", .auto, 0), ("no-device", .noDevice, 0), ("recovery", .recovery, 0),
                                                            ("start-fresh", .startFresh, 0), ("start-fresh-notes", .startFresh, 113)]
        let card = CGSize(width: WelcomeFlow.size.width, height: WelcomeFlow.size.height + 32)
        for (name, screen, notesHere) in screens {
            let gate = KeyGateView(crypto: crypto, backend: Backend(), screen: screen, session: session, notesHere: notesHere)
            // The step on its own, at its half's width: its natural height has to fit the card.
            let side = NSHostingView(rootView: gate.frame(width: card.width / 2).fixedSize(horizontal: false, vertical: true))
            #expect(side.fittingSize.height <= card.height, "\(name) fits the card (\(side.fittingSize.height) pt)")
            // PANE_SNAPSHOT_DIR by hand, AMBER_HIG_SHOTS on a pull request labelled "snapshots".
            let env = ProcessInfo.processInfo.environment
            guard let dir = env["PANE_SNAPSHOT_DIR"] ?? env["AMBER_HIG_SHOTS"] else { continue }
            for dark in [false, true] {
                let host = NSHostingView(rootView: CardLayout { KeyGateView(crypto: crypto, backend: Backend(), screen: screen, session: session, notesHere: notesHere) }
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
