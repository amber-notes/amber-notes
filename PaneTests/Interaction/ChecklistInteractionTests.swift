#if os(macOS)
import AppKit
import Testing
@testable import Pane

@MainActor @Suite(.serialized) struct ChecklistInteractionTests {
    static let note = """
    Groceries

    - [ ] Milk
    - [ ] Eggs
    - [ ] Bread

    After
    """

    func lineStart(_ h: EditorHarness, _ s: String) -> Int { (h.text as NSString).range(of: s).location }

    /// The circle's centre for the checklist line containing `s`.
    func circle(_ h: EditorHarness, _ s: String) -> CGPoint {
        let at = lineStart(h, s)
        let r = h.lineRect(at: at)
        let deco = h.view.textStorage!.attribute(.paneLine, at: (h.text as NSString).lineRange(for: NSRange(location: at, length: 0)).location, effectiveRange: nil) as? LineDecoration
        return CGPoint(x: h.view.textContainerOrigin.x + (deco?.markerX ?? 10), y: r.minY + r.height / 2 - 1)
    }

    @Test func clickingTheCircleTicksThenSinksTheItem() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        await h.snapshot("checklist-before")
        await h.click(circle(h, "Milk"))
        #expect(h.text.contains("- [x] Milk"))
        #expect(h.text.contains("- [x] Milk\n- [ ] Eggs"), "stays put for a moment so you see the tick")
        await h.settle(ListEditing.sortDelay + 0.3)
        #expect(h.text.contains("- [ ] Eggs\n- [ ] Bread\n- [x] Milk"), "then sinks below the open items")
        await h.snapshot("checklist-after-tick")
    }

    @Test func tickingDoesNotFocusTheEditorOrMoveTheCaret() async {
        // Reading, not editing: a tick is a click on a control, like Notes.
        let h = await EditorHarness(Self.note, focus: false)
        defer { h.close() }
        let before = h.selection
        await h.click(circle(h, "Milk"))
        #expect(h.text.contains("- [x] Milk"))
        #expect(h.window.firstResponder !== h.view, "the editor must not take the keyboard")
        await h.settle(ListEditing.sortDelay + 0.5)
        #expect(h.text.contains("- [ ] Bread\n- [x] Milk"))
        #expect(h.window.firstResponder !== h.view)
        #expect(h.selection == before, "caret untouched, got \(h.selection) from \(before)")
    }

    @Test func tickingWhileWritingElsewhereLeavesTheCaretWhereItWas() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        await h.caret(after: "After")
        let at = h.selection
        await h.click(circle(h, "Milk"))
        #expect(h.selection == at, "right after the tick")
        await h.settle(ListEditing.sortDelay + 0.5)
        #expect(h.text.contains("- [ ] Bread\n- [x] Milk"))
        #expect(h.selection == at, "and after the item sinks, got \(h.selection) from \(at)")
        #expect(h.window.firstResponder === h.view, "still writing")
    }

    @Test func sinkingSlidesTheRowsIntoPlace() async {
        guard !CheckPop.reduceMotion else { return }
        let h = await EditorHarness(Self.note, focus: false)
        defer { h.close() }
        await h.click(circle(h, "Milk"))
        await h.settle(ListEditing.sortDelay + 0.1)
        let sliding = h.view.layer?.sublayers?.filter { $0.animation(forKey: "slide") != nil }.count ?? 0
        #expect(sliding == 3, "all three rows slide, got \(sliding)")
        await h.snapshot("checklist-sliding")
        await h.settle(ReorderSlide.duration + 0.3)
        let left = h.view.layer?.sublayers?.filter { $0.zPosition >= 20 }.count ?? 0
        #expect(left == 0, "the slide cleans up after itself")
    }

    @Test func clickingLeftOfTheTextNeverPutsTheCaretInTheMarker() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        let r = h.lineRect(at: lineStart(h, "Eggs"))
        // Between the circle and the text.
        let c = circle(h, "Eggs")
        await h.click(CGPoint(x: c.x + EditorMetrics.checkSize * 0.9, y: r.midY))
        let lineAt = (h.text as NSString).lineRange(for: NSRange(location: lineStart(h, "Eggs"), length: 0)).location
        #expect(h.selection.location >= lineAt + 6, "caret after the hidden “- [ ] ”, got \(h.selection.location - lineAt)")
    }

    @Test func returnContinuesAndEmptyItemEndsTheList() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        await h.caret(after: "Bread")
        await h.press(EditorHarness.returnKey)
        #expect(h.text.contains("- [ ] Bread\n- [ ] \n"))
        await h.press(EditorHarness.returnKey)
        #expect(h.text.contains("- [ ] Bread\n\n"), "Return on an empty item leaves the list")
        #expect(!h.text.contains("- [ ] \n"))
    }

    @Test func arrowLeftFromTheTextGoesToThePreviousLine() async {
        let h = await EditorHarness(Self.note)
        defer { h.close() }
        let eggs = lineStart(h, "Eggs")
        await h.select(eggs)
        await h.press(EditorHarness.left)
        #expect(h.selection.location == lineStart(h, "Milk") + 4, "end of the Milk line, not inside Eggs' marker")
    }

    @Test func checklistShortcutTogglesTheLine() async {
        let h = await EditorHarness("Todo\n\nBuy milk\n")
        defer { h.close() }
        await h.caret(after: "Buy milk")
        h.controller.checklist()
        await h.settle()
        #expect(h.text.contains("- [ ] Buy milk"))
        h.controller.checklist()
        await h.settle()
        #expect(h.text.contains("\nBuy milk"))
    }

    @Test func darkModeSnapshot() async {
        let h = await EditorHarness(Self.note + "\n\n- [x] Done thing\n- Bullet\n1. Numbered\n> Quote", dark: true)
        defer { h.close() }
        await h.snapshot("checklist-dark")
    }
}
#endif
