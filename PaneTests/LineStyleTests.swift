import Foundation
import Testing
@testable import Pane

@Suite struct LineStyleTests {
    func run(_ text: String, _ caret: Int, _ style: ListEditing.LineStyle) -> (String, Int) {
        let e = ListEditing.toggleLineStyle(in: text, selection: NSRange(location: caret, length: 0), style)
        return ((text as NSString).replacingCharacters(in: e.range, with: e.replacement), e.caret)
    }

    @Test func plainLineTakesTheStyle() {
        #expect(run("Milk", 4, .bulleted) == ("- Milk", 6))
        #expect(run("Milk", 4, .numbered) == ("1. Milk", 7))
        #expect(run("Milk", 0, .quote) == ("> Milk", 2))
    }

    @Test func sameStyleAgainGoesBackToBody() {
        #expect(run("- Milk", 6, .bulleted) == ("Milk", 4))
        #expect(run("1. Milk", 7, .numbered) == ("Milk", 4))
        #expect(run("> Milk", 6, .quote) == ("Milk", 4))
    }

    @Test func switchesBetweenListStylesKeepingIndent() {
        #expect(run("  - Milk", 8, .numbered) == ("  1. Milk", 9))
        #expect(run("1. Milk", 7, .bulleted) == ("- Milk", 6))
        #expect(run("> Milk", 6, .bulleted) == ("- Milk", 6))
    }

    @Test func checklistBecomesBullets() {
        #expect(run("- [ ] Milk", 10, .bulleted).0 == "- Milk")
    }
}
