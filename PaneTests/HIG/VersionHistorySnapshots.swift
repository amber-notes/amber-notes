#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The Mac's version history sheet over the demo history, light and dark, at 2x. Offscreen;
/// nothing touches the screen. Runs only when AMBER_HIG_SHOTS is set:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/VersionHistorySnapshots`.
@MainActor @Suite(.serialized) struct VersionHistorySnapshots {
    @Test(arguments: [false, true])
    func sheet(dark: Bool) async throws {
        guard let dir = AppSnapshotTests.dir else { return }
        let c = try AppSnapshotTests.container()
        let notes = try c.mainContext.fetch(FetchDescriptor<Note>())
        let history = NoteHistory(store: DemoHistoryStore(context: c.mainContext), context: c.mainContext, sync: nil)
        let mode = dark ? "dark" : "light"
        for (title, slug, pick) in [("Groceries", "groceries", 1), ("Groceries", "groceries-burst", 2), ("Snippets", "empty", 0)] {
            let note = try #require(notes.first { $0.title == title })
            let model = VersionHistoryModel(note: note, history: history)
            await model.load()
            if pick < model.entries.count { await model.select(model.entries[pick].id) }
            try await Self.shoot(MacVersionHistory(model: model, close: {}).frame(width: 900, height: 600),
                                 to: dir.appending(path: "mac-history-\(slug)-\(mode).png"), size: CGSize(width: 900, height: 600), dark: dark)
        }
        let offline = DemoHistoryStore(context: c.mainContext)
        offline.offline = true
        let model = VersionHistoryModel(note: try #require(notes.first { $0.title == "Groceries" }),
                                        history: NoteHistory(store: offline, context: c.mainContext, sync: nil))
        await model.load()
        try await Self.shoot(MacVersionHistory(model: model, close: {}).frame(width: 900, height: 600),
                             to: dir.appending(path: "mac-history-offline-\(mode).png"), size: CGSize(width: 900, height: 600), dark: dark)
    }

    /// Draws `view` in an offscreen window and writes a PNG at twice its size.
    static func shoot(_ view: some View, to url: URL, size: CGSize, dark: Bool) async throws {
        // Drawn as the key window's sheet would be: its default button in the accent colour.
        let host = NSHostingView(rootView: view.environment(\.controlActiveState, .key))
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let window = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: size.width, height: size.height),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = host.appearance
        window.contentView = host
        host.frame = CGRect(origin: .zero, size: size)
        // Never ordered front: drawn offscreen with cacheDisplay (AppSnapshotTests.onScreenAllowed).
        try? await Task.sleep(for: .seconds(0.8))
        defer { window.close() }
        host.layoutSubtreeIfNeeded()
        let bounds = host.bounds
        let rep = try #require(NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(bounds.width * 2), pixelsHigh: Int(bounds.height * 2),
                                                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        rep.size = bounds.size
        host.appearance!.performAsCurrentDrawingAppearance { host.cacheDisplay(in: bounds, to: rep) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: url)
    }
}
#endif
