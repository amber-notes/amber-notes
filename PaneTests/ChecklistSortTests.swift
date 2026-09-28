import Foundation
import Testing
@testable import Pane

@Suite struct ChecklistSortTests {
    func sorted(_ text: String, around: Int, caret: Int = 0) -> (String, Int) {
        guard let e = ListEditing.sortChecklist(in: text, around: around, caret: caret) else { return (text, -1) }
        return ((text as NSString).replacingCharacters(in: e.range, with: e.replacement), e.caret)
    }

    @Test func tickedItemsSinkBelowOpenOnes() {
        let text = "Todo\n- [x] Milk\n- [ ] Eggs\n- [ ] Bread\nAfter"
        #expect(sorted(text, around: 6).0 == "Todo\n- [ ] Eggs\n- [ ] Bread\n- [x] Milk\nAfter")
    }

    @Test func untickedItemRisesAboveTickedOnes() {
        let text = "- [ ] A\n- [x] B\n- [ ] C"
        #expect(sorted(text, around: 16).0 == "- [ ] A\n- [ ] C\n- [x] B")
    }

    @Test func alreadySortedOrNestedIsLeftAlone() {
        #expect(ListEditing.sortChecklist(in: "- [ ] A\n- [x] B", around: 0, caret: 0) == nil)
        #expect(ListEditing.sortChecklist(in: "- [x] A\n- [ ] B\n  - [ ] child", around: 0, caret: 0) == nil)
    }

    @Test func caretFollowsItsLine() {
        // Caret at the end of "Eggs"; after sorting Eggs is first.
        let text = "- [x] Milk\n- [ ] Eggs"
        let (out, caret) = sorted(text, around: 0, caret: 21)
        #expect(out == "- [ ] Eggs\n- [x] Milk")
        #expect(caret == 10)
    }

    @Test func caretStepsOverHiddenMarker() {
        let text = "Intro\n- [ ] Buy milk"
        // Clicking into the marker lands on the text.
        #expect(ListEditing.caretOutsideMarker(in: text, selection: NSRange(location: 6, length: 0), previous: nil) == 12)
        // Arrowing left from the text goes to the previous line, not into the marker.
        #expect(ListEditing.caretOutsideMarker(in: text, selection: NSRange(location: 11, length: 0), previous: NSRange(location: 12, length: 0)) == 5)
        #expect(ListEditing.caretOutsideMarker(in: text, selection: NSRange(location: 14, length: 0), previous: nil) == nil)
    }
}
