import SwiftUI
import Testing
import Supabase
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// The connect journey on iPhone, screen by screen, for each design in the tasting menu
/// (`ConnectDesign`), light and dark. Offscreen; runs only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path xcodebuild test -scheme Pane -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
/// -only-testing:PaneTests/ConnectJourneySnapshots CODE_SIGNING_ALLOWED=NO`.
@MainActor @Suite(.serialized) struct ConnectJourneySnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }

    #if os(iOS)
    static let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")

    /// Emil's case: Claude in his computer's browser, approved on the phone.
    static let asked = ConnectRequest(id: UUID(), client_name: "claude.ai", redirect_host: "claude.ai",
                                      redirect_uri: "https://claude.ai/api/mcp/auth_callback", claimed_name: "Claude",
                                      loopback: false, wants_write: true, asked: true, started_at: .now.addingTimeInterval(-20),
                                      started_from: "Chrome on a Mac", state: "s1", iss: "https://mcp.ambernotes.app")
    /// An app Amber Notes can't name, by link on this device.
    static let unknown = ConnectRequest(id: UUID(), client_name: "notes-helper.example.com", redirect_host: "notes-helper.example.com",
                                        redirect_uri: "https://notes-helper.example.com/callback", claimed_name: "Notes Helper",
                                        loopback: false, wants_write: true)

    static let match: ConnectMatch.Match = {
        let row = ConnectAskMatch(browser_key: Data(repeating: 4, count: 65).base64EncodedString(), match_commit: String(repeating: "a", count: 64))
        return ConnectMatch.Match(snapshot: ConnectMatch.Snapshot(row)!, row: row, number: "42")
    }()

    static let claudeConnection = Connection(id: UUID(), name: "Claude", kind: "oauth", can_write: true, created_at: .now.addingTimeInterval(-60),
                                             last_used_at: nil, revoked_at: nil, redirect_host: "claude.ai")

    static func settings(_ design: ConnectDesign, connected: Bool) -> some View {
        NavigationStack {
            Form {
                ConnectAISection(client: client, preview: connected ? [claudeConnection] : [], design: design)
            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
        .environment(ConnectGuideRoute())
    }

    /// The consent sheet as it's presented: a real sheet over Settings.
    static func sheet(_ design: ConnectDesign, _ phase: ConsentSheet.Phase, match: ConnectMatch.Match?, typed: String = "") -> some View {
        settings(design, connected: false)
            .sheet(isPresented: .constant(true)) {
                ConsentSheet(client: client, requestID: UUID(), initial: phase, finish: { _ in }, design: design,
                             previewMatch: match, previewTyped: typed)
            }
    }

    static func shoot(_ view: some View, _ name: String, dark: Bool, scene: UIWindowScene, dir: URL) async throws {
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: CGSize(width: 402, height: 874))
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = UIHostingController(rootView: view.tint(Color("AccentColor")))
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
        try #require(image.pngData()).write(to: dir.appending(path: "\(name)-\(dark ? "dark" : "light").png"))
    }

    @Test(arguments: ConnectDesign.allCases)
    func journey(_ design: ConnectDesign) async throws {
        guard let dir = Self.dir else { return }
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let d = design.rawValue
        for dark in [false, true] {
            try await Self.shoot(Self.settings(design, connected: false), "\(d)-1-settings", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(NavigationStack { GuideSheet(guide: .claude, client: Self.client, design: design) }, "\(d)-2-guide", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(Self.sheet(design, .asking(Self.asked), match: Self.match), "\(d)-3-approve", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(Self.sheet(design, .asking(Self.asked), match: Self.match, typed: "4"), "\(d)-4-approve-typing", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(Self.sheet(design, .asking(Self.unknown), match: nil), "\(d)-5-approve-unknown-app", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(Self.sheet(design, .handedOff("claude.ai"), match: nil), "\(d)-6-allowed", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(NavigationStack { GuideSheet(guide: .claude, client: Self.client, design: design, previewConnected: true) },
                                 "\(d)-7-guide-connected", dark: dark, scene: scene, dir: dir)
            try await Self.shoot(Self.settings(design, connected: true), "\(d)-8-settings-connected", dark: dark, scene: scene, dir: dir)
        }
    }
    #endif
}
