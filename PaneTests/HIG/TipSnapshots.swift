#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
import TipKit
@testable import Pane

/// One "Did you know" tip on the Mac, in the real window, offscreen. Nothing touches the screen:
/// a real popover would open on the screen, so popovers are off here and the tip is drawn in
/// place under its control instead (TipKit's own view on a drawn popover card). TipKit is set up once
/// per process, so each tip and appearance is its own run:
/// `TEST_RUNNER_AMBER_HIG_SHOTS=<dir> TEST_RUNNER_AMBER_TIP=shareLink TEST_RUNNER_AMBER_TIP_DARK=1 scripts/qa-test.sh PaneTests/TipSnapshots`
@MainActor @Suite(.serialized) struct TipSnapshots {
    @Observable final class Anchor { var point: CGPoint? }

    /// A popover's outline: a rounded card with an arrow on its top edge at `arrowX`, as one path so
    /// its edge runs round the arrow too.
    struct PopoverShape: Shape {
        var arrowX: CGFloat
        var arrow = CGSize(width: 20, height: 10)
        var radius: CGFloat = 14

        func path(in r: CGRect) -> Path {
            let top = r.minY + arrow.height
            let x = min(max(arrowX, r.minX + radius + arrow.width / 2), r.maxX - radius - arrow.width / 2)
            var p = Path()
            p.move(to: CGPoint(x: r.minX + radius, y: top))
            p.addLine(to: CGPoint(x: x - arrow.width / 2, y: top))
            p.addQuadCurve(to: CGPoint(x: x, y: r.minY), control: CGPoint(x: x - arrow.width / 4, y: top - arrow.height * 0.1))
            p.addQuadCurve(to: CGPoint(x: x + arrow.width / 2, y: top), control: CGPoint(x: x + arrow.width / 4, y: top - arrow.height * 0.1))
            p.addLine(to: CGPoint(x: r.maxX - radius, y: top))
            p.addArc(tangent1End: CGPoint(x: r.maxX, y: top), tangent2End: CGPoint(x: r.maxX, y: top + radius), radius: radius)
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - radius))
            p.addArc(tangent1End: CGPoint(x: r.maxX, y: r.maxY), tangent2End: CGPoint(x: r.maxX - radius, y: r.maxY), radius: radius)
            p.addLine(to: CGPoint(x: r.minX + radius, y: r.maxY))
            p.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.minX, y: r.maxY - radius), radius: radius)
            p.addLine(to: CGPoint(x: r.minX, y: top + radius))
            p.addArc(tangent1End: CGPoint(x: r.minX, y: top), tangent2End: CGPoint(x: r.minX + radius, y: top), radius: radius)
            p.closeSubpath()
            return p
        }
    }

    /// The tip as the popover shows it: TipKit's own view on a popover card. The card stays inside
    /// the window; its arrow slides along the top edge to sit under the button's centre. In dark
    /// mode the card is a step lighter than the window, with a hairline edge.
    struct Shot: View {
        let root: AnyView
        let tip: any Tip
        let anchor: Anchor
        let width: CGFloat = 320
        @Environment(\.colorScheme) private var scheme

        static func cardX(anchor: CGFloat, width: CGFloat, window: CGFloat, margin: CGFloat = 10) -> CGFloat {
            min(max(margin, anchor - width / 2), window - width - margin)
        }

        var body: some View {
            root.overlay(alignment: .topLeading) {
                GeometryReader { g in
                    if let p = anchor.point {
                        let x = Self.cardX(anchor: p.x, width: width, window: g.size.width)
                        let shape = PopoverShape(arrowX: p.x - x)
                        TipView(tip, arrowEdge: nil)
                            .tipBackground(.clear)
                            .padding(.top, 10)
                            .frame(width: width)
                            .background(shape.fill(scheme == .dark ? Color(white: 0.19) : Color(white: 0.985)))
                            .overlay(shape.stroke(scheme == .dark ? Color.white.opacity(0.12) : Color.black.opacity(0.08), lineWidth: 0.75))
                            .shadow(color: .black.opacity(scheme == .dark ? 0.45 : 0.16), radius: 14, y: 5)
                            .offset(x: x, y: p.y + 2)
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
        let open = ["versionHistory": "Groceries", "shareLink": "Lisbon"][id] ?? "Evening tracker"
        // Where each tip points: the note's own toolbar control, by its label (the list has a More too).
        let control = ["versionHistory": "More", "shareLink": "Share", "menuBar": "New Note"][id]
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
