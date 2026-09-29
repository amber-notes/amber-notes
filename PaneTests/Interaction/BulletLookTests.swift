#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// Bullets and dashes sit on the middle of the lowercase letters, like Notes, measured in the
/// rendered pixels. `* item` is a bullet and `- item` a dash, as Notes' two list styles.
@MainActor @Suite(.serialized) struct BulletLookTests {
    // Only x-height letters, so the text's ink is exactly the lowercase band.
    static let note = """
    Lists

    * one moon
    - a raw nose
    * see new cars

    After
    """

    struct Ink { var minX = Int.max, maxX = Int.min, minY = Int.max, maxY = Int.min
        var width: Int { maxX - minX + 1 }; var height: Int { maxY - minY + 1 }
        var midY: Double { Double(minY + maxY) / 2 }
    }

    func ink(_ rep: NSBitmapImageRep, x: ClosedRange<Int>, y: ClosedRange<Int>, page: NSColor) -> Ink {
        var i = Ink()
        let p = page.usingColorSpace(.deviceRGB)!
        for yy in y where yy >= 0 && yy < rep.pixelsHigh {
            for xx in x where xx >= 0 && xx < rep.pixelsWide {
                guard let c = rep.colorAt(x: xx, y: yy)?.usingColorSpace(.deviceRGB) else { continue }
                let d = abs(c.redComponent - p.redComponent) + abs(c.greenComponent - p.greenComponent) + abs(c.blueComponent - p.blueComponent)
                if d > 0.25 { i.minX = min(i.minX, xx); i.maxX = max(i.maxX, xx); i.minY = min(i.minY, yy); i.maxY = max(i.maxY, yy) }
            }
        }
        return i
    }

    func measure(dark: Bool) async throws {
        let h = await EditorHarness(Self.note, dark: dark, focus: false)
        defer { h.close() }
        let path = await h.snapshot("bullets-\(dark ? "dark" : "light")")
        let rep = try #require(NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: path))))
        let scale = Double(rep.pixelsWide) / Double(h.scroll.bounds.width)
        let page = try #require(rep.colorAt(x: rep.pixelsWide - 30, y: rep.pixelsHigh - 30))
        let px = { (v: Double) in Int((v * scale).rounded()) }

        for (word, kind) in [("one moon", LineDecoration.Kind.bullet), ("a raw nose", .dash), ("see new cars", .bullet)] {
            let start = (h.text as NSString).lineRange(for: NSRange(location: (h.text as NSString).range(of: word).location, length: 0)).location
            let line = h.lineRect(at: start)
            let deco = h.view.textStorage!.attribute(.paneLine, at: start, effectiveRange: nil) as! LineDecoration
            #expect(deco.kind == kind, "\(word) should draw a \(kind)")
            let cx = h.view.textContainerOrigin.x + deco.markerX
            let marker = ink(rep, x: px(cx - EditorMetrics.body * 0.4)...px(cx + EditorMetrics.body * 0.4), y: px(line.minY)...px(line.minY + line.height), page: page)
            let textX = h.view.textContainerOrigin.x + EditorMetrics.gutter
            let letters = ink(rep, x: px(textX)...px(textX + EditorMetrics.body * 2), y: px(line.minY)...px(line.minY + line.height), page: page)
            let offset = (marker.midY - letters.midY) / scale
            print("BULLET \(dark ? "dark" : "light") \(word) (\(kind)): marker \(String(format: "%.2f", Double(marker.width) / scale))×\(String(format: "%.2f", Double(marker.height) / scale)) pt, centre-to-lowercase \(String(format: "%+.2f", offset)) pt @\(scale)x")
            #expect(abs(offset) <= 0.5, "\(word): marker is \(offset) pt off the lowercase middle")
            if kind == .dash { #expect(marker.width > marker.height * 3, "a dash, not a dot") }
        }
    }

    @Test func markersSitOnTheLowercaseMiddleInLight() async throws { try await measure(dark: false) }
    @Test func markersSitOnTheLowercaseMiddleInDark() async throws { try await measure(dark: true) }

    @Test func returnKeepsEachListsOwnMarker() {
        for marker in ["*", "-"] {
            let text = "\(marker) one"
            let e = ListEditing.returnKey(in: text, selection: NSRange(location: (text as NSString).length, length: 0))
            #expect(e?.replacement == "\n\(marker) ", "\(marker) continues as \(marker)")
        }
    }
}

/// Where each row goes when a checklist reorders, for the slide.
@Suite struct ReorderSlideTests {
    @Test @MainActor func tickedRowSinksAndTheOthersShiftUp() {
        let old = ["- [x] Milk", "- [ ] Eggs", "- [ ] Bread"]
        let new = ["- [ ] Eggs", "- [ ] Bread", "- [x] Milk"]
        let moves = ReorderSlide.moves(old: old, new: new)
        #expect(moves == [2, 0, 1])
        #expect(ReorderSlide.targets(heights: [20, 20, 30], moves: moves) == [50, 0, 20])
    }

    @Test @MainActor func equalLinesKeepTheirOrder() {
        #expect(ReorderSlide.moves(old: ["- [x] A", "- [ ] B", "- [x] A"], new: ["- [ ] B", "- [x] A", "- [x] A"]) == [1, 0, 2])
    }
}
#endif
