#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// The key screens a device without the account's key sees, and Settings › Security after
/// unlocking with the recovery key, light and dark. Runs only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/KeyFlowSnapshots`.
@MainActor @Suite(.serialized) struct KeyFlowSnapshots {
    @Test(arguments: [false, true])
    func screens(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let backend = Backend()
        let size = CGSize(width: 440, height: 600)

        // Signed in on a device whose Keychain doesn't have the key: the code another device scans
        // (PaneTests/HIG/AddDeviceSnapshots.swift has that screen in full), then the recovery key by choice.
        var (crypto, key) = try await Self.waitingDevice()
        try await AppSnapshotTests.shoot(KeyGateView(crypto: crypto, backend: backend, screen: .recovery), name: "key-no-key-yet-\(mode)", size: size, dark: dark, toolbar: false)
        // "No device left?" then iCloud Keychain: a spinner for a while, then what to check.
        try await AppSnapshotTests.shoot(KeyGateView(crypto: crypto, backend: backend, screen: .keychain), name: "key-wait-icloud-\(mode)", size: size, dark: dark, toolbar: false)
        for _ in 0 ..< 10 { crypto.pollKeychain() }
        try await AppSnapshotTests.shoot(KeyGateView(crypto: crypto, backend: backend, screen: .keychain), name: "key-wait-icloud-help-\(mode)", size: size, dark: dark, toolbar: false)
        crypto.signedOut()

        // Unlocked with the recovery key: Settings › Security says it's saved.
        (crypto, key) = try await Self.waitingDevice()
        try await crypto.recover(typed: key.recoveryText)
        try await AppSnapshotTests.render(Form { PrivacySecuritySection(crypto: crypto) }.formStyle(.grouped).frame(width: 520, height: 420),
                                          name: "privacy-after-recovery-\(mode)", dark: dark)
        crypto.signedOut()
    }

    /// The account has a key on the server; this device's Keychain has none. Background loops off.
    static func waitingDevice() async throws -> (AccountCrypto, StoredKey) {
        let user = UUID(), keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        let crypto = AccountCrypto(store: keychain, defaults: UserDefaults(suiteName: "key-shots-\(UUID())")!, sleep: { _ in throw CancellationError() })
        let server = KeyStartupTests.FakeServer()
        let key = StoredKey.generate()
        server.row = try key.serverRow(user: user)
        await crypto.attach(account: user, server: server)
        return (crypto, key)
    }
}
#endif
