import CryptoKit
import SwiftUI
import Testing
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// Add a device, screen by screen: the new device's code, the other ways in, the approving
/// device's scanner, question and "Added", and "Where your key is kept" in Settings › Security.
/// iPhone at 375 points wide at the default and the largest text size, light and dark; the Mac's
/// window and sheets, light and dark. Offscreen; runs only when AMBER_HIG_SHOTS is set. Mac:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/AddDeviceSnapshots`; iPhone: the
/// same test on a simulator (`xcodebuild test -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
/// -only-testing:PaneTests/AddDeviceSnapshots CODE_SIGNING_ALLOWED=NO`).
@MainActor @Suite(.serialized) struct AddDeviceSnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }

    static let qr = E2EE.addDeviceQR(secret: Data((0x80 ..< 0x90).map { UInt8($0) }))
    static let code = "J699-754N-JTBS"

    /// A Mac asking to be added, as the approving device shows it once its code was read.
    static let mac = AddDeviceApproval.Candidate(id: UUID(), name: "Sara\u{2019}s MacBook Air", platform: "macos", publicKey: Data(), askedAt: .now,
                                                 answer: "", bind: Data())
    static let iPhone = AddDeviceApproval.Candidate(id: UUID(), name: "iPhone", platform: "ios", publicKey: Data(), askedAt: .now, answer: "", bind: Data())

    /// Signed in, the account has a key, this device doesn't. Background loops off.
    static func waiting() async throws -> AccountCrypto {
        let user = UUID(), keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        let crypto = AccountCrypto(store: keychain, defaults: UserDefaults(suiteName: "add-device-shots-\(UUID())")!, sleep: { _ in throw CancellationError() })
        let server = KeyStartupTests.FakeServer()
        server.row = try StoredKey.generate().serverRow(user: user)
        await crypto.attach(account: user, server: server)
        return crypto
    }

    /// A device with the key. `backedUp`: it keeps the key in iCloud Keychain.
    static func ready(backedUp: Bool, recoverySaved: Bool = false) async throws -> AccountCrypto {
        let keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud())
        keychain.syncs = backedUp
        let crypto = AccountCrypto(store: keychain, defaults: UserDefaults(suiteName: "add-device-shots-\(UUID())")!, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: UUID(), server: KeyStartupTests.FakeServer())
        crypto.welcomeShown()
        if recoverySaved { try await crypto.markRecoveryKeySaved() }
        return crypto
    }

    static func gate(_ crypto: AccountCrypto, _ screen: KeyGateView.Screen = .auto, _ state: NewDeviceSession.State? = nil) -> KeyGateView {
        KeyGateView(crypto: crypto, backend: Backend(), screen: screen,
                    session: NewDeviceSession(crypto: crypto, server: nil, preview: state ?? .showing(qr: qr, code: code)))
    }

    static func sheet(_ crypto: AccountCrypto, _ phase: AddDeviceSheet.Phase = .reading, typing: Bool? = nil, problem: String? = nil) -> AddDeviceSheet {
        AddDeviceSheet(crypto: crypto, server: nil, initial: phase, typing: typing, camera: .on, previewProblem: problem)
    }

    /// The list as a device with the key sees it: one Mac added from here.
    static func devices(_ others: [KeyDevice]) -> KeyDevices {
        let d = KeyDevices(device: UUID(), identity: DeviceIdentity(store: MemoryDeviceIdentityStore()))
        d.setForTesting(others)
        return d
    }

    static let added = KeyDevice(id: UUID(), name: "Sara\u{2019}s MacBook Air", platform: "macos", how: .added, backedUp: false,
                                 addedAt: .now.addingTimeInterval(-6 * 86400), seenAt: .now, removing: false)
    /// A second iPhone, which the system only calls "iPhone", not seen for six weeks.
    static let stale = KeyDevice(id: UUID(), name: "iPhone", platform: "ios", how: .keychain, backedUp: true,
                                 addedAt: .now.addingTimeInterval(-200 * 86400), seenAt: .now.addingTimeInterval(-44 * 86400), removing: false)

    #if os(iOS)
    static func privacy(_ crypto: AccountCrypto, _ devices: KeyDevices) -> some View {
        NavigationStack { PrivacySecurityView(crypto: crypto, devices: devices) }
    }

    @Test(arguments: [(DynamicTypeSize.large, false), (.large, true), (.accessibility5, false)])
    func iPhone(_ type: DynamicTypeSize, _ dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let t = (type == .large ? "default" : "largest") + (dark ? "-dark" : "")
        // The largest text gets a tall window, so the whole screen shows: nothing may be cut short.
        let size = CGSize(width: 375, height: type == .large ? 812 : 2400)
        func shoot(_ view: some View, _ name: String) async throws {
            try await ConnectJourneySnapshots.shoot(view, "iphone-\(name)-\(t)", size: size, type: type, dark: dark, scene: scene, dir: dir)
        }
        func sheet(_ s: AddDeviceSheet) -> some View {
            Color(.systemGroupedBackground).ignoresSafeArea().sheet(isPresented: .constant(true)) { s.dynamicTypeSize(type) }
        }
        // The new device.
        let new = try await Self.waiting()
        try await shoot(Self.gate(new), "1-new-device-code")
        try await shoot(Self.gate(new, .auto, .expired), "1b-new-device-code-expired")
        try await shoot(Self.gate(new, .noDevice), "2-no-device-left")
        try await shoot(Self.gate(new, .recovery), "3-recovery-key")
        try await shoot(Self.gate(new, .startFresh), "4-start-fresh")
        new.signedOut()
        // The device that has the key.
        let old = try await Self.ready(backedUp: true)
        try await shoot(sheet(Self.sheet(old)), "5-add-scan")
        try await shoot(sheet(Self.sheet(old, typing: true)), "6-add-type-code")
        try await shoot(sheet(Self.sheet(old, typing: true, problem: AddDeviceError.notFound.localizedDescription)), "6b-add-code-not-found")
        try await shoot(sheet(Self.sheet(old, .confirm(Self.mac))), "7-add-this-mac")
        try await shoot(sheet(Self.sheet(old, .confirm(Self.iPhone))), "7b-add-this-iphone")
        try await shoot(sheet(Self.sheet(old, .done(Self.mac))), "8-added")
        // Settings › Security: where the key is kept. Safe on evidence (a device seen lately),
        // can't confirm (only a Keychain item, and a phone not seen for weeks), only this device.
        try await shoot(Self.privacy(old, Self.devices([Self.added, Self.stale])), "9-key-kept-safe")
        try await shoot(Self.privacy(old, Self.devices([Self.stale])), "9b-key-cant-confirm")
        old.signedOut()
        let alone = try await Self.ready(backedUp: false)
        try await shoot(Self.privacy(alone, Self.devices([])), "10-key-only-this-device")
        alone.signedOut()
    }
    #endif

    #if os(macOS)
    static func privacy(_ crypto: AccountCrypto, _ devices: KeyDevices) -> some View {
        Form { PrivacySecuritySection(crypto: crypto, devices: devices) }.formStyle(.grouped).frame(width: 520)
    }

    @Test(arguments: [false, true])
    func mac(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let d = dark ? "dark" : "light"
        let window = CGSize(width: 440, height: 680)
        let new = try await Self.waiting()
        try await AppSnapshotTests.shoot(Self.gate(new), name: "mac-1-new-device-code-\(d)", size: window, dark: dark, toolbar: false)
        try await AppSnapshotTests.shoot(Self.gate(new, .auto, .expired), name: "mac-1b-new-device-code-expired-\(d)", size: window, dark: dark, toolbar: false)
        try await AppSnapshotTests.shoot(Self.gate(new, .noDevice), name: "mac-2-no-device-left-\(d)", size: window, dark: dark, toolbar: false)
        try await AppSnapshotTests.shoot(Self.gate(new, .recovery), name: "mac-3-recovery-key-\(d)", size: window, dark: dark, toolbar: false)
        try await AppSnapshotTests.shoot(Self.gate(new, .startFresh), name: "mac-4-start-fresh-\(d)", size: window, dark: dark, toolbar: false)
        new.signedOut()
        let old = try await Self.ready(backedUp: true)
        try await AppSnapshotTests.render(Self.sheet(old), name: "mac-6-add-type-code-\(d)", dark: dark, wait: 1.2)
        try await AppSnapshotTests.render(Self.sheet(old, problem: AddDeviceError.notFound.localizedDescription), name: "mac-6b-add-code-not-found-\(d)", dark: dark, wait: 1.2)
        try await AppSnapshotTests.render(Self.sheet(old, .confirm(Self.iPhone)), name: "mac-7-add-this-iphone-\(d)", dark: dark, wait: 1.2)
        try await AppSnapshotTests.render(Self.sheet(old, .confirm(Self.mac)), name: "mac-7b-add-this-mac-\(d)", dark: dark, wait: 1.2)
        try await AppSnapshotTests.render(Self.sheet(old, .done(Self.iPhone)), name: "mac-8-added-\(d)", dark: dark, wait: 1.2)
        try await AppSnapshotTests.render(Self.privacy(old, Self.devices([Self.added, Self.stale])), name: "mac-9-key-kept-safe-\(d)", dark: dark, wait: 1.2)
        try await AppSnapshotTests.render(Self.privacy(old, Self.devices([Self.stale])), name: "mac-9b-key-cant-confirm-\(d)", dark: dark, wait: 1.2)
        old.signedOut()
        let alone = try await Self.ready(backedUp: false)
        try await AppSnapshotTests.render(Self.privacy(alone, Self.devices([])), name: "mac-10-key-only-this-device-\(d)", dark: dark, wait: 1.2)
        alone.signedOut()
    }
    #endif
}
