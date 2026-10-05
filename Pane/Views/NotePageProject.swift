import Foundation
import WebKit

/// A note's app as a small codebase (prototype; see NotePage): files by path, and for .jsx, .tsx and
/// .ts files the JavaScript the AI tooling compiled when it wrote them (the device never compiles).
/// Stored as the page's sealed text, the whole project per version:
///
///     {"amberApp": 1, "files": {"/index.html": "…", "/src/App.jsx": "…"}, "compiled": {"/src/App.jsx": "…"}}
///
/// Anything else is a one-file app: its HTML is /index.html. Served at amber-app:///<path>, with
/// the document at amber-app:///index.html so relative modules and links work.
struct NotePageProject: Equatable {
    var files: [String: String]
    var compiled: [String: String] = [:]

    static let maxFiles = 200
    static let maxFileBytes = 512 * 1024
    static let maxBytes = 3 * 1024 * 1024
    static let base = URL(string: "amber-app:///index.html")!

    var index: String { files["/index.html"] ?? "" }

    static func isProject(_ stored: String) -> Bool {
        stored.utf8.first == UInt8(ascii: "{") && stored.contains("\"amberApp\"")
    }

    /// The project, or nil when it can't be one: not JSON, no /index.html, a bad path, or over the limits.
    static func parse(_ stored: String) -> NotePageProject? {
        guard isProject(stored) else { return NotePageProject(files: ["/index.html": stored]) }
        guard let o = try? JSONSerialization.jsonObject(with: Data(stored.utf8)) as? [String: Any],
              let files = o["files"] as? [String: String] else { return nil }
        let compiled = o["compiled"] as? [String: String] ?? [:]
        let p = NotePageProject(files: files, compiled: compiled)
        return p.problem == nil ? p : nil
    }

    /// Why this project can't be shown, or nil.
    var problem: String? {
        if files["/index.html"] == nil { return "The app has no /index.html." }
        if files.count > Self.maxFiles { return "The app has more than \(Self.maxFiles) files." }
        for (path, text) in files {
            if !Self.validPath(path) { return "\(path) isn't a valid path." }
            if text.utf8.count > Self.maxFileBytes { return "\(path) is over 512 KB." }
            if Self.compiles(path), compiled[path] == nil { return "\(path) wasn't compiled." }
        }
        let total = files.values.reduce(0) { $0 + $1.utf8.count } + compiled.values.reduce(0) { $0 + $1.utf8.count }
        if total > Self.maxBytes { return "The app is over 3 MB." }
        return nil
    }

    static func validPath(_ p: String) -> Bool {
        p.hasPrefix("/") && !p.contains("..") && !p.contains("//") && p.count < 200
            && p.range(of: #"^[A-Za-z0-9._\-/]+$"#, options: .regularExpression) != nil
    }

    static func compiles(_ p: String) -> Bool { p.hasSuffix(".jsx") || p.hasSuffix(".tsx") || p.hasSuffix(".ts") }

    /// The HTML of the app's page (for what it declares in <meta> tags).
    static func entryHTML(_ stored: String) -> String {
        guard isProject(stored) else { return stored }
        return parse(stored)?.index ?? ""
    }

    /// A file as served: compiled JavaScript for .jsx/.tsx/.ts, compiled CSS (Tailwind) when there
    /// is some, the text otherwise, and its type. An import without an extension finds the file the
    /// way bundlers do (.tsx, .ts, .jsx, .js, then index.*). A stylesheet imported from a module
    /// (`import "./index.css"`, compiled to "./index.css?import") is a module that adds it.
    func serve(_ path: String, query: String? = nil) -> (data: Data, type: String)? {
        guard let path = resolve(path) else { return nil }
        if query == "import", path.hasSuffix(".css") {
            let js = "if (!document.querySelector('link[href=\"\(path)\"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '\(path)'; document.head.appendChild(l); }\n"
            return (Data(js.utf8), "text/javascript")
        }
        guard let text = Self.compiles(path) || path.hasSuffix(".css") ? (compiled[path] ?? files[path]) : files[path] else { return nil }
        return (Data(text.utf8), Self.mime(path))
    }

    func resolve(_ path: String) -> String? {
        if files[path] != nil { return path }
        for ext in [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"] where files[path + ext] != nil {
            return path + ext
        }
        return nil
    }

    static func mime(_ path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": "text/html"
        case "css": "text/css"
        case "js", "mjs", "jsx", "tsx", "ts": "text/javascript"
        case "json": "application/json"
        case "svg": "image/svg+xml"
        case "md", "txt": "text/plain"
        default: "text/plain"
        }
    }

    /// Bare module names for the bundled libraries: <script type="importmap"> before the app's own.
    static let importMap: String = {
        var imports: [String: String] = [
            "preact": "amber-lib:///esm/preact.js",
            "preact/hooks": "amber-lib:///esm/preact-hooks.js",
            "preact/jsx-runtime": "amber-lib:///esm/preact-jsx-runtime.js",
            "htm": "amber-lib:///esm/htm.js",
            // Like a Vite project: "@/components/ui/button" is /src/components/ui/button.tsx.
            "@/": "amber-app:///src/",
            "amber-router": "amber-lib:///esm/amber-router.js",
            "amber": "amber-lib:///esm/amber.js",
            "amber-ui": "amber-lib:///amber-ui/index.js",
        ]
        // The other bundled libraries by their npm names, each its global as the default export.
        for lib in NotePageLibraries.bundled where !["preact", "preact-hooks", "htm", "router"].contains(lib.name) {
            imports[lib.package] = "amber-lib:///esm/\(lib.name).js"
        }
        // The app stack: React (preact/compat) and the libraries built on it, and Preact itself, so
        // there is one Preact for everything.
        for (name, file) in NotePageLibraries.stack?.map ?? [:] { imports[name] = "amber-lib:///stack/\(file)" }
        let json = (try? JSONSerialization.data(withJSONObject: ["imports": imports], options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return #"<script type="importmap">"# + json.replacingOccurrences(of: "\\/", with: "/") + "</script>"
    }()
}

/// amber-app:///<path>: the app's own files, and nothing else.
final class AppScheme: NSObject, WKURLSchemeHandler {
    nonisolated(unsafe) var project = NotePageProject(files: [:])

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, let (data, type) = project.serve(url.path.isEmpty ? "/index.html" : url.path, query: url.query) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": type + "; charset=utf-8", "Content-Length": "\(data.count)", "Access-Control-Allow-Origin": "*"])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
