#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
import TipKit
@testable import Pane

/// One "Did you know" tip on the Mac, in the real window, offscreen. Nothing touches the screen:
/// a real popover would open on the screen, so popovers are off here and the tip is drawn in
/// place under its control instead (TipKit's own view, with its arrow). TipKit is set up once
/// per process, so each tip and appearance is its own run:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=<dir> TEST_RUNNER_AMBER_TIP=shareLink TEST_RUNNER_AMBER_TIP_DARK=1 scripts/qa-test.sh PaneTests/TipSnapshots`
@MainActor @Suite(.serialized) struct TipSnapshots {
    @Observable final class Anchor { var point: CGPoint? }

    struct Shot: View {
        let root: AnyView
        let tip: any Tip
        let anchor: Anchor
        let width: CGFloat = 290

        var body: some View {
            root.overlay(alignment: .topLeading) {
                GeometryReader { g in
                    if let p = anchor.point {
                        // Opaque, with a popover's shadow: over the note, as the popover would be.
                        TipView(tip, arrowEdge: .top)
                            .tipBackground(Color(nsColor: .windowBackgroundColor))
                            .frame(width: width)
                            .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
                            .offset(x: min(max(8, p.x - width / 2), g.size.width - width - 12), y: p.y + 4)
                    }
                }
                .ignoresSafeArea()
            }
        }
    }

    @Test func tip() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let dir = AppSnapshotTests.dir, let id = env["AMBER_TIP"],
              let tip = PaneTips.all.first(where: { $0.id == id }) else { return }
        let dark = env["AMBER_TIP_DARK"] == "1"
        // The toolbar's glass follows the app's appearance, not only the window's.
        NSApp.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        defer { NSApp.appearance = nil }
        PaneTips.popovers = false
        let store = FileManager.default.temporaryDirectory.appending(path: "tips-shots-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: store, withIntermediateDirectories: true)
        Tips.showTipsForTesting([type(of: tip)])
        try Tips.configure([.datastoreLocation(.url(store)), .displayFrequency(.immediate)])

        let c = try AppSnapshotTests.container()
        c.mainContext.createNote(in: .all, body: "Budget\n\nItem\tCost\nRent\t900\nFood\t300\nTravel\t150\n")
        try c.mainContext.save()
        let open = ["versionHistory": "Groceries", "shareLink": "Lisbon", "checklistTidy": "Groceries", "tableFromText": "Budget"][id] ?? "Evening tracker"
        // Where each tip points: the toolbar control's label.
        let control = ["versionHistory": "More", "shareLink": "Share", "checklistTidy": "Checklist", "tableFromText": "Table", "menuBar": "New Note"][id]
        let setup = SetupStore(progress: SetupProgress(imported: true, connected: true, aiEdits: 3, dismissed: true, celebrated: true))
        let anchor = Anchor()
        let root = AnyView(RootView().modelContainer(c).environment(setup))
        try await AppSnapshotTests.withLastNote(c, open) {
            try await Self.shoot(Shot(root: root, tip: tip, anchor: anchor), control: control, anchor: anchor,
                                 to: dir.appending(path: "mac-tip-\(id)-\(dark ? "dark" : "light").png"), size: CGSize(width: 1000, height: 700), dark: dark)
        }
    }

    static func shoot(_ view: some View, control: String?, anchor: Anchor, to url: URL, size: CGSize, dark: Bool) async throws {
        let window = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: size.width, height: size.height),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let host = NSHostingController(rootView: view)
        // The window keeps the size asked for; the list's content doesn't grow it.
        host.sizingOptions = []
        window.contentViewController = host
        window.setContentSize(size)
        window.setFrameOrigin(CGPoint(x: -30000, y: -30000))
        window.orderFrontRegardless()
        try? await Task.sleep(for: .seconds(1.2))
        defer { window.orderOut(nil); window.close() }
        let frame = try #require(window.contentView?.superview)
        if let control {
            // The note's own control: the last toolbar item with that label (the list has a More too).
            let item = try #require(window.toolbar?.items.last { $0.label == control }, "no \(control) in the toolbar")
            let target = try #require(item.view)
            let r = target.convert(target.bounds, to: nil)
            // Window coordinates are bottom-up; the overlay is top-down from the window's top.
            anchor.point = CGPoint(x: r.midX, y: window.frame.height - r.minY)
            try? await Task.sleep(for: .seconds(2.0))
        }
        let rep = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
        window.effectiveAppearance.performAsCurrentDrawingAppearance { frame.cacheDisplay(in: frame.bounds, to: rep) }
        // Offscreen, the sidebar's material draws empty: the shot starts at the notes list.
        func splits(_ v: NSView) -> [NSSplitView] { ((v as? NSSplitView).map { [$0] } ?? []) + v.subviews.flatMap(splits) }
        // The sidebar: the narrowest full-height pane at the window's left edge.
        let height = frame.bounds.height
        let panes: [CGRect] = splits(frame).flatMap { $0.subviews.map { $0.frame } }
        let left: [CGFloat] = panes.filter { r in r.minX == 0 && r.width > 100 && r.height >= height - 1 }.map { $0.maxX }
        let sidebar: CGFloat = left.min() ?? 0
        let scale = CGFloat(rep.pixelsWide) / frame.bounds.width
        let full = try #require(rep.cgImage)
        let cropped = try #require(full.cropping(to: CGRect(x: sidebar * scale, y: 0, width: CGFloat(full.width) - sidebar * scale, height: min(CGFloat(full.height), (size.height + 28) * scale))))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try #require(NSBitmapImageRep(cgImage: cropped).representation(using: .png, properties: [:])).write(to: url)
    }
}
#endif
