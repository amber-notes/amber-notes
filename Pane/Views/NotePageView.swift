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
final class NotePageSandbox: NSObject, WKScriptMessageHandlerWithReply, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    /// Applies a page's edit to the note; throws to tell the page why not.
    var onUpdate: (NotePage.Op) throws -> Void = { _ in }
    /// The page has drawn its first frame: shown from then on, so it never flashes blank.
    var onReady: () -> Void = {}
    /// It threw while loading, or drew nothing: the reasons.
    var onFailure: ([String]) -> Void = { _ in }
    /// Requests and navigations the sandbox stopped (for the Dev readout and tests).
    private(set) var blocked: [String] = []

    static let policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; "
        + "connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'"

    /// Every request is blocked; the page's own document is given as a string, not loaded.
    static let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}}]"#
    private static var compiled: WKContentRuleList?

    /// One sandbox made ahead of time, its web content process already running, so opening a note
    /// with a page doesn't wait for one to start.
    private static var spare: NotePageSandbox?

    /// Compiles the rules and starts a spare sandbox. Called at launch and whenever the spare is taken.
    static func prewarm() {
        Task { @MainActor in
            guard spare == nil, let rules = try? await prepare() else { return }
            let s = NotePageSandbox(rules: rules)
            s.loading = true
            s.webView.loadHTMLString("<!doctype html><title></title>", baseURL: nil)
            spare = s
        }
    }

    /// The spare sandbox if there is one, else a new one; another spare starts behind it.
    static func make() async throws -> NotePageSandbox {
        defer { prewarm() }
        if let s = spare { spare = nil; return s }
        return NotePageSandbox(rules: try await prepare())
    }

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
        // Through a weak proxy: the content controller keeps its handlers alive, and the sandbox
        // must go when its view does.
        let proxy = WeakHandler(self)
        config.userContentController.addScriptMessageHandler(proxy, contentWorld: .page, name: "amber")
        config.userContentController.add(proxy, contentWorld: .page, name: "amberReady")
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
        return #"<!doctype html><meta http-equiv="Content-Security-Policy" content="\#(policy)"><meta name="viewport" content="width=device-width, initial-scale=1">"#
            + #"<style id="amber-theme">\#(NotePageTheme.css)</style>"# + rest
    }

    static func bootstrap(data: [String: Any]) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        (() => {
          const listeners = [];
          // Load errors, and whether anything showed, go to the app once the first frame is drawn.
          const errors = [];
          const failed = (e) => errors.push(String((e && e.message) || e));
          const amber = {
            note: \(json),
            update(op) {
              return window.webkit.messageHandlers.amber.postMessage(op).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
            },
            onChange(fn) {
              listeners.push(fn);
              try { fn(amber.note); } catch (e) { failed(e); console.error(e); }
            },
          };
          Object.defineProperty(amber, "_receive", { value(note) {
            amber.note = note;
            for (const fn of listeners) { try { fn(note); } catch (e) { console.error(e); } }
          } });
          window.amber = amber;
          addEventListener("error", (e) => failed(e.message || e));
          addEventListener("unhandledrejection", (e) => failed(e.reason));
          // After the first frame; a hidden view may never draw one, so a timer stands in.
          let told = false;
          const tell = () => {
            if (told) return;
            told = true;
            const b = document.body;
            const empty = !b || ![...b.querySelectorAll("*")].some((el) => el.tagName !== "SCRIPT" && el.tagName !== "STYLE" && el.getClientRects().length && (el.textContent.trim() || ["SVG", "IMG", "CANVAS", "INPUT", "BUTTON"].includes(el.tagName.toUpperCase())));
            try { window.webkit.messageHandlers.amberReady.postMessage({ errors: errors.slice(0, 5), empty }); } catch (e) {}
          };
          addEventListener("load", () => {
            requestAnimationFrame(() => requestAnimationFrame(tell));
            setTimeout(tell, 1000);
          });
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

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "amberReady" else { return }
        let m = message.body as? [String: Any]
        let errors = (m?["errors"] as? [String]) ?? []
        if (m?["empty"] as? Bool) == true || !errors.isEmpty {
            onFailure(errors.isEmpty ? ["The page drew nothing."] : errors)
        } else {
            onReady()
        }
    }

    // MARK: Nowhere to go

    fileprivate var loading = false

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

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        blocked.append("window \(action.request.url?.absoluteString ?? "")")
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {}
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool { false }
}

/// A note's page on screen. Rebuilt when the page changes; the note's text goes in as it changes.
/// While the page loads, the picture of it from last time shows in its place.
struct NotePageView: View {
    let noteID: UUID
    let html: String
    let text: String
    let onUpdate: (NotePage.Op) throws -> Void
    /// The page threw while loading or drew nothing.
    var onFailure: ([String]) -> Void = { _ in }
    @State private var sandbox: NotePageSandbox?
    @State private var failed: String?
    @State private var ready = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .top) {
            if !ready, let shot = NotePageSnapshots.shared.image(noteID, html: html, dark: scheme == .dark) {
                snapshot(shot)
                    .onAppear { NotePageTiming.shown(noteID, "snapshot") }
            }
            if let sandbox {
                WebViewHost(view: sandbox.webView)
                    .opacity(ready ? 1 : 0)
            } else if let failed {
                ContentUnavailableView("Can't show this page", systemImage: "exclamationmark.triangle", description: Text(failed))
            }
        }
        .task(id: html) {
            do {
                let s = try await NotePageSandbox.make()
                s.onUpdate = onUpdate
                ready = false
                s.onReady = { [noteID, html, scheme] in
                    NotePageTiming.shown(noteID, "interactive")
                    withAnimation(.easeOut(duration: 0.15)) { ready = true }
                    // The picture for next time, once the page has settled.
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        NotePageSnapshots.shared.take(s.webView, noteID, html: html, dark: scheme == .dark)
                    }
                }
                s.onFailure = onFailure
                s.load(html: html, body: text)
                sandbox = s
            } catch {
                failed = error.localizedDescription
            }
        }
        .onChange(of: text) { _, now in sandbox?.push(body: now) }
    }

    @ViewBuilder
    private func snapshot(_ image: PImage) -> some View {
        #if os(iOS)
        Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, alignment: .top).allowsHitTesting(false)
        #else
        Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, alignment: .top).allowsHitTesting(false)
        #endif
    }
}

/// The last picture of each note's page, per appearance, kept in memory and in Caches. Shown only
/// for the same page; the note's data may have moved on, and the live page replaces it at once.
@MainActor
final class NotePageSnapshots {
    static let shared = NotePageSnapshots()
    private var images: [String: PImage] = [:]
    /// The newest picture per note and appearance, shown while a new page loads in its place.
    private var latest: [String: PImage] = [:]
    private let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "note-page-snapshots", directoryHint: .isDirectory)

    private func key(_ id: UUID, _ html: String, _ dark: Bool) -> String {
        "\(id.uuidString)-\(E2EE.sha256Hex(html).prefix(16))-\(dark ? "d" : "l")"
    }

    func image(_ id: UUID, html: String, dark: Bool) -> PImage? {
        let k = key(id, html, dark)
        if let i = images[k] { return i }
        guard let data = try? Data(contentsOf: dir.appending(path: k + ".png")), let i = PImage(data: data) else {
            return latest["\(id.uuidString)-\(dark)"]
        }
        images[k] = i
        return i
    }

    func take(_ web: WKWebView, _ id: UUID, html: String, dark: Bool) {
        let k = key(id, html, dark)
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = false
        web.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self, let image else { return }
            Task { @MainActor in
                self.images[k] = image
                self.latest["\(id.uuidString)-\(dark)"] = image
                #if os(iOS)
                let png = image.pngData()
                #else
                let png = image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }
                #endif
                guard let png else { return }
                try? FileManager.default.createDirectory(at: self.dir, withIntermediateDirectories: true)
                try? png.write(to: self.dir.appending(path: k + ".png"), options: .atomic)
            }
        }
    }
}

/// Amber Notes' look, as CSS variables every page gets (see the set_note_page description).
enum NotePageTheme {
    #if os(iOS)
    static let surface = (0xF4F1EE, 0x1C1B1A), fill = (0xEBE6E1, 0x2C2A28), radius = (14, 10), size = 17
    #else
    static let surface = (0xF4F1EE, 0x2A2927), fill = (0xEBE6E1, 0x34322F), radius = (10, 6), size = 14
    #endif

    static let css: String = {
        func hex(_ c: PColor, dark: Bool) -> String {
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            #if os(iOS)
            c.resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light)).getRed(&r, green: &g, blue: &b, alpha: &a)
            #else
            NSAppearance(named: dark ? .darkAqua : .aqua)!.performAsCurrentDrawingAppearance {
                (c.usingColorSpace(.sRGB) ?? c).getRed(&r, green: &g, blue: &b, alpha: &a)
            }
            #endif
            return String(format: "#%02X%02X%02X", Int(round(r * 255)), Int(round(g * 255)), Int(round(b * 255)))
        }
        func h(_ v: Int) -> String { String(format: "#%06X", v) }
        func vars(dark: Bool) -> String {
            let d = dark
            return [
                "--amber-bg: \(hex(Palette.page, dark: d))",
                "--amber-surface: \(h(d ? surface.1 : surface.0))",
                "--amber-fill: \(h(d ? fill.1 : fill.0))",
                "--amber-text: \(hex(Palette.ink, dark: d))",
                "--amber-text-secondary: \(hex(Palette.muted, dark: d))",
                "--amber-separator: \(d ? "rgba(255, 250, 245, 0.10)" : "rgba(138, 74, 28, 0.14)")",
                "--amber-accent: \(hex(Palette.amber, dark: d))",
                "--amber-accent-text: \(hex(Palette.amberInk, dark: d))",
                "--amber-accent-soft: \(hex(Palette.amberSoft, dark: d))",
                "--amber-on-accent: \(d ? "#1F1300" : "#FFFFFF")",
                "--amber-danger: \(d ? "#FF6B5E" : "#C62828")",
            ].joined(separator: "; ")
        }
        return """
        :root { color-scheme: light dark; \(vars(dark: false)); --amber-radius: \(radius.0)px; --amber-radius-small: \(radius.1)px; \
        --amber-font: -apple-system, system-ui, sans-serif; --amber-font-rounded: ui-rounded, -apple-system, system-ui, sans-serif; \
        --amber-font-mono: ui-monospace, Menlo, monospace; }
        @media (prefers-color-scheme: dark) { :root { \(vars(dark: true)); } }
        body { margin: 0; background: var(--amber-bg); color: var(--amber-text); font: \(size)px/1.35 var(--amber-font); -webkit-text-size-adjust: 100%; }
        """
    }()
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

/// Passes the page's messages on without keeping the sandbox alive.
private final class WeakHandler: NSObject, WKScriptMessageHandlerWithReply, WKScriptMessageHandler {
    weak var target: NotePageSandbox?
    init(_ target: NotePageSandbox) { self.target = target }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard let target else { replyHandler(["ok": false, "error": "The page is closed."], nil); return }
        target.userContentController(c, didReceive: m, replyHandler: replyHandler)
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// Open-to-interactive time for pages (prototype measurements): from the note opening to the page's
/// first drawn frame. Written only with `-pageTimings`, to Documents/note-page-timings.txt.
@MainActor
enum NotePageTiming {
    static let enabled = ProcessInfo.processInfo.arguments.contains("-pageTimings")
    private static var opened: [UUID: ContinuousClock.Instant] = [:]

    static func open(_ id: UUID) {
        guard enabled else { return }
        opened[id] = .now
    }

    static func shown(_ id: UUID, _ what: String) {
        guard enabled, let start = opened[id] else { return }
        let ms = (ContinuousClock.now - start) / .milliseconds(1)
        let line = "\(what) \(String(format: "%.0f", ms))\n"
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "note-page-timings.txt")
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
        if what == "interactive" { opened[id] = nil }
    }
}
