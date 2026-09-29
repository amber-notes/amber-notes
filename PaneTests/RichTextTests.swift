import Foundation
import Testing
@testable import Pane

@MainActor
@Suite struct RichTextTests {
    // The shape of an Apple Notes body as AppleScript and the pasteboard deliver it.
    let appleNotesHTML = """
    <div><h1>Trip plan</h1></div>
    <div>Pack <b>light</b> and <i>early</i>, see <a href="https://maps.apple.com">the map</a>.</div>
    <div><br></div>
    <div><h2>Days</h2></div>
    <ul><li>Monday</li><li>Tuesday<ul><li>Museum</li></ul></li></ul>
    <ol><li>First</li><li>Second</li></ol>
    <div><strike>Cancelled</strike> stuff with a * star</div>
    """

    @Test func convertsHeadingsInlineAndLists() {
        let md = RichTextToMarkdown.markdown(fromHTML: appleNotesHTML)
        #expect(md.contains("# Trip plan"))
        #expect(md.contains("## Days"))
        #expect(md.contains("Pack **light** and *early*, see [the map](https://maps.apple.com"))
        #expect(md.contains("* Monday"))
        #expect(md.contains("  * Museum"))
        #expect(md.contains("1. First"))
        #expect(md.contains("2. Second"))
        #expect(md.contains("~~Cancelled~~"))
        // A lone star between spaces can't become emphasis, so it stays as typed.
        #expect(md.contains("a * star"))
    }

    // Shapes Apple Notes produces that used to break on import.

    @Test func boldListItemsKeepTheirBulletOutOfTheBold() {
        let md = RichTextToMarkdown.markdown(fromHTML: "<ul><li><b>Pack early</b></li><li><b>Label:</b> the rest</li></ul>")
        #expect(md == "* **Pack early**\n* **Label:** the rest")
    }

    @Test func boldOrderedItemsToo() {
        let md = RichTextToMarkdown.markdown(fromHTML: "<ol><li><b>One</b> thing</li><li>Two</li></ol>")
        #expect(md == "1. **One** thing\n2. Two")
    }

    @Test func aParagraphAfterAListGetsABlankLine() {
        // Without it markdown folds the paragraph into the last item.
        let md = RichTextToMarkdown.markdown(fromHTML: "<ul><li>Apples</li><li>Pears</li></ul><div><b>Next</b></div>")
        #expect(md == "* Apples\n* Pears\n\n**Next**")
    }

    @Test func lineBreaksInsideAnItemStayInTheItem() {
        let md = RichTextToMarkdown.markdown(fromHTML: "<ol><li>Taste it.<br><br>Then serve.</li></ol><ul><li><b><br></b>Lead break</li></ul>")
        #expect(md.contains("1. Taste it.\n\n  Then serve."))
        #expect(md.contains("* Lead break"))
        #expect(!md.contains("\u{2028}"))
    }

    @Test func notesDashedAndBulletedListsStaySeparate() {
        // Notes' Bulleted List is a plain <ul>; its Dashed List carries the Apple-dash-list class.
        let md = RichTextToMarkdown.markdown(fromHTML: "<ul><li>Dot</li></ul><div>x</div><ul class=\"Apple-dash-list\"><li>Dash</li><li>Dash two</li></ul>")
        #expect(md.contains("* Dot"))
        #expect(md.contains("- Dash\n- Dash two"))
    }

    @Test func noEmptyEmphasisOrStrayBullets() {
        let md = RichTextToMarkdown.markdown(fromHTML: "<ul><li><b>A</b><b>B</b></li></ul><div><b><br></b></div><div>x</div>")
        #expect(!md.contains("****"))
        #expect(!md.contains("•"))
        #expect(!md.contains("\t"))
        #expect(md.contains("**AB**"))
    }

    @Test func onlyEscapesWhatWouldBecomeMarkdown() {
        let md = RichTextToMarkdown.markdown(fromHTML: "<div>snake_case and 2 * 3 and `tick` and _lead</div>")
        #expect(md.contains("snake_case"))
        #expect(md.contains("2 * 3"))
        #expect(md.contains("\\`tick\\`"))
        #expect(md.contains("\\_lead"))
    }

    @Test func nonBreakingSpacesBecomeSpaces() {
        let md = RichTextToMarkdown.markdown(fromHTML: "<div>a&nbsp;b&nbsp;&nbsp;</div>")
        #expect(md == "a b")
    }

    #if os(macOS)
    @Test func convertsTables() {
        let html = "<div>Scores</div><table><tr><td>Name</td><td>Score</td></tr><tr><td>Ann</td><td>5</td></tr></table>"
        let md = RichTextToMarkdown.markdown(fromHTML: html)
        #expect(md.contains("| Name | Score |"))
        #expect(md.contains("| Ann | 5 |"))
        #expect(md.contains("| --- | --- |") || md.contains("| --- |"))
    }
    #endif

    @Test func monospacedMarkdownImportsAsIs() {
        let html = "<div><tt># Title</tt></div><div><tt>- one</tt></div><div><tt>- **two**</tt></div>"
        #expect(RichTextToMarkdown.markdown(fromHTML: html) == "# Title\n- one\n- **two**")
    }

    @Test func monospacedRunsBecomeFencedCode() {
        let html = "<div>Run this:</div><div>and then</div><div>more words here to outweigh</div><div><tt>let a = 1</tt></div><div><tt>print(a)</tt></div><div>Done, with plenty of ordinary text after it.</div>"
        let md = RichTextToMarkdown.markdown(fromHTML: html)
        #expect(md.contains("```\nlet a = 1\nprint(a)\n```"))
    }

    @Test func pastingImagesWinsOverTheirAddress() {
        #expect(RichPaste.kind(hasImage: true, text: nil, htmlIsOnlyImage: false) == .image)
        #expect(RichPaste.kind(hasImage: true, text: "https://example.com/cat.png", htmlIsOnlyImage: false) == .image)
        #expect(RichPaste.kind(hasImage: true, text: "A cat", htmlIsOnlyImage: true) == .image)
        #expect(RichPaste.kind(hasImage: true, text: "A paragraph about cats", htmlIsOnlyImage: false) == .richText)
        #expect(RichPaste.htmlIsOnlyImage("<meta charset=utf-8><img src=\"x.png\">"))
        #expect(!RichPaste.htmlIsOnlyImage("<p>Hello <img src=\"x.png\"></p>"))
    }

    @Test func plainTextStaysPlain() {
        let md = RichTextToMarkdown.markdown(from: NSAttributedString(string: "Just words\nand more", attributes: [.font: PFont.systemFont(ofSize: 13)]))
        #expect(md == "Just words\nand more")
    }
}
