#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// Incremental and progressive styling must end up exactly where a full restyle would.
@MainActor @Suite(.serialized) struct IncrementalStyleTests {
    /// A compact description of every attribute run that affects what you see.
    static func resolve(_ c: Any?) -> String {
        guard let c = c as? NSColor else { return "-" }
        var out = ""
        NSAppearance(named: .aqua)!.performAsCurrentDrawingAppearance {
            let rgb = c.usingColorSpace(.sRGB)
            out = rgb.map { String(format: "%.3f,%.3f,%.3f,%.3f", $0.redComponent, $0.greenComponent, $0.blueComponent, $0.alphaComponent) } ?? "\(c)"
        }
        return out
    }

    static func signature(_ s: NSAttributedString) -> [String] {
        var out: [String] = []
        var runs: [(start: Int, end: Int, key: String)] = []
        s.enumerateAttributes(in: NSRange(location: 0, length: s.length)) { a, r, _ in
            let font = (a[.font] as? NSFont).map { "\($0.fontName)@\($0.pointSize)" } ?? "-"
            let color = resolve(a[.foregroundColor])
            let p = a[.paragraphStyle] as? NSParagraphStyle
            let para = p.map { "\($0.minimumLineHeight)/\($0.maximumLineHeight)/\($0.headIndent)/\($0.firstLineHeadIndent)/\($0.paragraphSpacing)/\($0.paragraphSpacingBefore)/\($0.lineSpacing)" } ?? "-"
            let deco = (a[.paneLine] as? LineDecoration).map { "\($0.kind)@\($0.markerX)" } ?? "-"
            let kern = a[.kern].map { "\($0)" } ?? "-"
            let extras = [a[.underlineStyle], a[.strikethroughStyle], a[.link]].map { $0.map { "\($0)" } ?? "-" }.joined(separator: ",") + "," + resolve(a[.backgroundColor])
            let key = "\(font) \(color) \(para) \(deco) \(kern) \(extras)"
            // Equal neighbours are one run, however the storage happened to split them.
            if let last = runs.last, last.key == key, last.end == r.location {
                runs[runs.count - 1].end = NSMaxRange(r)
            } else {
                runs.append((r.location, NSMaxRange(r), key))
            }
        }
        for run in runs { out.append("\(run.start)+\(run.end - run.start) \(run.key)") }
        return out
    }

    /// What a from-scratch full restyle gives for the same text and caret.
    static func reference(_ text: String, active: NSRange?) -> [String] {
        let storage = NSTextStorage(string: text)
        var styler = MarkdownStyler()
        styler.firstLineIsTitle = true
        styler.apply(to: storage, active: active ?? NSRange(location: NSNotFound, length: 0))
        return signature(storage)
    }

    func firstDifference(_ a: [String], _ b: [String]) -> String {
        for (i, (x, y)) in zip(a, b).enumerated() where x != y {
            return "got  \(x)\nwant \(y)\ngot next: \(a[i..<min(i + 4, a.count)].joined(separator: " || "))\nwant next: \(b[i..<min(i + 4, b.count)].joined(separator: " || "))"
        }
        return "lengths \(a.count) vs \(b.count)"
    }

    // Seed 2026 reaches a TextKit layout hang after 159 pathological edits (see LayoutHangTests); it runs by hand.
    @Test(arguments: [42, 7, 1234, 99, 31337] as [UInt64])
    func randomEditsMatchAFullRestyle(seed: UInt64) async {
        await fuzz(seed: seed, steps: 250)
    }

    /// Random edits (and caret moves) with a check against a full restyle after each.
    /// `beforeDisplay` runs after step `inspect`'s edit, before the window draws.
    func fuzz(seed: UInt64, steps: Int, inspect: Int = -1, alwaysFull: Bool = false, beforeDisplay: (EditorHarness) -> Void = { _ in }) async {
        var rng = SeededRandom(seed: seed)
        let snippets = ["a", "word ", "\n", "\n\n", "- ", "- [ ] ", "- [x] done", "**bold**", "*it*", "`code`", "# Head", "> quote",
                        "```", "```\ncode\n```", "| a | b |\n| --- | --- |\n| 1 | 2 |", "https://example.com", "1. one", "  - nested", "<u>u</u>", "~~s~~", "- ```", "> ```x", "~~~", "<!-- pane-table: a=number -->\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
                        "![img](pane-file:6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55)", "    indented", "***", "Title\n"]
        let h = await EditorHarness(PerfFixtures.longNote(lines: 120))
        h.view.core.alwaysFull = alwaysFull
        defer { h.close() }
        for step in 0..<steps {
            let len = (h.text as NSString).length
            let at = Int(rng.next() % UInt64(len + 1))
            if rng.next() % 4 == 0, len > 0 {
                let n = min(Int(rng.next() % (rng.next() % 5 == 0 ? 400 : 30)) + 1, len - min(at, len - 1))
                h.view.insertText("", replacementRange: NSRange(location: min(at, len - 1), length: max(n, 0)))
            } else {
                let snippet = snippets[Int(rng.next() % UInt64(snippets.count))]
                h.view.insertText(snippet, replacementRange: NSRange(location: at, length: 0))
            }
            if step == inspect { beforeDisplay(h) }
            // Move the caret somewhere else now and then, as a person would.
            if rng.next() % 3 == 0 { h.view.setSelectedRange(NSRange(location: Int(rng.next() % UInt64((h.text as NSString).length + 1)), length: 0)) }
            await h.settle(0.01)
            let got = Self.signature(h.view.textStorage!)
            let want = Self.reference(h.text, active: h.view.selectedRange())
            if got != want {
                let d = firstDifference(got, want)
                Issue.record("seed \(seed) step \(step): styling differs from a full restyle\n\(d)\nregions: \(h.view.core.lastRegions)")
                return
            }
        }
    }

    @Test func progressiveOpenEndsFullyStyled() async {
        let text = PerfFixtures.longNote(lines: 3000)
        let h = await EditorHarness(text, focus: false)
        defer { h.close() }
        for _ in 0..<200 where h.view.core.unstyledFrom != Int.max { await h.settle(0.02) }
        #expect(h.view.core.unstyledFrom == Int.max)
        #expect(Self.signature(h.view.textStorage!) == Self.reference(text, active: nil))
    }
}

/// A small deterministic generator so failures replay.
struct SeededRandom {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state >> 33
    }
}
#endif
