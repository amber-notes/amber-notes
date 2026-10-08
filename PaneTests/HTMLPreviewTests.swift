import Foundation
import Testing
import WebKit
@testable import Pane

/// An HTML file's Preview (CodeFileView.swift, LockedHTML): a hostile page runs no script, reaches
/// nothing on the network, goes nowhere and submits nothing. Links open in the browser on a click
/// only. No window: the web view loads on its own.
@MainActor @Suite(.serialized) struct HTMLPreviewTests {
    typealias Listener = NotePageTests.Listener

    /// Links handed to the browser.
    @MainActor final class Opened { var urls: [URL] = [] }

    /// A page that tries every way out without script, and some with it, toward `base`.
    static func hostilePage(_ base: String) -> String {
        """
        <!DOCTYPE html><html><head><title>Safe</title>
        <meta http-equiv="refresh" content="0; url=\(base)/refresh">
        <link rel="stylesheet" href="\(base)/css"><link rel="preload" href="\(base)/preload" as="image">
        <link rel="icon" href="\(base)/icon"><link rel="prefetch" href="\(base)/prefetch">
        <base href="\(base)/base/">
        <style>@import url("\(base)/import"); body { background: url("\(base)/bg"); } @font-face { font-family: x; src: url("\(base)/font"); } p { font-family: x; }</style>
        <script src="\(base)/script.js"></script>
        <script>document.title = "ran"; fetch("\(base)/fetch"); new Image().src = "\(base)/beacon"; location.href = "\(base)/nav";</script>
        </head><body onload="document.title = 'onload ran'">
        <p>Hello</p>
        <img src="\(base)/img"><img srcset="\(base)/srcset 2x"><picture><source srcset="\(base)/source"><img></picture>
        <svg><image href="\(base)/svg-image"/></svg>
        <iframe src="\(base)/frame"></iframe><iframe srcdoc="<img src='\(base)/srcdoc'>"></iframe>
        <object data="\(base)/object"></object><embed src="\(base)/embed">
        <video src="\(base)/video" autoplay poster="\(base)/poster"></video><audio src="\(base)/audio" autoplay></audio>
        <form id="f" action="\(base)/form" method="post"><input name="n" value="x" autofocus onfocus="document.title = 'focus ran'"></form>
        <a id="link" href="\(base)/link">A link</a>
        <a id="blank" href="https://example.com/away" target="_blank">Away</a>
        <img src="x" onerror="document.title = 'onerror ran'">
        <a id="js" href="javascript:document.title='href ran'">js</a>
        </body></html>
        """
    }

    func load(_ html: String, delegate: LockedHTMLDelegate) async throws -> WKWebView {
        let web = LockedHTMLView.make(html, delegate: delegate)
        for _ in 0..<200 {
            if delegate.firstLoadDone, (try? await web.evaluateJavaScript("document.readyState")) as? String == "complete" { return web }
            try await Task.sleep(for: .milliseconds(50))
        }
        Issue.record("the preview never loaded")
        return web
    }

    @Test func aHostilePageRunsNothingAndReachesNothing() async throws {
        // The same page in a plain web view does reach its listener: the test can tell.
        let control = try Listener()
        let controlPort = try await control.start()
        defer { control.listener.cancel() }
        let open = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        open.loadHTMLString(Self.hostilePage("http://127.0.0.1:\(controlPort)"), baseURL: nil)
        for _ in 0..<100 where control.connections == 0 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(control.connections > 0, "the control page should have reached its listener")
        open.stopLoading()

        let server = try Listener()
        let port = try await server.start()
        defer { server.listener.cancel() }
        let base = "http://127.0.0.1:\(port)"
        let delegate = LockedHTMLDelegate()
        let opened = Opened()
        delegate.open = { opened.urls.append($0) }
        let web = try await load(Self.hostilePage(base), delegate: delegate)
        try await Task.sleep(for: .seconds(2))

        // Script, inline handlers and javascript: links never ran (the app's own question still works).
        #expect(try await web.evaluateJavaScript("document.title") as? String == "Safe")
        // The app clicks the javascript: link, submits the form and follows a link without a click.
        _ = try? await web.evaluateJavaScript("document.getElementById('js').click(); document.getElementById('f').submit(); location.href = '\(base)/nav2'; 1")
        try await Task.sleep(for: .seconds(1))
        #expect(try await web.evaluateJavaScript("document.title") as? String == "Safe")
        #expect(server.connections == 0, "the preview reached the network")
        #expect(web.url?.absoluteString == "about:blank", "the preview went somewhere: \(web.url?.absoluteString ?? "")")
        #expect(opened.urls.isEmpty, "nothing was clicked, so nothing opens in the browser")
        // Nothing kept: no cookies, no storage.
        #expect(!web.configuration.websiteDataStore.isPersistent)
    }

    @Test func aClickedLinkOpensInTheBrowserAndThePreviewStays() async throws {
        let delegate = LockedHTMLDelegate()
        let opened = Opened()
        delegate.open = { opened.urls.append($0) }
        let web = try await load(#"<a href="https://example.com/docs">Docs</a> <a href="https://example.com/new" target="_blank">New</a> <a href="file:///etc/passwd">File</a>"#, delegate: delegate)
        #expect(LockedHTML.decide(.linkActivated, url: URL(string: "https://example.com/docs"), isFirstLoad: false) == (false, URL(string: "https://example.com/docs")))
        #expect(LockedHTML.decide(.linkActivated, url: URL(string: "file:///etc/passwd"), isFirstLoad: false) == (false, nil))
        #expect(LockedHTML.decide(.formSubmitted, url: URL(string: "https://example.com/f"), isFirstLoad: false) == (false, nil))
        #expect(LockedHTML.decide(.other, url: URL(string: "https://example.com/redirect"), isFirstLoad: false) == (false, nil))
        #expect(LockedHTML.decide(.other, url: URL(string: "https://example.com/first"), isFirstLoad: true) == (false, nil), "only the page's own text loads")
        #expect(LockedHTML.decide(.other, url: URL(string: "about:blank"), isFirstLoad: false) == (false, nil), "and only once")
        #expect(web.url?.absoluteString == "about:blank")
        #expect(opened.urls.isEmpty)
    }

    @Test func thePolicyComesFirstAndTheDoctypeGivesWay() {
        let sealed = LockedHTML.sealed("\u{FEFF}\n<!DOCTYPE html><html><head><title>x</title></head></html>")
        #expect(sealed.hasPrefix("<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none';"))
        #expect(sealed.hasSuffix("<html><head><title>x</title></head></html>"))
        #expect(!sealed.contains("<!DOCTYPE"))
        #expect(!LockedHTML.policy.contains("script-src"), "default-src 'none' covers script")
        #expect(LockedHTML.configuration().defaultWebpagePreferences.allowsContentJavaScript == false)
    }

    @Test func codeIsColouredByKindAndStringsKeepTheirKeywords() {
        let html = CodeLanguage(filename: "index.htm")
        #expect(html == .html && html.label == "HTML")
        let t = html.tokens(in: #"<!-- a --><a href="x">if</a>"#)
        #expect(t.contains { $0.0 == .comment && $0.1 == NSRange(location: 0, length: 10) })
        #expect(t.contains { $0.0 == .tag } && t.contains { $0.0 == .attribute } && t.contains { $0.0 == .string })
        let js = CodeLanguage(filename: "app.js").tokens(in: #"const s = "return"; // if"#)
        #expect(js.filter { $0.0 == .keyword }.count == 1, "keywords inside strings and comments stay strings and comments")
        #expect(CodeLanguage(filename: "notes.txt").tokens(in: "if return").isEmpty)
        #expect(CodeLanguage(filename: "Package.swift").label == "Swift")
    }
}
