import CryptoKit
import Supabase
import SwiftUI
import Testing
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// The connect journey screen by screen: iPhone at 375 points wide at the default and the largest
/// text size, and the Mac's sheet. Offscreen; runs only when AMBER_HIG_SHOTS is set. Mac:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/ConnectJourneySnapshots`; iPhone: the same
/// test on a simulator (`xcodebuild test -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
/// -only-testing:PaneTests/ConnectJourneySnapshots CODE_SIGNING_ALLOWED=NO`).
@MainActor @Suite(.serialized) struct ConnectJourneySnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }
    static let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")

    static let pageKey = P256.KeyAgreement.PrivateKey().publicKey.x963Representation
    static let scan = ConnectScan(url: URL(string: "ambernotes://connect?request=5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c#s=AbCdEfGhIjKlMnOpQrSt_-&k=\(ConnectScan.base64url(Data(SHA256.hash(data: pageKey))))")!)!

    /// Claude in the computer's browser, the page's code scanned with the phone.
    static let scanned = ConnectRequest(id: UUID(), client_name: "Claude", redirect_host: "claude.ai",
                                        redirect_uri: "https://claude.ai/api/mcp/auth_callback", claimed_name: nil,
                                        loopback: false, wants_write: true, asked: true, started_at: .now.addingTimeInterval(-20),
                                        started_from: "Safari on a Mac", state: "s1", iss: "https://mcp.ambernotes.app",
                                        scan: true, browser_key: pageKey.base64EncodedString())
    /// Signed in on the page for a notification instead: the number to compare.
    static let notified = ConnectRequest(id: UUID(), client_name: "ChatGPT", redirect_host: "chatgpt.com",
                                         redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", claimed_name: nil,
                                         loopback: false, wants_write: true, asked: true, started_at: .now.addingTimeInterval(-20),
                                         started_from: "Chrome on Windows", state: "s1", iss: "https://mcp.ambernotes.app")
    /// An app Amber Notes can't name, by link on this device.
    static let unknown = ConnectRequest(id: UUID(), client_name: "notes-helper.example.com", redirect_host: "notes-helper.example.com",
                                        redirect_uri: "https://notes-helper.example.com/callback", claimed_name: "Notes Helper",
                                        loopback: false, wants_write: true)
    static let match: ConnectMatch.Match = {
        let row = ConnectAskMatch(browser_key: Data(repeating: 4, count: 65).base64EncodedString(), match_commit: String(repeating: "a", count: 64))
        return ConnectMatch.Match(snapshot: ConnectMatch.Snapshot(row)!, row: row, number: "42")
    }()

    static func sheet(_ phase: ConsentSheet.Phase, match: ConnectMatch.Match? = nil, options: Bool = false) -> ConsentSheet {
        ConsentSheet(client: client, requestID: UUID(), initial: phase, finish: { _ in }, scan: scan, previewMatch: match, previewOptions: options)
    }

    static let sheets: [(String, ConsentSheet)] = [
        ("3-allow-scanned", sheet(.asking(scanned))),
        ("4-allow-options", sheet(.asking(scanned), options: true)),
        ("5-allow-notification", sheet(.asking(notified), match: match)),
        ("6-allow-unknown-app", sheet(.asking(unknown))),
        ("7-connected", sheet(.handedOff("claude.ai"))),
    ]

    static func guide(connected: Bool = false) -> some View {
        NavigationStack {
            Form { WebConnectGuide(plan: .claude, client: client, connected: connected) }
                .formStyle(.grouped)
                .navigationTitle("Connect Claude")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
        }
    }

    #if os(iOS)
    static func settings() -> some View {
        NavigationStack {
            Form { ConnectAISection(client: client, preview: []) }
                .formStyle(.grouped)
                .navigationTitle("Settings")
                .navigationBarTitleDisplayMode(.inline)
        }
        .environment(ConnectGuideRoute())
    }

    static func shoot(_ view: some View, _ name: String, size: CGSize, type: DynamicTypeSize, dark: Bool, scene: UIWindowScene, dir: URL) async throws {
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = UIHostingController(rootView: view.dynamicTypeSize(type).tint(Color("AccentColor")))
        window.isHidden = false
        try? await Task.sleep(for: .seconds(1.6))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        window.rootViewController?.dismiss(animated: false)
        window.isHidden = true
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: dir.appending(path: "\(name).png"))
    }

    @Test(arguments: [(DynamicTypeSize.large, false), (.large, true), (.accessibility5, false)])
    func iPhone(_ type: DynamicTypeSize, _ dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let t = (type == .large ? "default" : "largest") + (dark ? "-dark" : "")
        // The largest text gets a tall window, so the whole sheet shows: nothing may be cut short.
        let tall = CGSize(width: 375, height: type == .large ? 812 : 2000)
        let phone = CGSize(width: 375, height: 812)
        try await Self.shoot(Self.settings(), "iphone-1-settings-\(t)", size: phone, type: type, dark: dark, scene: scene, dir: dir)
        try await Self.shoot(NavigationStack { GuideSheet(guide: .claude, client: Self.client) }, "iphone-2a-guide-\(t)", size: phone, type: type, dark: dark, scene: scene, dir: dir)
        // The request arrived: step 2 is the one at hand.
        ConnectCenter.shared.pending = UUID()
        try await Self.shoot(Self.guide(), "iphone-2b-guide-waiting-\(t)", size: phone, type: type, dark: dark, scene: scene, dir: dir)
        ConnectCenter.shared.pending = nil
        try await Self.shoot(Self.guide(connected: true), "iphone-8-guide-connected-\(t)", size: phone, type: type, dark: dark, scene: scene, dir: dir)
        for (name, sheet) in Self.sheets {
            let view = Color(.systemGroupedBackground).ignoresSafeArea().sheet(isPresented: .constant(true)) { sheet.dynamicTypeSize(type) }
            try await Self.shoot(view, "iphone-\(name)-\(t)", size: tall, type: type, dark: dark, scene: scene, dir: dir)
        }
    }
    #endif

    #if os(macOS)
    /// The Mac's sheet, opened by the page's Open Amber Notes on this Mac.
    @Test(arguments: [false, true])
    func mac(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let d = dark ? "dark" : "light"
        try await AppSnapshotTests.render(Self.guide().frame(width: 360, height: 520), name: "mac-2a-guide-\(d)", dark: dark, wait: 1.4)
        ConnectCenter.shared.pending = UUID()
        try await AppSnapshotTests.render(Self.guide().frame(width: 360, height: 520), name: "mac-2b-guide-waiting-\(d)", dark: dark, wait: 1.4)
        ConnectCenter.shared.pending = nil
        for (name, sheet) in Self.sheets {
            try await AppSnapshotTests.render(sheet, name: "mac-\(name)-\(d)", dark: dark, wait: 1.4)
        }
        try await AppSnapshotTests.render(Self.guide(connected: true).frame(width: 360, height: 520), name: "mac-8-guide-connected-\(d)", dark: dark, wait: 1.4)
    }
    #endif
}
