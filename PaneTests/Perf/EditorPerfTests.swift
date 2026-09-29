#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// Keystroke and caret-move cost in the real editor. Thresholds are generous
/// ceilings so regressions fail; the measured numbers are printed for the log.
@MainActor @Suite(.serialized) struct EditorPerfTests {
    func ms(_ d: Duration) -> Double { Double(d.components.attoseconds) / 1e15 + Double(d.components.seconds) * 1000 }

    func measure(_ label: String, _ times: Int = 20, _ body: () -> Void) -> Double {
        let clock = ContinuousClock()
        var all: [Double] = []
        for _ in 0..<times { all.append(ms(clock.measure(body))) }
        all.sort()
        let median = all[all.count / 2]
        print("PERF \(label): median \(String(format: "%.2f", median)) ms, max \(String(format: "%.2f", all.last!)) ms")
        return median
    }

    @Test func typingInALongNote() async {
        let text = PerfFixtures.longNote()
        let clock = ContinuousClock()
        var h: EditorHarness!
        let open = ms(await clock.measure { h = await EditorHarness(text) })
        print("PERF open 5000-line note: \(String(format: "%.1f", open)) ms")
        defer { h.close() }
        await h.select((text as NSString).length / 2)
        let key = measure("keystroke, 5000-line note") { h.view.insertText("a", replacementRange: h.view.selectedRange()) }
        let move = measure("caret line change, 5000-line note") {
            let sel = h.view.selectedRange().location
            h.view.setSelectedRange(NSRange(location: sel > 200 ? sel - 200 : sel + 200, length: 0))
        }
        #expect(key < 16 * PerfBudget.slack, "a keystroke should restyle within a frame")
        #expect(move < 16 * PerfBudget.slack)
    }

    @Test func typingInANormalNote() async {
        let text = PerfFixtures.longNote(lines: 80)
        let h = await EditorHarness(text)
        defer { h.close() }
        await h.select((text as NSString).length / 2)
        let key = measure("keystroke, 80-line note") { h.view.insertText("a", replacementRange: h.view.selectedRange()) }
        #expect(key < 4 * PerfBudget.slack)
    }

    @Test func blocksNote() async {
        let text = PerfFixtures.blockyNote()
        let clock = ContinuousClock()
        var h: EditorHarness!
        let open = ms(await clock.measure { h = await EditorHarness(text) })
        print("PERF open note with 10 tables + 20 links: \(String(format: "%.1f", open)) ms")
        defer { h.close() }
        await h.select(3)
        let key = measure("keystroke, blocks note") { h.view.insertText("a", replacementRange: h.view.selectedRange()) }
        let layout = measure("overlay layout, blocks note") { h.view.layoutCards() }
        #expect(key < 16 * PerfBudget.slack)
        #expect(layout < 16 * PerfBudget.slack)
    }
}
#endif

#if os(macOS)
extension EditorPerfTests {
    @Test func openBreakdown() async {
        for (name, text) in [("5000 lines", PerfFixtures.longNote()), ("blocks", PerfFixtures.blockyNote()), ("80 lines", PerfFixtures.longNote(lines: 80))] {
            let clock = ContinuousClock()
            let window = KeyableWindow(contentRect: NSRect(x: -30000, y: -30000, width: 720, height: 900), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 720, height: 900))
            let view = PaneTextView(frame: scroll.bounds)
            let tConfigure = ms(clock.measure { view.configure(text: text, header: "Today") })
            scroll.documentView = view
            window.contentView = scroll
            let tLayout = ms(clock.measure { view.layoutCards() })
            let tDisplay = ms(clock.measure { window.displayIfNeeded() })
            print("PERF open[\(name)]: configure \(String(format: "%.1f", tConfigure)) ms, overlays \(String(format: "%.1f", tLayout)) ms, first display \(String(format: "%.1f", tDisplay)) ms")
            window.close()
        }
    }
}
#endif
