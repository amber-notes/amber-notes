import Foundation
import Testing
@testable import Pane

@MainActor @Suite struct CaretFixTests {
    @Test func caretAtEndOfTrailingTableAddsALine() {
        let text = "Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"
        let core = EditorCore()
        let blocks = core.blocks(in: text)
        #expect(blocks.count == 1)
        #expect(blocks.first?.range == NSRange(location: 7, length: 33))
        #expect(core.caretFix(text, NSRange(location: 40, length: 0), byKeyboard: false) == .newLineAfter(40))
        #expect(core.caretFix(text, NSRange(location: 20, length: 0), byKeyboard: false) == .newLineAfter(40))
    }

    @Test func clickInsideMiddleTableGoesAfter() {
        let text = "A\n| a | b |\n| --- | --- |\n| 1 | 2 |\nB"
        let core = EditorCore()
        let end = NSMaxRange(core.blocks(in: text)[0].range)
        #expect(core.caretFix(text, NSRange(location: end, length: 0), byKeyboard: false) == .move(end + 1))
    }

    @Test func keyboardFromBelowGoesAboveOrIntoTheGrid() {
        let text = "A\n| a | b |\n| --- | --- |\n| 1 | 2 |\nB"
        let core = EditorCore()
        _ = core.caretFix(text, NSRange(location: (text as NSString).length, length: 0), byKeyboard: true)
        let fix = core.caretFix(text, NSRange(location: 20, length: 0), byKeyboard: true)
        #expect(fix == .enterGrid(0, GridCell(row: 1, column: 0)))
    }

    @Test func embedsAreBlocksToo() {
        let text = "A\nhttps://example.com\nB"
        let core = EditorCore()
        #expect(core.caretFix(text, NSRange(location: 5, length: 0), byKeyboard: false) == .move(22))
    }
}
