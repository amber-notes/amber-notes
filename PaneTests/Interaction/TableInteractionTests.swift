#if os(macOS)
import AppKit
import Testing
@testable import Pane

@MainActor @Suite(.serialized) struct TableInteractionTests {
    static let note = """
    Shortcuts

    Everything you can do from the keyboard is here.

    | Shortcut | Does |
    | --- | --- |
    | ⌘B | Bold |
    | ⌘⇧L | Checklist |

    After the table
    """

    var tableRange: NSRange { GridTable.find(in: Self.note)[0].range }

    @Test func clickBelowTableNeverShowsSource() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        #expect(h.gridCount == 1)
        let r = h.lineRect(at: tableRange.location)
        await h.snapshot("table-before-click")
        // Just below the grid, and to the right of its last row.
        for p in [CGPoint(x: 200, y: r.maxY + 4), CGPoint(x: h.view.bounds.width - 10, y: r.maxY - 10), CGPoint(x: h.view.bounds.width - 10, y: r.maxY + 2)] {
            await h.click(p)
            let sel = h.selection
            #expect(!(sel.location >= tableRange.location && sel.location <= NSMaxRange(tableRange)), "caret \(sel.location) inside table \(tableRange) after click at \(p)")
            #expect(h.gridCount == 1, "table flipped to source after click at \(p)")
        }
        await h.snapshot("table-after-click")
    }
}
#endif

#if os(macOS)
extension TableInteractionTests {
    @Test func arrowDownEntersTheTableAndOutAgain() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        await h.caret(after: "is here.")
        await h.press(EditorHarness.down) // blank line
        await h.press(EditorHarness.down) // into the table
        #expect(h.gridCount == 1)
        #expect(h.gridHasFocus, "arrowing down into a table should put the keyboard in its first cell")
        await h.snapshot("table-arrow-in")
        await h.press(EditorHarness.down)
        await h.press(EditorHarness.down)
        await h.press(EditorHarness.down) // past the last row
        #expect(!h.gridHasFocus)
        #expect(h.selection.location > NSMaxRange(tableRange), "leaving the table from the bottom lands after it")
    }

    @Test func tableAtEndOfNoteGetsALineAfterOnClick() async {
        let text = "Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"
        let h = await EditorHarness(text)
        defer { h.close() }
        let r = h.lineRect(at: GridTable.find(in: text)[0].range.location)
        await h.click(CGPoint(x: 300, y: r.maxY + 6))
        await h.settle(0.1)
        let ok = h.text.hasSuffix("| 1 | 2 |\n")
        #expect(ok, "a line appears after the table for the caret: \(h.text.debugDescription.replacingOccurrences(of: "\\n", with: "⏎")) sel \(h.selection)")
        #expect(h.selection.location == (h.text as NSString).length)
        #expect(h.gridCount == 1)
    }

    @Test func selectAllKeepsTheGrid() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        h.view.selectAll(nil)
        await h.settle()
        #expect(h.gridCount == 1)
        #expect(h.overlays.count >= 1)
    }
}
#endif

#if os(macOS)
extension TableInteractionTests {
    @Test func arrowingIntoACellDoesNotSelectItsText() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        await h.caret(after: "is here.")
        await h.press(EditorHarness.down)
        await h.press(EditorHarness.down)
        await h.settle(0.1)
        let editor = h.window.firstResponder as? NSTextView
        #expect(editor !== h.view)
        #expect(editor?.selectedRange().length == 0, "the cell's text shouldn't be selected")
        #expect(editor?.selectedRange().location == 8, "caret after “Shortcut”")
    }

    @Test func backspaceAfterATableSelectsThenDeletesIt() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        let t = tableRange
        await h.select(NSMaxRange(t) + 1) // start of the blank line after the table
        await h.command(#selector(NSResponder.deleteBackward(_:)))
        #expect(h.view.core.armedGrid == 0, "first press marks the table")
        #expect(h.text == Self.note, "nothing deleted yet")
        await h.snapshot("table-selected")
        await h.command(#selector(NSResponder.deleteBackward(_:)))
        #expect(!h.text.contains("| ⌘B"), "second press removes it")
        #expect(h.text.contains("is here.\n\n\nAfter the table"), "\(h.text.debugDescription)")
        #expect(h.gridCount == 0)
    }

    @Test func typingAfterMarkingATableKeepsIt() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        await h.select(NSMaxRange(tableRange) + 1)
        await h.command(#selector(NSResponder.deleteBackward(_:)))
        await h.type("x")
        #expect(h.view.core.armedGrid == nil)
        await h.command(#selector(NSResponder.deleteBackward(_:)))
        #expect(h.text.contains("| ⌘B"), "the table survives: the second Delete removed the x")
    }

    @Test func backspaceAfterAnEmbedRemovesItWholeNotHalf() async {
        let text = "Links\n\nhttps://example.com\nNext line"
        let h = await EditorHarness(text)
        defer { h.close() }
        await h.caret(after: "example.com\n")
        await h.command(#selector(NSResponder.deleteBackward(_:)))
        #expect(h.text == "Links\n\nNext line")
    }
}
#endif
