import ImageIO
import SwiftData
import SwiftUI
import UniformTypeIdentifiers
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
    /// The page's own data and files (amber.store, amber.files): returns the reply.
    var onData: @MainActor (Any) async throws -> [String: Any] = { _ in throw NotePage.OpError("Not available.") }
    /// The page has drawn its first frame: shown from then on, so it never flashes blank.
    var onReady: () -> Void = {}
    /// It threw while loading, or drew nothing: the reasons.
    var onFailure: ([String]) -> Void = { _ in }
    /// A text field in the page gained or lost focus (the app keeps receipts out of its way).
    var onFocus: (Bool) -> Void = { _ in }
    /// Requests and navigations the sandbox stopped (for the Dev readout and tests).
    private(set) var blocked: [String] = []

    static let policy = "default-src 'none'; script-src 'unsafe-inline' amber-lib:; style-src 'unsafe-inline'; img-src data: amber-file:; font-src data:; media-src data: amber-file:; "
        + "connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'"

    /// Every request is blocked; the page's own document is given as a string, not loaded.
    /// The note's own files (amber-file:, served by the app from this device) are the one exception.
    static let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},{"trigger":{"url-filter":"^amber-file:"},"action":{"type":"ignore-previous-rules"}},{"trigger":{"url-filter":"^amber-lib:"},"action":{"type":"ignore-previous-rules"}}]"#
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
        guard let list = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "amber-note-page-v3", encodedContentRuleList: rules) else {
            throw NotePage.OpError("The app couldn't start.")
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
        let scheme = FileScheme()
        config.setURLSchemeHandler(scheme, forURLScheme: "amber-file")
        config.setURLSchemeHandler(libraries, forURLScheme: "amber-lib")
        #if os(iOS)
        config.dataDetectorTypes = []
        config.allowsInlineMediaPlayback = false
        #endif
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        scheme.owner = self
        // Through a weak proxy: the content controller keeps its handlers alive, and the sandbox
        // must go when its view does.
        let proxy = WeakHandler(self)
        config.userContentController.addScriptMessageHandler(proxy, contentWorld: .page, name: "amber")
        config.userContentController.add(proxy, contentWorld: .page, name: "amberReady")
        config.userContentController.addScriptMessageHandler(proxy, contentWorld: .page, name: "amberData")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if os(iOS)
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // An app scrolls up and down; a page a little too wide never pans sideways.
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.accessibilityIdentifier = "notePage.web"
        #else
        webView.setValue(false, forKey: "drawsBackground")
        webView.setAccessibilityIdentifier("notePage.web")
        #endif
    }

    /// Shows `html` with `body` as its note. The document's own <!doctype> gives way to the policy.
    /// Libraries (amber-lib:): the bundled set, and the npm packages this page declared.
    private let libraries = LibraryScheme()

    /// The note's files the page may show (amber.files.url): nil for any other.
    var files: @MainActor (UUID) -> URL? = { _ in nil }

    /// Shown inside its parent note, smaller: the page gets the class amber-widget on <html>.
    var isWidget = false

    func load(html: String, body: String, data: NotePageData.Doc = NotePageData.empty(), restore: String? = nil) {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        libraries.allowed = Set(NotePageLibraries.declared(in: html).compactMap { if case .npm(let r) = $0 { r } else { nil } })
        ucc.addUserScript(WKUserScript(source: Self.bootstrap(data: NotePage.data(of: body), store: data, restore: restore, settings: NotePageSettings.defaults(in: html), widget: isWidget),
                                       injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        loading = true
        webView.loadHTMLString(Self.sandboxed(html), baseURL: nil)
    }

    /// The note changed (the page's own edit, typing elsewhere, sync, Undo): the page re-renders.
    func push(body: String, data: NotePageData.Doc? = nil) {
        webView.callAsyncJavaScript("window.amber && window.amber._receive(note, data)", arguments: ["note": NotePage.data(of: body), "data": data ?? NSNull()], in: nil, in: .page) { _ in }
    }

    static func sandboxed(_ html: String) -> String {
        var rest = Substring(html)
        while let f = rest.first, f.isWhitespace || f == "\u{FEFF}" { rest = rest.dropFirst() }
        if rest.prefix(9).lowercased() == "<!doctype", let end = rest.firstIndex(of: ">") { rest = rest[rest.index(after: end)...] }
        return #"<!doctype html><meta http-equiv="Content-Security-Policy" content="\#(policy)"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">"#
            + #"<style id="amber-theme">\#(NotePageTheme.css)</style>"# + NotePageLibraries.scriptTags(for: html) + rest
    }

    /// How the page is being used right now, for swapping in a new version: how long since you
    /// last touched it, whether a field has focus, and what's typed and where it's scrolled (JSON,
    /// for `load(restore:)`).
    func state() async -> (idle: Double, focused: Bool, snapshot: String?) {
        let r = try? await webView.callAsyncJavaScript("return window.amber && window.amber._state ? JSON.stringify(window.amber._state()) : null", arguments: [:], in: nil, contentWorld: .page)
        guard let json = r as? String, let d = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return (.infinity, false, nil) }
        return ((d["idle"] as? Double) ?? .infinity, (d["focused"] as? Bool) ?? false, json)
    }

    static func bootstrap(data: [String: Any], store: NotePageData.Doc = NotePageData.empty(), restore: String? = nil, settings: [String: Any] = [:], widget: Bool = false) -> String {
        let defaults = (try? JSONSerialization.data(withJSONObject: settings)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let libGlobals = (try? JSONSerialization.data(withJSONObject: Dictionary(NotePageLibraries.bundled.map { ($0.name, $0.global) }, uniquingKeysWith: { a, _ in a })))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let libRequires = (try? JSONSerialization.data(withJSONObject: Dictionary(NotePageLibraries.bundled.map { ($0.name, $0.requires ?? []) }, uniquingKeysWith: { a, _ in a })))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let json = (try? JSONSerialization.data(withJSONObject: data)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let storeJSON = String(data: NotePageData.encode(store), encoding: .utf8) ?? "{}"
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
              try { fn(amber.note, amber.data); } catch (e) { failed(e); console.error(e); }
            },
            // The page's own data: never in the note's text.
            data: \(storeJSON),
            setData(patch) { return ask({ op: "store.patch", patch }); },
            store: {
              get: (key) => Promise.resolve(amber.data.values[key]),
              set: (key, value) => ask({ op: "store.set", key, value: value === undefined ? null : value }),
              collection(name) {
                const list = () => (amber.data.collections[name] || []).slice();
                return {
                  list: () => Promise.resolve(list()),
                  query: (fn) => Promise.resolve(list().filter(fn)),
                  get: (id) => Promise.resolve(list().find((r) => r.id === id)),
                  add: (fields) => ask({ op: "collection.add", name, fields }),
                  update: (id, patch) => ask({ op: "collection.update", name, id, patch }),
                  remove: (id) => ask({ op: "collection.remove", name, id }),
                };
              },
              subscribe(fn) { amber.onChange((note, data) => fn(data)); },
            },
            // Files (photos, recordings, PDFs) in the encrypted file storage; records keep the ref.
            files: {
              save: (file) => ask({ op: "file.save", ...file }),
              read: (ref) => ask({ op: "file.read", id: (ref && ref.$file) || ref }),
              // An address for <img>, <audio> or <video> right away (no data: URL in the data):
              // only for files this note or its app's data refer to. width: a smaller picture.
              url: (ref, o) => "amber-file:///" + ((ref && ref.$file) || ref) + (o && o.width ? "?w=" + Math.round(o.width) : ""),
            },
            // The device, through the system's own prompts and pickers. Results go to the page only.
            device: {
              reminders: {
                create: (r) => ask({ op: "device.reminders.create", ...r }),
                complete: (id) => ask({ op: "device.reminders.complete", id }),
                delete: (id) => ask({ op: "device.reminders.delete", id }),
              },
              calendar: { today: () => ask({ op: "device.calendar.today" }) },
              notify: Object.assign((n) => ask({ op: "device.notify", ...n }), { cancel: (id) => ask({ op: "device.notify.cancel", id }) }),
              openURL: (url) => ask({ op: "device.openURL", url }),
              photos: { pick: (o) => ask({ op: "device.photos.pick", ...(o || {}) }) },
              camera: { take: () => ask({ op: "device.camera.take" }) },
              contacts: { pick: () => ask({ op: "device.contacts.pick" }) },
              files: { pick: () => ask({ op: "device.files.pick" }) },
              location: { once: () => ask({ op: "device.location.once" }) },
              maps: { open: (p) => ask({ op: "device.maps.open", ...p }), snapshot: (p) => ask({ op: "device.maps.snapshot", ...p }) },
              weather: { current: (p) => ask({ op: "device.weather.current", ...(p || {}) }) },
            },
            // Apple's on-device model: nothing leaves the device.
            ai: {
              available: () => ask({ op: "device.ai.available" }),
              respond: (prompt, o) => ask({ op: "device.ai.respond", prompt, ...(o || {}) }),
            },
            // Through the app, to hosts the page declared and you allowed, logged; keys added by the app.
            fetch: (url, o) => ask({ op: "fetch", url, ...(o || {}) }),
          };
          // The native App Settings sheet (in a widget, nothing: Open the app first).
          amber.openSettings = () => ask({ op: "app.settings" });
          // A write's reply carries the new data, so it's there as soon as the promise resolves.
          const ask = (msg) => window.webkit.messageHandlers.amberData.postMessage(msg)
            .then((r) => { if (r && r.data) amber.data = r.data; if (r) delete r.data; return r; })
            .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
          Object.defineProperty(amber, "_receive", { value(note, data) {
            amber.note = note;
            if (data) amber.data = data;
            for (const fn of listeners) { try { fn(note, amber.data); } catch (e) { console.error(e); } }
          } });
          // Libraries: amber.lib("chart") loads a bundled one (declared ones are already there).
          const libGlobals = \(libGlobals);
          const libRequires = \(libRequires);
          amber.lib = async (name) => {
            const g = libGlobals[name];
            if (g && window[g]) return window[g];
            for (const r of libRequires[name] || []) await amber.lib(r);
            return new Promise((ok, no) => {
              const s = document.createElement("script");
              s.src = "amber-lib:///" + name;
              s.onload = () => ok(g ? window[g] : true);
              s.onerror = () => no(new Error("No library " + name + ". Bundled: " + Object.keys(libGlobals).join(", ")));
              document.head.appendChild(s);
            });
          };
          // Where the app is: full screen, or a widget in its parent note; its real size.
          Object.defineProperty(amber, "context", { get() { return { embedded: \(widget ? "true" : "false"), width: window.innerWidth, height: window.innerHeight }; } });
          const markContext = () => { if (document.documentElement) document.documentElement.dataset.amberContext = \(widget ? "\"widget\"" : "\"full\""); };
          markContext();
          addEventListener("DOMContentLoaded", markContext);
          // Which field has focus, for the app: nothing of its own is drawn over a field you're typing in.
          const isField = (e) => !!e && (e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable ||
            (e.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(e.type)));
          let lastFocus = false;
          const sendFocus = () => { const f = isField(document.activeElement); if (f === lastFocus) return; lastFocus = f;
            try { window.webkit.messageHandlers.amberReady.postMessage({ focus: f }); } catch (e) {} };
          addEventListener("focusin", sendFocus, true);
          addEventListener("focusout", () => setTimeout(sendFocus, 0), true);
          // App settings (<meta name="amber-settings">): the defaults, with what you set in App Settings.
          const settingDefaults = \(defaults);
          Object.defineProperty(amber, "settings", { get() { return Object.assign({}, settingDefaults, (amber.data.values && amber.data.values.settings) || {}); } });
          window.amber = amber;
          // For swapping in a new version while you use it: when you last touched the page, what's
          // in its fields and where it's scrolled; and putting that back into the new version.
          let touched = 0;
          for (const t of ["pointerdown", "keydown", "input", "wheel", "touchstart"]) addEventListener(t, () => { touched = Date.now(); }, true);
          const fields = () => [...document.querySelectorAll("input, textarea, select")].filter((e) => (e.id || e.name) && e.type !== "file" && e.type !== "password")
            .map((e) => ({ key: e.id ? "#" + e.id : "@" + e.name, value: e.value, checked: e.checked, focused: e === document.activeElement }));
          Object.defineProperty(amber, "_state", { value() {
            const a = document.activeElement;
            const focused = !!a && a !== document.body && a.matches("input, textarea, select, [contenteditable]");
            return { idle: touched ? Date.now() - touched : 1e9, focused, scrollY: window.scrollY, fields: fields() };
          } });
          const restore = \(restore ?? "null");
          let restored = false;
          const put = () => {
            if (restored) return;
            restored = true;
            for (const f of restore.fields || []) {
              const el = f.key[0] === "#" ? document.getElementById(f.key.slice(1)) : document.querySelector(`[name="${CSS.escape(f.key.slice(1))}"]`);
              if (!el) continue;
              if (el.type === "checkbox" || el.type === "radio") el.checked = f.checked; else el.value = f.value;
              if (f.focused) {
                el.focus({ preventScroll: true });
                try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
              }
            }
            window.scrollTo(0, restore.scrollY || 0);
          };
          // After the page's first render; a hidden view may not draw a frame, so a timer stands in.
          if (restore) addEventListener("load", () => { requestAnimationFrame(put); setTimeout(put, 60); });
          // Width classes on <html>, kept current as the window resizes: narrow under 600 px,
          // medium to 900, wide from 900.
          const sized = () => {
            if (!document.documentElement) return;
            const w = window.innerWidth, c = document.documentElement.classList;
            c.toggle("amber-widget", \(widget ? "true" : "false"));
            c.toggle("amber-narrow", w < 600); c.toggle("amber-medium", w >= 600 && w < 900); c.toggle("amber-wide", w >= 900);
          };
          sized();
          addEventListener("resize", sized);
          addEventListener("DOMContentLoaded", sized);
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
        if message.name == "amberData" {
            // As JSON into the task: the message's own objects can't cross into it.
            let json = try? JSONSerialization.data(withJSONObject: message.body)
            Task { @MainActor in
                do {
                    let body: Any = json.flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? [String: Any]()
                    var reply = try await onData(body)
                    reply["ok"] = true
                    replyHandler(reply, nil)
                } catch {
                    replyHandler(["ok": false, "error": (error as? LocalizedError)?.errorDescription ?? error.localizedDescription], nil)
                }
            }
            return
        }
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
        if let focus = m?["focus"] as? Bool { onFocus(focus); return }
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
    /// Pictures of a widget and of the full screen are kept apart (they're laid out differently).
    var snapshotVariant = "full"
    /// A widget doesn't scroll inside: the parent note does.
    var scrolls = true
    let onUpdate: (NotePage.Op) throws -> Void
    /// The page threw while loading or drew nothing.
    var onFailure: ([String]) -> Void = { _ in }
    var onData: @MainActor (Any) async throws -> [String: Any] = { _ in throw NotePage.OpError("Not available.") }
    /// The note's files the app may show (amber.files.url).
    var files: @MainActor (UUID) -> URL? = { _ in nil }
    /// A field in the app has focus, or not.
    var onFocus: (Bool) -> Void = { _ in }
    @State private var sandbox: NotePageSandbox?
    @State private var failed: String?
    @State private var ready = false
    /// The version on screen, and a newer one waiting while you use this one.
    @State private var shown: String?
    @State private var pending: String?
    /// What was typed and where it was scrolled, for the version swapped in.
    @State private var carry: String?
    @Environment(\.colorScheme) private var scheme

    private var current: String { shown ?? html }

    var body: some View {
        ZStack(alignment: .top) {
            if !ready, let shot = NotePageSnapshots.shared.image(noteID, html: current, dark: scheme == .dark, variant: snapshotVariant) {
                snapshot(shot)
                    .onAppear { NotePageTiming.shown(noteID, "snapshot") }
            }
            if let sandbox {
                // A new version comes in a new web view: the host is rebuilt for it.
                WebViewHost(view: sandbox.webView)
                    .id(ObjectIdentifier(sandbox))
                    .opacity(ready ? 1 : 0)
            } else if let failed {
                ContentUnavailableView("Can't open this app", systemImage: "exclamationmark.triangle", description: Text(failed))
            }
            if pending != nil { updateBar.transition(.move(edge: .top).combined(with: .opacity)) }
        }
        .onAppear { if shown == nil { shown = html } }
        .onChange(of: html) { _, now in Task { await arrived(now) } }
        .task(id: pending) { await waitForIdle() }
        .task(id: current) {
            let html = current
            let restore = carry
            carry = nil
            do {
                let s = try await NotePageSandbox.make()
                #if os(iOS)
                s.webView.scrollView.isScrollEnabled = scrolls
                #endif
                s.onUpdate = onUpdate
                s.isWidget = snapshotVariant == "widget"
                ready = false
                s.onReady = { [noteID, html, scheme, snapshotVariant] in
                    NotePageTiming.shown(noteID, "interactive")
                    withAnimation(.easeOut(duration: 0.15)) { ready = true }
                    // The picture for next time, once the page has settled.
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        NotePageSnapshots.shared.take(s.webView, noteID, html: html, dark: scheme == .dark, variant: snapshotVariant)
                    }
                }
                s.onFailure = onFailure
                s.onFocus = onFocus
                s.onData = onData
                s.files = files
                s.load(html: html, body: text, data: NotePageDataStore.shared.doc(noteID), restore: restore)
                sandbox = s
            } catch {
                failed = error.localizedDescription
            }
        }
        .onChange(of: text) { _, now in sandbox?.push(body: now, data: NotePageDataStore.shared.doc(noteID)) }
        .onChange(of: NotePageDataStore.shared.docs[noteID]) { _, _ in sandbox?.push(body: text, data: NotePageDataStore.shared.doc(noteID)) }
    }

    /// "Claude updated this app · Switch", while you're in the middle of something.
    /// A solid capsule floating over the app, the same character in both themes: dark ink with white
    /// text in light mode, a raised dark grey with light text in dark mode, the amber Switch on both.
    /// Every pair is 4.5:1 or better (white on ink 16.4, amber on ink 8.5; cream on #3A3734 10.4,
    /// amber on #3A3734 6.1).
    private var updateBar: some View {
        let by = NotePageStore.shared[noteID]?.by ?? "Your AI"
        let text = Color(light: .white, dark: Color(red: 0xF6 / 255, green: 0xEF / 255, blue: 0xE7 / 255))
        let accent = Color(red: 0xF4 / 255, green: 0xAD / 255, blue: 0x33 / 255)
        // Dark ink in light mode; in dark mode a raised dark grey, lighter than the ground, never cream.
        let fill = Color(light: Color(red: 0x2A / 255, green: 0x1D / 255, blue: 0x10 / 255), dark: Color(red: 0x3A / 255, green: 0x37 / 255, blue: 0x34 / 255))
        return HStack(spacing: 10) {
            Image(systemName: "sparkles").foregroundStyle(accent)
            Text(by == AIGlyph.page ? "This app was updated" : "\(by) updated this app")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(text)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button("Switch") { Task { await swap() } }
                .buttonStyle(.plain)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(accent)
                .padding(.horizontal, 6)
                .frame(maxHeight: .infinity)
                .contentShape(.rect)
                .accessibilityIdentifier("app.switch")
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
        .background(fill, in: .capsule)
        .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .accessibilityElement(children: .contain)
    }

    /// A new version arrived. In the middle of something (touched in the last 5 seconds, or a field
    /// has focus), it waits behind the bar; otherwise it comes in now, keeping what's typed and the
    /// scroll position.
    private func arrived(_ new: String) async {
        guard new != current else { pending = nil; return }
        guard let s = sandbox, ready else { shown = new; return }
        let now = await s.state()
        if now.focused || now.idle < 5000 {
            withAnimation(.smooth(duration: 0.25)) { pending = new }
        } else {
            carry = now.snapshot
            shown = new
        }
    }

    private func swap() async {
        guard let new = pending else { return }
        carry = await sandbox?.state().snapshot
        withAnimation(.smooth(duration: 0.25)) { pending = nil }
        shown = new
    }

    /// Swaps on its own once you've left the app alone for 10 seconds.
    private func waitForIdle() async {
        while pending != nil, !Task.isCancelled {
            try? await Task.sleep(for: .seconds(1))
            guard let s = sandbox else { continue }
            let now = await s.state()
            if !now.focused, now.idle >= 10_000 { await swap(); return }
        }
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

    private func key(_ id: UUID, _ html: String, _ dark: Bool, _ variant: String) -> String {
        "\(id.uuidString)-\(E2EE.sha256Hex(html).prefix(16))-\(dark ? "d" : "l")-\(variant)"
    }

    func image(_ id: UUID, html: String, dark: Bool, variant: String = "full") -> PImage? {
        let k = key(id, html, dark, variant)
        if let i = images[k] { return i }
        guard let data = try? Data(contentsOf: dir.appending(path: k + ".png")), let i = PImage(data: data) else {
            return latest["\(id.uuidString)-\(dark)-\(variant)"]
        }
        images[k] = i
        return i
    }

    func take(_ web: WKWebView, _ id: UUID, html: String, dark: Bool, variant: String = "full") {
        let k = key(id, html, dark, variant)
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = false
        web.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self, let image else { return }
            Task { @MainActor in
                self.images[k] = image
                self.latest["\(id.uuidString)-\(dark)-\(variant)"] = image
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

    /// Text size: on iPhone the reader's Dynamic Type size (so rem follows it too); on the Mac 14 px.
    #if os(iOS)
    static let dynamicType = "html { font: -apple-system-body; } body { font-size: 1rem; }"
    #else
    static let dynamicType = "html { font-size: 14px; } body { font-size: 1rem; }"
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
                // Solid, never see-through: lines and field edges read the same over any surface.
                "--amber-separator: \(hex(Palette.line, dark: d))",
                "--amber-field: \(d ? "#1A1918" : "#FFFFFF")",
                "--amber-field-border: \(d ? "#7A716A" : "#9A8673")",
                "--amber-accent: \(hex(Palette.amber, dark: d))",
                "--amber-accent-text: \(hex(Palette.amberInk, dark: d))",
                "--amber-accent-soft: \(hex(Palette.amberSoft, dark: d))",
                "--amber-on-accent: \(d ? "#1F1300" : "#FFFFFF")",
                "--amber-danger: \(d ? "#FF6B5E" : "#C62828")",
            ].joined(separator: "; ")
        }
        return """
        :root { color-scheme: light dark; \(vars(dark: false)); --amber-radius: \(radius.0)px; --amber-radius-small: \(radius.1)px; \
        --amber-content-max: 1100px; --amber-gutter: clamp(16px, 3.5vw, 40px); \
        --amber-font: -apple-system, system-ui, sans-serif; --amber-font-rounded: ui-rounded, -apple-system, system-ui, sans-serif; \
        --amber-font-mono: ui-monospace, Menlo, monospace; }
        @media (prefers-color-scheme: dark) { :root { \(vars(dark: true)); } }
        \(dynamicType)
        body { margin: 0; background: var(--amber-bg); color: var(--amber-text); font-family: var(--amber-font); line-height: 1.35; -webkit-text-size-adjust: 100%; }
        html, body { overflow-x: clip; }
        :where(img, video, canvas, svg, iframe, pre) { max-width: 100%; }
        :where(input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=hidden]), select, textarea) { \
        background: var(--amber-field); color: var(--amber-text); border: 1px solid var(--amber-field-border); \
        border-radius: var(--amber-radius-small); font: inherit; padding: 6px 10px; }
        :where(input, select, textarea):focus-visible { outline: 2px solid var(--amber-accent); outline-offset: 1px; }
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

    /// Captures only: a line in Documents/note-page-debug.txt.
    static func debug(_ line: String) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest") else { return }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "note-page-debug.txt")
        let l = "\(Date().timeIntervalSince1970) \(line)\n"
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(l.utf8)); try? h.close() } else { try? Data(l.utf8).write(to: url) }
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

/// What a page asks of the app, for any note showing as an app: in its own screen or as a widget
/// in its parent.
@MainActor
enum NotePageActions {
    /// A note op (tick, set cell, add row…), written to the note's text like typing. Returns the
    /// text before, or nil when nothing changed.
    @discardableResult
    static func apply(_ op: NotePage.Op, to note: Note) throws -> String? {
        let before = note.body
        let after = try NotePage.apply(op, to: before)
        guard after != before else { return nil }
        note.body = after
        note.touch()
        try? note.modelContext?.save()
        return before
    }

    /// A file the note's app may show: one the note or its app's data refers to, on this device.
    static func file(_ id: UUID, note: Note, context: ModelContext) -> URL? {
        let key = id.uuidString.lowercased()
        let data = String(data: NotePageDataStore.shared.docs[note.id] ?? Data(), encoding: .utf8) ?? ""
        guard note.body.lowercased().contains(key) || data.lowercased().contains(key), let a = context.attachment(id), FileStore.exists(a) else { return nil }
        return FileStore.url(for: a.id, filename: a.filename)
    }

    /// The app's own data and files (amber.store, amber.files). Returns the reply for the page, and
    /// the data before a data change (nil for files), for Undo.
    static func data(_ message: Any, note: Note, context: ModelContext, sync: SyncEngine?, html: String = "",
                     ask: (String) async -> Bool = { _ in false }, needKey: (NotePageNetwork.KeyNeed) async -> Void = { _ in }) async throws -> (reply: [String: Any], before: NotePageData.Doc?) {
        let m = message as? [String: Any] ?? [:]
        if let op = m["op"] as? String, op.hasPrefix("device.") {
            var d = m
            d["op"] = String(op.dropFirst("device.".count))
            return (try await NotePageDevice.handle(d, context: context), nil)
        }
        switch m["op"] as? String {
        case "fetch":
            return (try await NotePageNetwork.fetch(m, note: note, html: html, ask: ask, needKey: needKey), nil)
        case "file.save":
            guard let b64 = m["base64"] as? String, let bytes = Data(base64Encoded: b64) else { throw NotePage.OpError("Send { name, type, base64 }.") }
            guard bytes.count <= 50 * 1024 * 1024 else { throw NotePage.OpError("Files can be at most 50 MB.") }
            let name = (m["name"] as? String).map { String($0.prefix(200)) } ?? "File"
            let type = (m["type"] as? String).flatMap { UTType(mimeType: $0) } ?? UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
            let a = try FileStore.importData(bytes, filename: name, type: type)
            context.insert(a)
            try? context.save()
            SyncSignal.changed()
            return (["file": ["$file": a.id.uuidString.lowercased(), "name": a.filename, "type": type.preferredMIMEType ?? "application/octet-stream", "size": a.size]], nil)
        case "file.read":
            guard let s = m["id"] as? String, let id = UUID(uuidString: s), let a = context.attachment(id) else { throw NotePage.OpError("No such file.") }
            if !FileStore.exists(a) { _ = await sync?.download(a) }
            guard let bytes = try? Data(contentsOf: FileStore.url(for: a.id, filename: a.filename)) else { throw NotePage.OpError("That file isn't on this device yet.") }
            guard bytes.count <= 20 * 1024 * 1024 else { throw NotePage.OpError("That file is too big to show in the app (20 MB at most).") }
            return (["dataURL": "data:\(a.type.preferredMIMEType ?? "application/octet-stream");base64,\(bytes.base64EncodedString())", "name": a.filename], nil)
        default:
            let store = NotePageDataStore.shared
            let before = store.doc(note.id)
            let (after, made) = try NotePageData.apply(try NotePageData.Op(message), to: before)
            store.set(note.id, after)
            return (["data": after].merging(made.map { ["id": $0] } ?? [:]) { a, _ in a }, before)
        }
    }
}

/// A sub-note that is an app, shown where its parent links it: the picture of it from last time,
/// live once you tap it, with Open for the full screen. In other apps and exports it stays a link.
struct SubNoteWidget: View {
    let id: UUID
    let name: String
    let controller: EditorController?
    let remove: () -> Void
    @State private var live = false
    @Environment(\.colorScheme) private var scheme
    @Environment(SyncEngine.self) private var sync: SyncEngine?

    var body: some View {
        let note = controller?.resolveNoteModel(id)
        let page = NotePageStore.shared[id]
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                AppMarkView(size: 13)
                Text(note?.title ?? name)
                    .font(.system(size: EditorMetrics.body * 0.88, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button { controller?.openNote(id) } label: {
                    Label("Open", systemImage: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: EditorMetrics.body * 0.8, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.amberInk)
                .accessibilityIdentifier("widget.open.\(note?.title ?? name)")
            }
            .padding(.horizontal, 12)
            .frame(height: WidgetMetrics.header)
            Rectangle().fill(Color.line).frame(height: 1)
            ZStack(alignment: .top) {
                if let page, let note, live || NotePageSnapshots.shared.image(id, html: page.html, dark: scheme == .dark, variant: "widget") == nil {
                    NotePageView(noteID: id, html: page.html, text: note.body, snapshotVariant: "widget", scrolls: false,
                                 onUpdate: { op in _ = try NotePageActions.apply(op, to: note) },
                                 onData: { m in try await NotePageActions.data(m, note: note, context: note.modelContext!, sync: sync).reply },
                                 files: { id in note.modelContext.flatMap { NotePageActions.file(id, note: note, context: $0) } })
                        .allowsHitTesting(live)
                } else if let page, let shot = NotePageSnapshots.shared.image(id, html: page.html, dark: scheme == .dark, variant: "widget") {
                    shotView(shot)
                }
                if !live {
                    // The first tap wakes it; the parent keeps scrolling smoothly meanwhile.
                    Color.clear.contentShape(.rect).onTapGesture { live = true }
                        .accessibilityElement()
                        .accessibilityLabel("\(note?.title ?? name), app")
                        .accessibilityHint("Activates it")
                        .accessibilityAddTraits(.isButton)
                        .accessibilityIdentifier("widget.\(note?.title ?? name)")
                }
            }
            .clipped()
        }
        // One solid card: the app's own ground, the header inside it, a solid line round it.
        .background(Color.notePage, in: .rect(cornerRadius: 14, style: .continuous))
        .clipShape(.rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.line, lineWidth: 1))
        .contextMenu {
            Button("Open", systemImage: "arrow.right") { controller?.openNote(id) }
            Divider()
            Button("Remove Link", systemImage: "link.badge.plus", role: .destructive, action: remove)
        }
    }

    @ViewBuilder
    private func shotView(_ image: PImage) -> some View {
        #if os(iOS)
        Image(uiImage: image).resizable().scaledToFill().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).clipped()
        #else
        Image(nsImage: image).resizable().scaledToFill().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).clipped()
        #endif
    }
}

/// amber-file:///<id>?w=<width>: one of the note's files, from this device, for <img>/<audio>/<video>.
/// Only files the sandbox's owner allows (the note or its app's data refer to them); a width makes a
/// smaller JPEG for pictures.
private final class FileScheme: NSObject, WKURLSchemeHandler {
    weak var owner: NotePageSandbox?

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        MainActor.assumeIsolated {
            guard let url = task.request.url, let id = UUID(uuidString: url.lastPathComponent), let file = owner?.files(id),
                  var data = try? Data(contentsOf: file) else {
                task.didFailWithError(URLError(.fileDoesNotExist))
                return
            }
            var type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            if let w = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "w" })?.value.flatMap(Int.init),
               let src = CGImageSourceCreateWithData(data as CFData, nil),
               let img = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: min(max(w, 32), 2048) * 2, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) {
                let out = NSMutableData()
                if let dst = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) {
                    CGImageDestinationAddImage(dst, img, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
                    if CGImageDestinationFinalize(dst) { data = out as Data; type = "image/jpeg" }
                }
            }
            // CORS-readable, so a canvas or a WebGL texture made from it isn't tainted (with
            // crossOrigin = "anonymous" on the image): the page already may read these bytes.
            task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                            headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Access-Control-Allow-Origin": "*"])!)
            task.didReceive(data)
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
