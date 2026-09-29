#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// Checklists drawn like Apple Notes, measured in the rendered pixels: the circle's size, its
/// place on the text's cap height, and the gap to the words (.shots/checklist/reference.md).
@MainActor @Suite(.serialized) struct ChecklistLookTests {
    static let note = """
    Packing

    - [ ] Milk
    - [x] Eggs
    - [ ] Bread and butter for the whole week, a long item that wraps onto a second line so the hanging indent shows
    - [ ] Hat

    After
    """

    struct Ink { var minX = Int.max, maxX = Int.min, minY = Int.max, maxY = Int.min
        var width: Int { maxX - minX + 1 }; var height: Int { maxY - minY + 1 }
        var midY: Double { Double(minY + maxY) / 2 }
    }

    /// Pixels that differ clearly from the page, inside a box (pixel coordinates, y down).
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
        let path = await h.snapshot("checklist-look-\(dark ? "dark" : "light")")
        let rep = try #require(NSBitmapImageRep(data: try Data(contentsOf: URL(fileURLWithPath: path))))
        let scale = Double(rep.pixelsWide) / Double(h.scroll.bounds.width)
        // The page colour, read from an empty corner of the render.
        let page = try #require(rep.colorAt(x: rep.pixelsWide - 30, y: rep.pixelsHigh - 30))

        for word in ["Milk", "Eggs", "Hat"] {
            let at = (h.text as NSString).range(of: word).location
            let line = h.lineRect(at: (h.text as NSString).lineRange(for: NSRange(location: at, length: 0)).location)
            let deco = h.view.textStorage!.attribute(.paneLine, at: (h.text as NSString).lineRange(for: NSRange(location: at, length: 0)).location, effectiveRange: nil) as! LineDecoration
            let cx = h.view.textContainerOrigin.x + h.view.textContainer!.lineFragmentPadding * 0 + deco.markerX
            let size = EditorMetrics.checkSize
            // The circle: a box a little bigger than it, around the marker.
            let px = { (v: Double) in Int((v * scale).rounded()) }
            let circle = ink(rep, x: px(cx - size)...px(cx + size), y: px(line.minY - 2)...px(line.minY + line.height * 0.9), page: page)
            // The word's capitals: from the text start (circle + gap) over the first letter only.
            let textX = cx + size / 2 + EditorMetrics.checkGap
            let cap = ink(rep, x: px(textX - 2)...px(textX + EditorMetrics.body * 0.5), y: px(line.minY - 2)...px(line.minY + line.height * 0.9), page: page)
            let d = Double(circle.width) / scale
            let offset = (circle.midY - cap.midY) / scale
            let gap = Double(cap.minX - circle.maxX - 1) / scale
            print("CHECK \(dark ? "dark" : "light") \(word): diameter \(String(format: "%.2f", d)) pt, centre-to-caps \(String(format: "%+.2f", offset)) pt, gap \(String(format: "%.2f", gap)) pt, body \(EditorMetrics.body)")
            #expect(abs(d - size) < 1, "\(word): circle \(d) pt, want \(size)")
            #expect(abs(offset) <= 0.5, "\(word): circle centre is \(offset) pt off the capitals' centre")
            #expect(abs(gap - EditorMetrics.checkGap) < 1.5, "\(word): gap \(gap) pt, want \(EditorMetrics.checkGap)")
        }
    }

    @Test func circlesMatchNotesInLight() async throws { try await measure(dark: false) }
    @Test func circlesMatchNotesInDark() async throws { try await measure(dark: true) }

    @Test func tickedItemsKeepTheirTextColour() async {
        let h = await EditorHarness(Self.note, focus: false)
        defer { h.close() }
        let at = (h.text as NSString).range(of: "Eggs").location
        let color = h.view.textStorage!.attribute(.foregroundColor, at: at, effectiveRange: nil) as? NSColor
        #expect(color == nil || color == PColor.paneLabel, "Notes leaves ticked text as it is")
    }
}
#endif
