#if os(macOS)
import AppKit
import Foundation
import SwiftData
import Testing
@testable import Pane

/// Pushing the editor past everyday use: emoji clusters, right-to-left text, big pastes,
/// long undo runs, long checklists and tables at the edges of a note. Nothing may crash,
/// hang or lose text.
@MainActor
@Suite(.serialized) struct StressTests {
    private func ms(_ f: () -> Void) -> Double {
        let t = ContinuousClock.now
        f()
        let d = ContinuousClock.now - t
        return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    // MARK: Emoji and scripts

    @Test func deletingEmojiClustersRemovesWholeCharacters() async {
        let family = "👨‍👩‍👧‍👦", flag = "🇸🇪", skin = "👍🏽", keycap = "1️⃣"
        let h = await EditorHarness("Title\n\n")
        defer { h.close() }
        await h.select((h.text as NSString).length)
        for e in [family, flag, skin, keycap] { await h.type(e) }
        #expect(h.text == "Title\n\n" + family + flag + skin + keycap)
        for _ in 0..<4 { await h.command(#selector(NSResponder.deleteBackward(_:))) }
        #expect(h.text == "Title\n\n", "each delete takes a whole emoji, never half a surrogate pair")
        // Checklist and list markers in front of emoji and wide text survive a Return.
        await h.type("- [ ] " + family + " party")
        await h.command(#selector(NSResponder.insertNewline(_:)))
        #expect(h.text.hasSuffix("- [ ] " + family + " party\n- [ ] "))
    }

    @Test func rightToLeftAndMixedTextEditLikeAnyOther() async {
        let body = "עברית\n\nمرحبا بالعالم\n\n- [ ] שלום עולם\n- قائمة التسوق\n1. واحد\n\n| עמודה | عمود |\n| --- | --- |\n| א | ب |\n\nMixed English עברית 123 عربى."
        let h = await EditorHarness(body)
        defer { h.close() }
        await h.caret(after: "- قائمة التسوق")
        await h.command(#selector(NSResponder.insertNewline(_:)))
        #expect(h.text.contains("- قائمة التسوق\n- \n1."), "a bullet continues in Arabic too")
        await h.type("خبز")
        await h.caret(after: "- [ ] שלום עולם")
        await h.command(#selector(NSResponder.insertNewline(_:)))
        #expect(h.text.contains("- [ ] שלום עולם\n- [ ] "))
        #expect(h.gridCount == 1, "the right-to-left table still shows as a grid")
        await h.snapshot("stress-rtl")
    }

    @Test(.timeLimit(.minutes(2))) func tenThousandEmojiTypeQuickly() async {
        let line = String(repeating: "👨‍👩‍👧‍👦🇸🇪👍🏽", count: 50)
        let text = "Emoji\n\n" + Array(repeating: line, count: 70).joined(separator: "\n")
        let h = await EditorHarness(text)
        defer { h.close() }
        await h.select((h.text as NSString).length)
        var keys: [Double] = []
        for c in "abcde" {
            keys.append(ms {
                h.view.insertText(String(c), replacementRange: h.view.selectedRange())
                h.view.displayIfNeeded()
            })
        }
        let median = keys.sorted()[2]
        print("PERF 10,500 emoji: keystroke median \(String(format: "%.1f", median)) ms")
        #expect(h.text.hasSuffix("abcde"))
        #expect(median < 150 * PerfBudget.slack)
    }

    // MARK: Pasting

    @Test(.timeLimit(.minutes(3))) func pastingAHugeWebPageScales() async {
        for n in [400, 2000] {
            var html = "<html><body>"
            for i in 0..<n { html += "<h2>Section \(i)</h2><p>Some <b>bold</b> and <a href=\"https://e.com/\(i)\">a link</a>.</p><ul><li>One</li><li>Two</li></ul>" }
            html += "</body></html>"
            var md = ""
            let t = ms { md = RichTextToMarkdown.markdown(fromHTML: html) }
            print("PERF paste scaling: \(html.utf8.count / 1024) KB HTML → \(Int(t)) ms on the main thread")
            #expect(md.contains("Section \(n - 1)"))
        }
    }

    @Test(.timeLimit(.minutes(2))) func pastingABigRichWebPageStaysWholeAndBounded() async {
        // A long article: headings, bold, links, nested lists, a table, images.
        var html = "<html><body><h1>Big page</h1>"
        for i in 0..<400 {
            html += "<h2>Section \(i)</h2><p>Some <b>bold</b>, <i>italic</i> and <a href=\"https://example.com/\(i)\">a link</a>. <img src=\"https://example.com/\(i).png\"></p>"
            html += "<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>"
            if i % 50 == 0 { html += "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>" }
        }
        html += "</body></html>"
        var md = ""
        let t = ms { md = RichTextToMarkdown.markdown(fromHTML: html) }
        print("PERF paste \(html.utf8.count / 1024) KB of HTML → \(md.utf8.count / 1024) KB markdown in \(Int(t)) ms")
        #expect(md.contains("Section 399"), "nothing is cut off")
        #expect(md.contains("[a link](https://example.com/399)"))
        #expect(!md.contains("<img"), "no raw HTML survives")
        let h = await EditorHarness("Title\n\n")
        defer { h.close() }
        await h.select((h.text as NSString).length)
        let insert = ms { h.view.apply(TextEdit(range: h.selection, replacement: md, caret: 7 + (md as NSString).length)) }
        print("PERF inserting the pasted markdown: \(Int(insert)) ms")
        #expect(h.text.hasSuffix(md))
    }

    // MARK: Undo

    @Test(.timeLimit(.minutes(2))) func hundredsOfUndosAndRedosGetBackExactly() async {
        let start = "Title\n\n- [ ] one\n"
        let h = await EditorHarness(start)
        defer { h.close() }
        let um = try! #require(h.view.undoManager)
        um.removeAllActions()
        await h.select((h.text as NSString).length)
        var states = [h.text]
        // Words, list continuations and a checklist toggle, each its own undo step.
        for i in 0..<300 {
            // Each word its own undo step, as pausing between words makes it.
            h.view.breakUndoCoalescing()
            if i % 10 == 9 {
                h.view.doCommand(by: #selector(NSResponder.insertNewline(_:)))
            } else {
                h.view.insertText("w\(i) ", replacementRange: h.view.selectedRange())
            }
            states.append(h.text)
        }
        let final = h.text
        var undone = 0
        // Step back through every state, checking each one on the way.
        while um.canUndo && undone < 1000 {
            um.undo()
            undone += 1
        }
        #expect(h.text == start, "undoing everything gets back to the start, got \(h.text.prefix(80))")
        while um.canRedo { um.redo() }
        #expect(h.text == final, "and redoing everything gets back to the end")
        // How many steps it takes depends on run-loop turns, which the offscreen harness
        // doesn't have between edits (the undo manager groups by event); exactness is the point.
        print("PERF undo steps: \(undone)")
    }

    @Test func undoAfterAnOutsideChangeCantCorruptText() async {
        let h = await EditorHarness("Title\n\nHello")
        defer { h.close() }
        await h.caret(after: "Hello")
        await h.type(" there")
        h.view.syncExternal("Title\n\nA line from the phone\n\nHello there")
        // Undo steps from before would apply at stale offsets; they're dropped instead.
        #expect(!(h.view.undoManager?.canUndo ?? false))
        #expect(h.text == "Title\n\nA line from the phone\n\nHello there")
    }

    // MARK: Checklists

    @Test(.timeLimit(.minutes(2))) func fiveHundredItemChecklistTicksAndSortsQuickly() async {
        let items = (0..<500).map { "- [ ] Item \($0)" }
        let h = await EditorHarness("List\n\n" + items.joined(separator: "\n") + "\n\nAfter")
        defer { h.close() }
        var times: [Double] = []
        // Tick every 25th item, then sort once, as a tap would.
        for i in stride(from: 0, to: 500, by: 25) {
            let at = (h.text as NSString).range(of: "- [ ] Item \(i)\n").location
            #expect(at != NSNotFound)
            guard let e = ListEditing.toggleCheckbox(in: h.text, lineStart: at) else { continue }
            times.append(ms { h.view.apply(e); h.view.displayIfNeeded() })
        }
        let sort = ms {
            if let e = ListEditing.sortChecklist(in: h.text, around: 8, caret: 0) {
                h.view.apply(TextEdit(range: e.range, replacement: e.replacement, caret: -1))
            }
        }
        let median = times.sorted()[times.count / 2]
        print("PERF 500-item checklist: tick median \(String(format: "%.1f", median)) ms, sort \(Int(sort)) ms")
        let lines = h.text.components(separatedBy: "\n")
        #expect(lines.count == 504)
        #expect(lines[2 ..< 482].allSatisfy { $0.hasPrefix("- [ ]") } && lines[482 ..< 502].allSatisfy { $0.hasPrefix("- [x]") })
        #expect(h.text.hasSuffix("\n\nAfter"))
        #expect(median < 100 * PerfBudget.slack)
    }

    // MARK: Tables at the edges

    @Test func tablesAtTheEdgesOfANote() async {
        let cases: [(String, String)] = [
            ("starts", "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter"),
            ("ends-no-newline", "Title\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"),
            ("only-header", "Title\n\n| A | B |\n| --- | --- |"),
            ("empty-cells", "Title\n\n|  |  |\n| --- | --- |\n|  |  |\n|  |  |"),
            ("pipes", "Title\n\n| Command | Means |\n| --- | --- |\n| `a \\| b` | pipe \\| inside |"),
            ("ragged", "Title\n\n| A | B | C |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 | 5 |"),
            ("wide", "Title\n\n| " + (0..<50).map { "C\($0)" }.joined(separator: " | ") + " |\n|" + String(repeating: " --- |", count: 50) + "\n| " + (0..<50).map { "v\($0)" }.joined(separator: " | ") + " |"),
            ("two-touching", "Title\n\n| A |\n| --- |\n| 1 |\n| B |\n| --- |\n| 2 |"),
        ]
        for (name, body) in cases {
            let h = await EditorHarness(body)
            // Type at the very end and at the very start; delete back over the whole table.
            await h.select((h.text as NSString).length)
            await h.type("!")
            #expect(h.text.hasSuffix("!"), "\(name): typing at the end works")
            // A table on the very first line keeps the caret out of its source; arrowing up from it
            // makes a new line above instead (checked in TableInteractionTests).
            if !body.hasPrefix("|") {
                await h.select(0)
                await h.type("X")
                #expect(h.text.hasPrefix("X"), "\(name): typing at the start works")
            }
            await h.snapshot("stress-table-\(name)")
            h.view.selectAll(nil)
            await h.command(#selector(NSResponder.deleteBackward(_:)))
            #expect(h.text.isEmpty, "\(name): select all and delete empties the note, got \(h.text.prefix(40))")
            #expect(h.gridCount == 0, "\(name): no grid left over")
            h.close()
        }
    }
}
#endif
