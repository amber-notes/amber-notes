import SwiftUI
import WebKit

/// The locked web view a note's page runs in (prototype; see NotePage).
///
/// - JavaScript runs, but nothing loads or leaves: a Content Security Policy of `default-src 'none'`
///   (inline script and style, data: images and fonts only), a content rule list that blocks every
///   request, and a navigation policy that allows only the page itself. No cookies or storage
///   outlive the view.
/// - The page gets one note's data as `window.amber.note` and nothing else of the app.
/// - It changes the note only through `amber.update(op)`, a message the app checks and applies to
///   the markdown (NotePage.apply). It can't run anything in the app or edit text freely.
@MainActor
final class NotePageSandbox: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    /// Applies a page's edit to the note; throws to tell the page why not.
    var onUpdate: (NotePage.Op) throws -> Void = { _ in }
    /// The page has drawn: shown from then on, so it never flashes blank.
    var onReady: () -> Void = {}
    /// Requests and navigations the sandbox stopped (for the Dev readout and tests).
    private(set) var blocked: [String] = []

    static let policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; "
        + "connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'"

    /// Every request is blocked; the page's own document is given as a string, not loaded.
    static let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}}]"#
    private static var compiled: WKContentRuleList?

    /// Compiles the rule list once. Pages wait for it: none loads without it.
    static func prepare() async throws -> WKContentRuleList {
        if let compiled { return compiled }
        guard let list = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "amber-note-page-v1", encodedContentRuleList: rules) else {
            throw NotePage.OpError("The page sandbox couldn't start.")
        }
        compiled = list
        return list
    }

    init(rules: WKContentRuleList) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.userContentController.add(rules)
        #if os(iOS)
        config.dataDetectorTypes = []
        config.allowsInlineMediaPlayback = false
        #endif
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "amber")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if os(iOS)
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.accessibilityIdentifier = "notePage.web"
        #else
        webView.setValue(false, forKey: "drawsBackground")
        webView.setAccessibilityIdentifier("notePage.web")
        #endif
    }

    /// Shows `html` with `body` as its note. The document's own <!doctype> gives way to the policy.
    func load(html: String, body: String) {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: Self.bootstrap(data: NotePage.data(of: body)), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        loading = true
        webView.loadHTMLString(Self.sandboxed(html), baseURL: nil)
    }

    /// The note changed (the page's own edit, typing elsewhere, sync, Undo): the page re-renders.
    func push(body: String) {
        webView.callAsyncJavaScript("window.amber && window.amber._receive(note)", arguments: ["note": NotePage.data(of: body)], in: nil, in: .page) { _ in }
    }

    static func sandboxed(_ html: String) -> String {
        var rest = Substring(html)
        while let f = rest.first, f.isWhitespace || f == "\u{FEFF}" { rest = rest.dropFirst() }
        if rest.prefix(9).lowercased() == "<!doctype", let end = rest.firstIndex(of: ">") { rest = rest[rest.index(after: end)...] }
        return #"<!doctype html><meta http-equiv="Content-Security-Policy" content="\#(policy)"><meta name="viewport" content="width=device-width, initial-scale=1">"# + rest
    }

    static func bootstrap(data: [String: Any]) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (() => {
          const listeners = [];
          const amber = {
            note: \(json),
            update(op) {
              return window.webkit.messageHandlers.amber.postMessage(op).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
            },
            onChange(fn) {
              listeners.push(fn);
              try { fn(amber.note); } catch (e) { console.error(e); }
            },
          };
          Object.defineProperty(amber, "_receive", { value(note) {
            amber.note = note;
            for (const fn of listeners) { try { fn(note); } catch (e) { console.error(e); } }
          } });
          window.amber = amber;
        })();
        """
    }

    // MARK: The bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        do {
            try onUpdate(try NotePage.Op(message.body))
            replyHandler(["ok": true], nil)
        } catch {
            replyHandler(["ok": false, "error": (error as? LocalizedError)?.errorDescription ?? "That didn't work."], nil)
        }
    }

    // MARK: Nowhere to go

    private var loading = false

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        // Only the page itself, as it's first shown. Links, forms, reloads and redirects stay put.
        let url = action.request.url?.absoluteString ?? ""
        if loading, url == "about:blank", action.targetFrame?.isMainFrame == true {
            loading = false
            return .allow
        }
        blocked.append("navigation \(url)")
        return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onReady()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        blocked.append("window \(action.request.url?.absoluteString ?? "")")
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {}
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool { false }
}

/// A note's page on screen. Rebuilt when the page changes; the note's text goes in as it changes.
struct NotePageView: View {
    let html: String
    let text: String
    let onUpdate: (NotePage.Op) throws -> Void
    @State private var sandbox: NotePageSandbox?
    @State private var failed: String?
    @State private var ready = false

    var body: some View {
        Group {
            if let sandbox {
                WebViewHost(view: sandbox.webView)
                    .opacity(ready ? 1 : 0)
            } else if let failed {
                ContentUnavailableView("Can't show this page", systemImage: "exclamationmark.triangle", description: Text(failed))
            } else {
                Color.clear
            }
        }
        .task(id: html) {
            do {
                let s = NotePageSandbox(rules: try await NotePageSandbox.prepare())
                s.onUpdate = onUpdate
                ready = false
                s.onReady = { withAnimation(.easeOut(duration: 0.25)) { ready = true } }
                s.load(html: html, body: text)
                sandbox = s
            } catch {
                failed = error.localizedDescription
            }
        }
        .onChange(of: text) { _, now in sandbox?.push(body: now) }
    }
}

#if os(iOS)
private struct WebViewHost: UIViewRepresentable {
    let view: WKWebView
    func makeUIView(context: Context) -> WKWebView { view }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#else
private struct WebViewHost: NSViewRepresentable {
    let view: WKWebView
    func makeNSView(context: Context) -> WKWebView { view }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
