import Foundation
import Testing
@testable import Pane

@Suite struct OfflineHTMLTests {
    @Test func nothingThatLoadsSurvives() {
        let hostile = """
        <html><head><link rel=stylesheet href="https://t.example/a.css"><style>@import url("https://t.example/b.css"); p{background:url(https://t.example/c.png)}</style>
        <meta http-equiv="refresh" content="0;url=https://t.example"><base href="https://t.example/"></head>
        <body background="https://t.example/bg.png"><img src="https://t.example/pixel.gif"><IMG SRC=https://t.example/x.gif>
        <iframe src="https://t.example/frame"></iframe><script>fetch('https://t.example')</script>
        <p style="background-image: url('https://t.example/d.png')">Hello <b>bold</b> <a href="https://example.com/page">a link</a></p>
        <video poster="https://t.example/p.jpg"><source src="https://t.example/v.mp4"></video><svg><image href="https://t.example/s.png"/></svg>
        <object data="https://t.example/o.swf"></object><input type=image src="https://t.example/i.png"></body></html>
        """
        let safe = OfflineHTML.strip(hostile)
        #expect(!safe.contains("t.example"), "\(safe)")
        #expect(safe.contains("<b>bold</b>"))
        #expect(safe.contains(#"href="https://example.com/page""#), "ordinary links stay")
    }

    @MainActor @Test func conversionKeepsTheText() {
        let md = RichTextToMarkdown.markdown(fromHTML: #"<p>Hello <b>bold</b> <img src="https://t.example/pixel.gif"> <a href="https://example.com">link</a></p>"#)
        #expect(md.contains("**bold**"))
        #expect(md.contains("[link](https://example.com"))
    }
}
