import Foundation
import Testing
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import Pane

@Suite struct ListEditingTests {
    func apply(_ text: String, _ e: TextEdit?) -> String {
        guard let e else { return text }
        return (text as NSString).replacingCharacters(in: e.range, with: e.replacement)
    }

    @Test func returnContinuesBullets() {
        let t = "- one"
        let e = ListEditing.returnKey(in: t, selection: NSRange(location: 5, length: 0))
        #expect(apply(t, e) == "- one\n- ")
        #expect(e?.caret == 8)
    }

    @Test func returnContinuesChecklistUnchecked() {
        let t = "- [x] done"
        #expect(apply(t, ListEditing.returnKey(in: t, selection: NSRange(location: 10, length: 0))) == "- [x] done\n- [ ] ")
    }

    @Test func returnIncrementsNumbers() {
        let t = "9. nine"
        #expect(apply(t, ListEditing.returnKey(in: t, selection: NSRange(location: 7, length: 0))) == "9. nine\n10. ")
    }

    @Test func returnOnEmptyItemEndsList() {
        let t = "- a\n- "
        let e = ListEditing.returnKey(in: t, selection: NSRange(location: 6, length: 0))
        #expect(apply(t, e) == "- a\n\n")
        #expect(e?.caret == 5)
    }

    @Test func returnOnEmptyNestedItemOutdents() {
        let t = "- a\n  - "
        #expect(apply(t, ListEditing.returnKey(in: t, selection: NSRange(location: 8, length: 0))) == "- a\n- ")
    }

    @Test func returnContinuesQuote() {
        let t = "> hi"
        #expect(apply(t, ListEditing.returnKey(in: t, selection: NSRange(location: 4, length: 0))) == "> hi\n> ")
        let e = "> hi\n> "
        #expect(apply(e, ListEditing.returnKey(in: e, selection: NSRange(location: 7, length: 0))) == "> hi\n")
    }

    @Test func returnOutsideListIsDefault() {
        #expect(ListEditing.returnKey(in: "hello", selection: NSRange(location: 5, length: 0)) == nil)
    }

    @Test func backspaceRemovesMarker() {
        let t = "- [ ] task"
        #expect(apply(t, ListEditing.backspace(in: t, selection: NSRange(location: 6, length: 0))) == "task")
    }

    @Test func backspaceMidTextIsDefault() {
        #expect(ListEditing.backspace(in: "- task", selection: NSRange(location: 4, length: 0)) == nil)
    }

    @Test func toggleCheckbox() {
        let t = "a\n- [ ] b"
        let once = apply(t, ListEditing.toggleCheckbox(in: t, lineStart: 2))
        #expect(once == "a\n- [x] b")
        #expect(apply(once, ListEditing.toggleCheckbox(in: once, lineStart: 2)) == t)
    }

    @Test func wrapAndUnwrapBold() {
        let t = "make this bold"
        let sel = NSRange(location: 10, length: 4)
        let wrapped = apply(t, ListEditing.wrap(in: t, selection: sel, with: "**"))
        #expect(wrapped == "make this **bold**")
        #expect(apply(wrapped, ListEditing.wrap(in: wrapped, selection: NSRange(location: 12, length: 4), with: "**")) == t)
    }

    @Test func boldWithoutSelectionWrapsWord() {
        let t = "make bold now"
        let e = ListEditing.wrap(in: t, selection: NSRange(location: 7, length: 0), with: "**")
        #expect(apply(t, e) == "make **bold** now")
        #expect(e.caret == 9)
    }

    @Test func headingToggles() {
        let t = "## Title"
        #expect(apply(t, ListEditing.heading(in: t, selection: NSRange(location: 3, length: 0), level: 1)) == "# Title")
        #expect(apply(t, ListEditing.heading(in: t, selection: NSRange(location: 3, length: 0), level: 2)) == "Title")
    }

    @Test func checklistToggleOnPlainLine() {
        let t = "buy milk"
        #expect(apply(t, ListEditing.toggleChecklist(in: t, selection: NSRange(location: 3, length: 0))) == "- [ ] buy milk")
    }
}

@Suite struct NoteTextTests {
    @Test func titleSkipsMarkup() {
        #expect(NoteText.title(of: "\n\n# **Trip** plan\nbody") == "Trip plan")
        #expect(NoteText.title(of: "") == "New Note")
    }

    @Test func previewIsSecondLine() {
        #expect(NoteText.preview(of: "Title\n\n- [ ] [Link](https://x.y) here") == "Link here")
        #expect(NoteText.preview(of: "Only title") == "No additional text")
    }
}

@Suite struct StylerTests {
    @Test func hidesSyntaxOffTheActiveLine() {
        let storage = NSTextStorage(string: "Title\nsome **bold** text\nlast")
        MarkdownStyler().apply(to: storage, active: NSRange(location: 0, length: 0))
        let font = storage.attribute(.font, at: 11, effectiveRange: nil) as? PFont
        #expect((font?.pointSize ?? 99) < 1, "** should be hidden when the caret is elsewhere")
    }

    @Test func showsSyntaxOnTheActiveLine() {
        let storage = NSTextStorage(string: "Title\nsome **bold** text\nlast")
        MarkdownStyler().apply(to: storage, active: NSRange(location: 12, length: 0))
        let font = storage.attribute(.font, at: 11, effectiveRange: nil) as? PFont
        #expect((font?.pointSize ?? 0) > 5)
    }

    @Test func handlesEmojiOffsets() {
        let storage = NSTextStorage(string: "🎉 Party\n**bold** 🎈 *it*")
        MarkdownStyler().apply(to: storage, active: NSRange(location: 0, length: 0))
        let ns = storage.string as NSString
        let it = ns.range(of: "it")
        let font = storage.attribute(.font, at: it.location, effectiveRange: nil) as? PFont
        #expect(font?.fontDescriptor.symbolicTraits.contains(.paneItalic) == true)
    }

    @Test func decoratesChecklist() {
        let storage = NSTextStorage(string: "T\n- [x] done")
        MarkdownStyler().apply(to: storage, active: NSRange(location: 0, length: 0))
        let d = storage.attribute(.paneLine, at: 2, effectiveRange: nil) as? LineDecoration
        #expect(d?.kind == .checkbox(checked: true))
    }
}
