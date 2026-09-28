#if os(macOS)
import AppKit
import Supabase
import SwiftUI
import Testing
@testable import Pane

/// Renders the consent sheet offscreen, light and dark, when PANE_SNAPSHOT_DIR is set.
@MainActor
@Suite struct ConnectSnapshotTests {
    @Test func consentSheet() throws {
        guard let dir = ProcessInfo.processInfo.environment["PANE_SNAPSHOT_DIR"] else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://localhost")!, supabaseKey: "test")
        let cases: [(String, ConnectRequest)] = [
            ("known", ConnectRequest(id: UUID(), client_name: "ChatGPT", redirect_host: "chatgpt.com", loopback: false, wants_write: true)),
            ("unknown", ConnectRequest(id: UUID(), client_name: "Notes Helper", redirect_host: "helper.example.com", loopback: false, wants_write: false)),
        ]
        for (name, r) in cases {
            for dark in [false, true] {
                let view = ConsentSheet(client: client, requestID: r.id, initial: .asking(r), finish: { _ in })
                let host = NSHostingView(rootView: view.background(Color(nsColor: .windowBackgroundColor)))
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                host.frame = CGRect(origin: .zero, size: host.fittingSize)
                host.layoutSubtreeIfNeeded()
                let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.cacheDisplay(in: host.bounds, to: rep)
                let png = try #require(rep.representation(using: .png, properties: [:]))
                try png.write(to: URL(fileURLWithPath: dir).appending(path: "consent-\(name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
}
#endif
