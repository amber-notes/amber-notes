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
        #expect(md.contains("- Monday"))
        #expect(md.contains("  - Museum"))
        #expect(md.contains("1. First"))
        #expect(md.contains("2. Second"))
        #expect(md.contains("~~Cancelled~~"))
        #expect(md.contains("a \\* star"))
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

    @Test func plainTextStaysPlain() {
        let md = RichTextToMarkdown.markdown(from: NSAttributedString(string: "Just words\nand more", attributes: [.font: PFont.systemFont(ofSize: 13)]))
        #expect(md == "Just words\nand more")
    }
}
