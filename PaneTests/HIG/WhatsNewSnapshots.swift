import SwiftUI
import Testing
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// The What's new card for 1.1, with each quiet button, light and dark. Offscreen: nothing touches
/// the screen. Runs only when AMBER_HIG_SHOTS is set. Mac: `TEST_RUNNER_AMBER_HIG_SHOTS=/path
/// scripts/qa-test.sh PaneTests/WhatsNewSnapshots`; iPhone: the same test on a simulator (see the test).
@MainActor @Suite(.serialized) struct WhatsNewSnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }

    static var v11: WhatsNew.Release {
        get throws { try #require(WhatsNew.bundled.first { $0.version == "1.1" }) }
    }

    static func card(_ release: WhatsNew.Release, _ secondary: WhatsNew.Secondary) -> WhatsNewCard {
        WhatsNewCard(release: release, secondary: secondary, animated: false, onDismiss: {}, onReconnect: {})
    }

    static let cases: [(String, WhatsNew.Secondary)] = [("changelog", .changelog), ("reconnect", .reconnect)]

    #if os(macOS)
    @Test(arguments: [false, true])
    func mac(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let release = try Self.v11
        for (name, secondary) in Self.cases {
            // The note list's width, in its margins, on the list's ground.
            let view = Self.card(release, secondary)
                .frame(width: 310)
                .padding(10)
                .background(Color(Palette.listGround))
                .tint(Color("AccentColor"))
            try await AppSnapshotTests.render(view, name: "mac-whatsnew-\(name)-\(dark ? "dark" : "light")", dark: dark)
        }
    }
    #endif

    #if os(iOS)
    /// On an iPhone simulator (no Simulator window needed):
    /// `TEST_RUNNER_AMBER_HIG_SHOTS=/path xcodebuild test -scheme Pane -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
    /// -only-testing:PaneTests/WhatsNewSnapshots CODE_SIGNING_ALLOWED=NO`.
    @Test func iPhone() async throws {
        guard let dir = Self.dir else { return }
        let release = try Self.v11
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let size = CGSize(width: 402, height: 500)
        for (name, secondary) in Self.cases {
            for dark in [false, true] {
                // As the note list shows it: its own grouped section, on the row surface.
                let list = List {
                    Section {
                        Self.card(release, secondary).padding(.vertical, 4)
                    }
                    .listRowBackground(Color(Palette.row))
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color(Palette.listGround).ignoresSafeArea())
                // The app's amber, which a bare test window doesn't pick up by itself.
                .tint(Color("AccentColor"))
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(origin: .zero, size: size)
                window.overrideUserInterfaceStyle = dark ? .dark : .light
                window.rootViewController = UIHostingController(rootView: list)
                window.isHidden = false
                try? await Task.sleep(for: .seconds(1.0))
                let format = UIGraphicsImageRendererFormat()
                format.scale = 3
                let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                    window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                }
                window.isHidden = true
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try #require(image.pngData()).write(to: dir.appending(path: "iphone-whatsnew-\(name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
    #endif
}
