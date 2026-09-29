#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// The note open on this Mac while another device types in it: what arrives goes in without
/// moving your caret or scroll, and your own typing carries on.
@MainActor
@Suite(.serialized) struct LiveViewerTests {
    private func ms(_ f: () -> Void) -> Double {
        let t = ContinuousClock.now
        f()
        let d = ContinuousClock.now - t
        return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    @Test func textArrivingAboveLeavesCaretAndScrollAlone() async {
        let lines = (1...120).map { "Line \($0) of a long note" }.joined(separator: "\n")
        let h = await EditorHarness("Top\n\n\(lines)\n\nBottom", height: 500)
        defer { h.close() }
        await h.caret(after: "Line 60 of a long note")
        h.view.scrollRangeToVisible(h.view.selectedRange())
        await h.settle()
        let clip = h.scroll.contentView
        let before = clip.bounds.origin.y
        let caretText = "Line 60 of a long note"
        var times: [Double] = []
        for i in 1...40 {
            // The phone types at the top, a few characters a time.
            let remote = h.text.replacingOccurrences(of: "Top", with: "Top \(i)")
            times.append(ms { h.view.syncExternal(remote) })
            await h.settle(0.01)
        }
        let caret = h.view.selectedRange().location
        let ns = h.text as NSString
        #expect(ns.substring(to: caret).hasSuffix(caretText), "the caret stays after the text it was after")
        #expect(abs(clip.bounds.origin.y - before) < 1, "the scroll doesn't move: \(before) → \(clip.bounds.origin.y)")
        let sorted = times.sorted()
        print("PERF remote text arriving in an open 120-line note: median \(sorted[sorted.count / 2]) ms, max \(sorted.last!) ms")
    }

    @Test func typingCarriesOnWhileTheOtherDeviceTypes() async {
        let h = await EditorHarness("Top\n\nBottom")
        defer { h.close() }
        await h.caret(after: "Bottom")
        var keys: [Double] = []
        for i in 1...30 {
            // What the other device typed, merged with everything here (as sync does).
            let remote = h.text.replacingOccurrences(of: "Top", with: "Top \(i)")
            h.view.syncExternal(remote)
            let t = ContinuousClock.now
            await h.type("x")
            keys.append(Double((ContinuousClock.now - t).components.attoseconds) / 1e15)
        }
        #expect(h.text.hasSuffix("Bottom" + String(repeating: "x", count: 30)), "every key landed, in order: \(h.text.suffix(40))")
        #expect(h.text.hasPrefix("Top 30"), "and so did everything that arrived")
        #expect(NSMaxRange(h.view.selectedRange()) == (h.text as NSString).length, "the caret stayed where you type")
        let sorted = keys.sorted()
        print("PERF typing while the other device types: keystroke median \(sorted[sorted.count / 2]) ms")
    }
}
#endif
