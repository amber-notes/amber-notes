import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// A text or code file kept in a folder (HTML, JSON, CSS, JS, Python, Swift, plain text…), shown
/// as what it is: its text, monospaced and coloured by kind, and editable. Edits are saved on
/// this device as you type and synced as a new version of the file. An HTML file can also be
/// previewed, in a web view that runs no script, loads nothing from the network, follows no link
/// (links open in the browser on a click) and submits no form.
struct CodeFileView: View {
    @Bindable var file: Attachment
    let url: URL
    @Environment(\.modelContext) private var context
    @State private var text = ""
    @State private var loaded = false
    @State private var saved = true
    @State private var preview: Bool
    @State private var saveTask: Task<Void, Never>?

    init(file: Attachment, url: URL, preview: Bool = CodeFileView.capturePreview) {
        self.file = file
        self.url = url
        _preview = State(initialValue: preview && FileKinds.isHTML(file.filename))
    }

    /// Captures: `-uitest -htmlPreview` opens an HTML file in Preview.
    static var capturePreview: Bool { ProcessInfo.processInfo.arguments.contains("-uitest") && ProcessInfo.processInfo.arguments.contains("-htmlPreview") }

    private var isHTML: Bool { FileKinds.isHTML(file.filename) }
    private var language: CodeLanguage { CodeLanguage(filename: file.filename) }

    var body: some View {
        VStack(spacing: 0) {
            bar
            Divider()
            if preview {
                LockedHTMLView(html: text)
                    .accessibilityIdentifier("file.htmlPreview")
            } else if loaded {
                CodeTextView(text: $text, language: language, editable: file.trashedAt == nil)
                    .accessibilityIdentifier("file.code")
                    .onChange(of: text) { _, _ in scheduleSave() }
            } else {
                Color.notePage
            }
        }
        .background(Color.notePage)
        .task(id: url) {
            let data = (try? Data(contentsOf: url)) ?? Data()
            text = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
            loaded = true
        }
        .onDisappear { flush() }
    }

    private var bar: some View {
        HStack(spacing: 10) {
            Text(language.label)
                .font(.callout.weight(.semibold))
                .foregroundStyle(Color.ink)
            Text("\(ByteCountFormatter.string(fromByteCount: Int64(text.utf8.count), countStyle: .file)) \u{00B7} \(text.isEmpty ? 0 : text.split(separator: "\n", omittingEmptySubsequences: false).count) lines")
                .font(.callout.monospacedDigit())
                .foregroundStyle(Color.muted)
                .lineLimit(1)
            Spacer(minLength: 8)
            if !preview, file.trashedAt == nil {
                Text(saved ? "Saved" : "Editing\u{2026}")
                    .font(.caption)
                    .foregroundStyle(Color.muted)
                    .accessibilityIdentifier("code.saveState")
            }
            if isHTML {
                Picker("Show", selection: $preview) {
                    Text("Code").tag(false)
                    Text("Preview").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .onChange(of: preview) { _, on in if on { flush() } }
                .help("Preview shows the page without running its scripts or loading anything from the internet")
                .accessibilityIdentifier("code.preview")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.bar)
    }

    private func scheduleSave() {
        guard loaded else { return }
        saved = false
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .seconds(0.8))
            guard !Task.isCancelled else { return }
            flush()
        }
    }

    private func flush() {
        guard loaded, !saved else { return }
        saveTask?.cancel()
        try? context.saveText(file, text)
        saved = true
    }
}

// MARK: Highlighting

/// What a file's text is, for its colours and its label in the bar.
enum CodeLanguage: Equatable {
    case html, css, javascript, json, python, swift, shell, sql, markdown, xml, yaml, cLike, plain

    init(filename: String) {
        switch (filename as NSString).pathExtension.lowercased() {
        case "html", "htm": self = .html
        case "css": self = .css
        case "js", "jsx", "ts", "tsx": self = .javascript
        case "json": self = .json
        case "py": self = .python
        case "swift": self = .swift
        case "sh": self = .shell
        case "sql": self = .sql
        case "md", "markdown": self = .markdown
        case "xml": self = .xml
        case "yaml", "yml": self = .yaml
        case "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "m": self = .cLike
        default: self = .plain
        }
    }

    var label: String {
        switch self {
        case .html: "HTML"
        case .css: "CSS"
        case .javascript: "JavaScript"
        case .json: "JSON"
        case .python: "Python"
        case .swift: "Swift"
        case .shell: "Shell"
        case .sql: "SQL"
        case .markdown: "Markdown"
        case .xml: "XML"
        case .yaml: "YAML"
        case .cLike: "Code"
        case .plain: "Text"
        }
    }

    enum Token: Hashable { case comment, string, keyword, number, tag, attribute }

    private static let keywords: [CodeLanguage: [String]] = [
        .javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "export", "from", "class", "new", "await", "async", "true", "false", "null", "undefined", "type", "interface"],
        .python: ["def", "return", "if", "elif", "else", "for", "while", "import", "from", "class", "as", "with", "in", "not", "and", "or", "True", "False", "None", "lambda", "yield", "async", "await"],
        .swift: ["func", "let", "var", "return", "if", "else", "guard", "for", "while", "import", "struct", "class", "enum", "case", "switch", "in", "true", "false", "nil", "self", "static", "private", "some", "async", "await", "try"],
        .shell: ["if", "then", "else", "fi", "for", "do", "done", "case", "esac", "function", "export", "echo", "local", "return"],
        .sql: ["select", "from", "where", "insert", "into", "update", "delete", "create", "table", "join", "on", "and", "or", "not", "null", "order", "by", "group", "as", "values", "set", "SELECT", "FROM", "WHERE", "INSERT", "INTO", "UPDATE", "DELETE", "CREATE", "TABLE", "JOIN", "ON", "AND", "OR", "NOT", "NULL", "ORDER", "BY", "GROUP", "AS", "VALUES", "SET"],
        .cLike: ["func", "fn", "def", "return", "if", "else", "for", "while", "import", "package", "struct", "class", "enum", "public", "private", "static", "void", "int", "let", "var", "const", "true", "false", "nil", "null"],
    ]

    /// The ranges to colour, in order of precedence (later ones are skipped where earlier ones are).
    func tokens(in text: String) -> [(Token, NSRange)] {
        let ns = text as NSString
        let limit = min(ns.length, 400_000)
        let whole = NSRange(location: 0, length: limit)
        var out: [(Token, NSRange)] = []
        func add(_ token: Token, _ pattern: String, options: NSRegularExpression.Options = [], group: Int = 0) {
            guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return }
            for m in re.matches(in: text, range: whole) { out.append((token, m.range(at: group))) }
        }
        switch self {
        case .html, .xml:
            add(.comment, "<!--[\\s\\S]*?-->")
            add(.string, "\"[^\"\\n]*\"|'[^'\\n]*'")
            add(.tag, "</?[A-Za-z][A-Za-z0-9:-]*|/?>")
            add(.attribute, "\\s([A-Za-z_:][-A-Za-z0-9_:.]*)(?==)", group: 1)
        case .css:
            add(.comment, "/\\*[\\s\\S]*?\\*/")
            add(.string, "\"[^\"\\n]*\"|'[^'\\n]*'")
            add(.attribute, "([-A-Za-z]+)(?=\\s*:)", group: 1)
            add(.number, "\\b\\d+(\\.\\d+)?(px|em|rem|%|s|ms|vh|vw)?\\b")
            add(.tag, "[.#]?[A-Za-z][-A-Za-z0-9_]*(?=[^{}]*\\{)")
        case .json:
            add(.attribute, "\"[^\"\\n]*\"(?=\\s*:)")
            add(.string, "\"[^\"\\n]*\"")
            add(.number, "-?\\b\\d+(\\.\\d+)?([eE][-+]?\\d+)?\\b")
            add(.keyword, "\\b(true|false|null)\\b")
        case .markdown:
            add(.tag, "^#{1,6} .*$", options: .anchorsMatchLines)
            add(.string, "`[^`\\n]+`")
            add(.attribute, "\\[[^\\]\\n]*\\]\\([^)\\n]*\\)")
        case .yaml:
            add(.comment, "#.*$", options: .anchorsMatchLines)
            add(.attribute, "^\\s*[-A-Za-z0-9_]+(?=:)", options: .anchorsMatchLines)
            add(.string, "\"[^\"\\n]*\"|'[^'\\n]*'")
        case .python, .shell:
            add(.comment, "#.*$", options: .anchorsMatchLines)
            add(.string, "\"\"\"[\\s\\S]*?\"\"\"|\"[^\"\\n]*\"|'[^'\\n]*'")
            add(.number, "\\b\\d+(\\.\\d+)?\\b")
        case .sql:
            add(.comment, "--.*$", options: .anchorsMatchLines)
            add(.string, "'[^'\\n]*'")
            add(.number, "\\b\\d+(\\.\\d+)?\\b")
        case .javascript, .swift, .cLike:
            add(.comment, "//.*$|/\\*[\\s\\S]*?\\*/", options: .anchorsMatchLines)
            add(.string, "\"[^\"\\n]*\"|'[^'\\n]*'|`[^`]*`")
            add(.number, "\\b\\d+(\\.\\d+)?\\b")
        case .plain:
            return []
        }
        if let words = Self.keywords[self], !words.isEmpty {
            add(.keyword, "\\b(" + words.joined(separator: "|") + ")\\b")
        }
        // Earlier tokens win: a keyword inside a string or comment stays a string or comment.
        var taken = IndexSet()
        return out.filter { _, r in
            guard r.location != NSNotFound, r.length > 0 else { return false }
            let span = r.location ..< (r.location + r.length)
            if taken.intersects(integersIn: span) { return false }
            taken.insert(integersIn: span)
            return true
        }
    }
}

/// Colours for the tokens, in the warm palette, light and dark.
enum CodePalette {
    static func color(_ t: CodeLanguage.Token) -> PColor {
        switch t {
        case .comment: Palette.pair(0x8A7A6A, 0x8F8478)
        case .string: Palette.pair(0x2E7D32, 0x8BC48A)
        case .keyword: Palette.pair(0xA85700, 0xF4AD33)
        case .number: Palette.pair(0x6A3FA0, 0xC4A5F0)
        case .tag: Palette.pair(0x1F5FA8, 0x7FB2F0)
        case .attribute: Palette.pair(0x9C3D2E, 0xE79A85)
        }
    }

    static var font: PFont { PFont.monospacedSystemFont(ofSize: 13, weight: .regular) }
}

/// Colours the text storage by its language, keeping the text, the caret and undo as they are.
@MainActor func highlightCode(_ storage: NSTextStorage, _ language: CodeLanguage) {
    let all = NSRange(location: 0, length: storage.length)
    storage.beginEditing()
    storage.setAttributes([.font: CodePalette.font, .foregroundColor: Palette.ink], range: all)
    for (token, range) in language.tokens(in: storage.string) where NSMaxRange(range) <= storage.length {
        storage.addAttribute(.foregroundColor, value: CodePalette.color(token), range: range)
    }
    storage.endEditing()
}

#if os(macOS)
struct CodeTextView: NSViewRepresentable {
    @Binding var text: String
    let language: CodeLanguage
    let editable: Bool

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        let tv = scroll.documentView as! NSTextView
        tv.isRichText = false
        tv.allowsUndo = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isContinuousSpellCheckingEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.smartInsertDeleteEnabled = false
        tv.drawsBackground = false
        tv.textContainerInset = NSSize(width: 16, height: 14)
        tv.font = CodePalette.font
        tv.isEditable = editable
        tv.delegate = context.coordinator
        tv.string = text
        highlightCode(tv.textStorage!, language)
        scroll.drawsBackground = false
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let tv = scroll.documentView as? NSTextView else { return }
        tv.isEditable = editable
        if tv.string != text {
            tv.string = text
            highlightCode(tv.textStorage!, language)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeTextView
        private var pending: Task<Void, Never>?
        init(_ p: CodeTextView) { parent = p }

        func textDidChange(_ n: Notification) {
            guard let tv = n.object as? NSTextView else { return }
            parent.text = tv.string
            pending?.cancel()
            pending = Task { @MainActor [weak tv, language = parent.language] in
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled, let tv, let s = tv.textStorage else { return }
                highlightCode(s, language)
            }
        }
    }
}
#else
struct CodeTextView: UIViewRepresentable {
    @Binding var text: String
    let language: CodeLanguage
    let editable: Bool

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.backgroundColor = .clear
        tv.autocorrectionType = .no
        tv.autocapitalizationType = .none
        tv.smartQuotesType = .no
        tv.smartDashesType = .no
        tv.spellCheckingType = .no
        tv.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
        tv.isEditable = editable
        tv.delegate = context.coordinator
        tv.text = text
        highlightCode(tv.textStorage, language)
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        tv.isEditable = editable
        if tv.text != text {
            tv.text = text
            highlightCode(tv.textStorage, language)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CodeTextView
        private var pending: Task<Void, Never>?
        init(_ p: CodeTextView) { parent = p }

        func textViewDidChange(_ tv: UITextView) {
            parent.text = tv.text
            pending?.cancel()
            pending = Task { @MainActor [weak tv, language = parent.language] in
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled, let tv else { return }
                let sel = tv.selectedRange
                highlightCode(tv.textStorage, language)
                tv.selectedRange = sel
            }
        }
    }
}
#endif

// MARK: The locked-down preview

/// An HTML page shown without anything that runs or reaches out: no JavaScript, no loads from
/// anywhere (a content rule blocks every URL and a Content-Security-Policy says the same), no
/// navigation, no form submission, no storage. A click on a web link opens it in the browser.
enum LockedHTML {
    /// The policy put at the top of the page: inline styles only.
    static let policy = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

    /// The page with the policy first, so it applies before anything the page says. The page's own
    /// <!doctype> gives way to it, as on a note page (NotePageSandbox.sandboxed).
    static func sealed(_ html: String) -> String {
        var rest = Substring(html)
        while let f = rest.first, f.isWhitespace || f == "\u{FEFF}" { rest = rest.dropFirst() }
        if rest.prefix(9).lowercased() == "<!doctype", let end = rest.firstIndex(of: ">") { rest = rest[rest.index(after: end)...] }
        return #"<!doctype html><meta http-equiv="Content-Security-Policy" content="\#(policy)">"# + rest
    }

    /// Blocks every load (http, https, data, blob, file, ftp, ws): only the page's own text shows.
    static let rules = """
    [{"trigger": {"url-filter": ".*"}, "action": {"type": "block"}}]
    """

    @MainActor static func configuration() -> WKWebViewConfiguration {
        let c = WKWebViewConfiguration()
        c.defaultWebpagePreferences.allowsContentJavaScript = false
        c.preferences.javaScriptCanOpenWindowsAutomatically = false
        c.websiteDataStore = .nonPersistent()
        #if os(iOS)
        c.dataDetectorTypes = []
        c.allowsInlineMediaPlayback = false
        #endif
        c.mediaTypesRequiringUserActionForPlayback = .all
        return c
    }

    /// The content rules, compiled once.
    @MainActor static func ruleList() async -> WKContentRuleList? {
        if let cached { return cached }
        let list = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "amber-locked-html", encodedContentRuleList: rules)
        cached = list
        return list
    }
    @MainActor private static var cached: WKContentRuleList?

    /// Whether a navigation may happen: only the page's own first load. A click on an http(s)
    /// link is handed to the browser; everything else (forms, redirects, script) is refused.
    static func decide(_ action: WKNavigationType, url: URL?, isFirstLoad: Bool) -> (allow: Bool, openInBrowser: URL?) {
        if isFirstLoad, action == .other, url?.absoluteString == "about:blank" || url == nil { return (true, nil) }
        if action == .linkActivated, let u = url, ["http", "https", "mailto"].contains(u.scheme?.lowercased() ?? "") { return (false, u) }
        return (false, nil)
    }
}

@MainActor final class LockedHTMLDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    var firstLoadDone = false
    /// Every navigation refused, for tests.
    var refused: [URL] = []

    /// Where a clicked link goes: the browser (a test puts its own here).
    var open: @MainActor (URL) -> Void = { url in
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        decide(action, mainFrame: action.targetFrame?.isMainFrame == true)
    }

    /// No new windows: a clicked target=_blank link opens in the browser like any other.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        _ = decide(action, mainFrame: false)
        return nil
    }

    private func decide(_ action: WKNavigationAction, mainFrame: Bool) -> WKNavigationActionPolicy {
        let (allow, out) = LockedHTML.decide(action.navigationType, url: action.request.url, isFirstLoad: !firstLoadDone && mainFrame)
        if allow { firstLoadDone = true; return .allow }
        if let out { open(out) }
        if let u = action.request.url { refused.append(u) }
        return .cancel
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {}
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool { false }
}

#if os(macOS)
struct LockedHTMLView: NSViewRepresentable {
    let html: String
    func makeNSView(context: Context) -> WKWebView { LockedHTMLView.make(html, delegate: context.coordinator) }
    func updateNSView(_ v: WKWebView, context: Context) {}
    func makeCoordinator() -> LockedHTMLDelegate { LockedHTMLDelegate() }
}
#else
struct LockedHTMLView: UIViewRepresentable {
    let html: String
    func makeUIView(context: Context) -> WKWebView { LockedHTMLView.make(html, delegate: context.coordinator) }
    func updateUIView(_ v: WKWebView, context: Context) {}
    func makeCoordinator() -> LockedHTMLDelegate { LockedHTMLDelegate() }
}
#endif

extension LockedHTMLView {
    /// A web view with the page loaded once the block rules are in (never before).
    @MainActor static func make(_ html: String, delegate: LockedHTMLDelegate) -> WKWebView {
        let v = WKWebView(frame: .zero, configuration: LockedHTML.configuration())
        v.navigationDelegate = delegate
        v.uiDelegate = delegate
        // White like a browser's: a page that sets no colours expects it, in dark mode too.
        #if os(iOS)
        v.allowsLinkPreview = false
        #endif
        Task { @MainActor in
            guard let rules = await LockedHTML.ruleList() else { return }
            v.configuration.userContentController.add(rules)
            v.loadHTMLString(LockedHTML.sealed(html), baseURL: nil)
        }
        return v
    }
}
