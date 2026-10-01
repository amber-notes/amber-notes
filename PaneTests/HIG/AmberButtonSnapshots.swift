#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The amber primary button where it's hand-sized: sign-in (ready and busy), the key screens
/// (welcome, recovery, start fresh), and the button on its own, idle, busy and disabled, light and
/// dark. Runs only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/AmberButtonSnapshots`.
@MainActor @Suite(.serialized) struct AmberButtonSnapshots {
    @Test(arguments: [false, true])
    func screens(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let backend = Backend()
        let ready = EmailSignInFlow(step: .signIn(fallback: false), email: "you@example.com", password: "correct horse battery")
        try await AppSnapshotTests.shoot(Self.card(SignInView(backend: backend, flow: ready)), name: "amber-signin-\(mode)", size: CGSize(width: 380, height: 520), dark: dark, toolbar: false)
        let checking = EmailSignInFlow(step: .checking, email: "you@example.com")
        try await AppSnapshotTests.shoot(Self.card(SignInView(backend: backend, flow: checking)), name: "amber-signin-busy-\(mode)", size: CGSize(width: 380, height: 520), dark: dark, toolbar: false)

        // The key screens, reached the way a device reaches them (the key startup tests' fakes).
        for (name, screen) in [("welcome", KeyGateView.Screen.auto), ("recovery", .recovery), ("start-fresh", .startFresh)] {
            let crypto = try await Self.crypto(welcome: name == "welcome")
            try await AppSnapshotTests.shoot(KeyGateView(crypto: crypto, backend: backend, screen: screen), name: "amber-encryption-\(name)-\(mode)", size: CGSize(width: 440, height: 560), dark: dark, toolbar: false)
            crypto.signedOut()
        }

        // The button itself: a row (sign-in, key screens) and a capsule (sheets), idle, busy, disabled.
        let row = { (title: String, busy: Bool, enabled: Bool, role: ButtonRole?) in
            Button(title, role: role) {}.buttonStyle(.amberProminent(height: 36, cornerRadius: 8)).amberBusy(busy).disabled(!enabled)
        }
        let states = VStack(spacing: 12) {
            row("Continue", false, true, nil)
            row("Continue", true, false, nil)
            row("Continue", false, false, nil)
            row("Start fresh", false, true, .destructive)
            row("Start fresh", true, false, .destructive)
            HStack(spacing: 12) {
                Button("Add to my notes") {}.buttonStyle(.amberProminent)
                Button("Add to my notes") {}.buttonStyle(.amberProminent).amberBusy(true).disabled(true)
            }
        }
        .padding(24).frame(width: 340)
        try await AppSnapshotTests.render(states, name: "amber-button-states-\(mode)", dark: dark)
    }

    /// A device with the key and never welcomed (`welcome`), or one whose Keychain holds a key that
    /// isn't the account's (recovery). Background loops are off.
    static func crypto(welcome: Bool) async throws -> AccountCrypto {
        let user = UUID(), keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud())
        let crypto = AccountCrypto(store: keychain, defaults: UserDefaults(suiteName: "amber-shots-\(UUID())")!, sleep: { _ in throw CancellationError() })
        if welcome {
            crypto.adoptForTesting(StoredKey.generate(), account: user)
        } else {
            let server = KeyStartupTests.FakeServer()
            server.row = try StoredKey.generate().serverRow(user: user)
            keychain.synced[user] = StoredKey.generate()
            await crypto.attach(account: user, server: server)
        }
        return crypto
    }

    static func card(_ v: some View) -> some View {
        v.fixedSize().containerBackground(for: .window) { Backdrop() }
    }
}
#endif
