import CryptoKit
import Foundation
import WebKit

/// Libraries for a note's app (prototype; see NotePage). The page still has no network: libraries
/// are served to it by the app under amber-lib:, either from the app itself (a bundled set, by name)
/// or, for any other npm package, downloaded once by the app from cdn.jsdelivr.net, checked against
/// the hash the page names, kept on the device and served from there.
///
///     <meta name="amber-libs" content="chart, d3, npm:lodash@4.17.21/lodash.min.js#sha384-…">
///     amber.lib("three").then((THREE) => …)
///
/// What a download can tell anyone: that this device wanted that package and version, at that
/// time, from the CDN. No note text, no account, nothing from the page goes with it; the app makes
/// the request, not the page, and the bytes must match the hash before the page gets them.
enum NotePageLibraries {
    struct Bundled: Decodable {
        var name: String
        var file: String
        var global: String
        var package: String
        var version: String
        var license: String
        var bytes: Int
        /// Libraries it needs loaded first (preact-hooks needs preact).
        var requires: [String]?
    }
    private struct Manifest: Decodable { var libraries: [Bundled] }

    static let bundled: [Bundled] = {
        guard let url = Bundle.main.url(forResource: "libraries", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode(Manifest.self, from: data))?.libraries ?? []
    }()

    /// npm:<name>@<version>[/<path>]#<sha256|sha384|sha512>-<base64>
    struct NpmRef: Hashable {
        var name: String
        var version: String
        var path: String?
        var algorithm: String
        var hash: String

        init?(_ s: String) {
            guard s.hasPrefix("npm:"), let hashAt = s.firstIndex(of: "#") else { return nil }
            let spec = s[s.index(s.startIndex, offsetBy: 4)..<hashAt]
            let integrity = s[s.index(after: hashAt)...]
            guard let dash = integrity.firstIndex(of: "-") else { return nil }
            algorithm = String(integrity[..<dash])
            hash = String(integrity[integrity.index(after: dash)...])
            guard ["sha256", "sha384", "sha512"].contains(algorithm), Data(base64Encoded: hash) != nil else { return nil }
            // Scoped names (@scope/name) keep their first @.
            let at = spec.dropFirst().firstIndex(of: "@")
            guard let at else { return nil }
            name = String(spec[..<at])
            let rest = spec[spec.index(after: at)...]
            if let slash = rest.firstIndex(of: "/") {
                version = String(rest[..<slash])
                path = String(rest[rest.index(after: slash)...])
            } else {
                version = String(rest)
                path = nil
            }
            // A pinned version only: 1.2.3 (with an optional prerelease), never a range or a tag.
            guard version.range(of: #"^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$"#, options: .regularExpression) != nil,
                  name.range(of: #"^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$"#, options: .regularExpression) != nil,
                  path.map({ !$0.contains("..") && $0.count < 200 }) ?? true else { return nil }
        }

        var label: String { "\(name) \(version)" }
        var url: URL { URL(string: "https://cdn.jsdelivr.net/npm/\(name)@\(version)" + (path.map { "/" + $0 } ?? ""))! }
        var key: String { "\(algorithm)-\(hash)" }

        func matches(_ data: Data) -> Bool {
            let digest: Data
            switch algorithm {
            case "sha256": digest = Data(SHA256.hash(data: data))
            case "sha512": digest = Data(SHA512.hash(data: data))
            default: digest = Data(SHA384.hash(data: data))
            }
            return digest.base64EncodedString() == hash
        }
    }

    enum Declared: Hashable { case bundled(String), npm(NpmRef) }

    static func declared(in html: String) -> [Declared] {
        guard let r = html.range(of: #"<meta[^>]*name=["']amber-libs["'][^>]*>"#, options: .regularExpression) else { return [] }
        let tag = String(html[r])
        guard let c = tag.range(of: #"content=(['"])([\s\S]*?)\1"#, options: .regularExpression) else { return [] }
        let content = String(tag[c].dropFirst("content=".count).dropFirst().dropLast())
        var out: [Declared] = []
        // What a library needs comes before it, once.
        func add(_ name: String) {
            guard let lib = bundled.first(where: { $0.name == name }), !out.contains(.bundled(name)) else { return }
            for r in lib.requires ?? [] { add(r) }
            out.append(.bundled(name))
        }
        for item in content.split(separator: ",").map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }).prefix(20) {
            if let ref = NpmRef(item) { if !out.contains(.npm(ref)) { out.append(.npm(ref)) } } else { add(item) }
        }
        return out
    }

    /// The tags that load the declared libraries, before the page's own scripts.
    static func scriptTags(for html: String) -> String {
        declared(in: html).map { d in
            switch d {
            case .bundled(let n): "<script src=\"amber-lib:///\(n)\"></script>"
            case .npm(let r): "<script src=\"amber-lib:///npm/\(r.name)@\(r.version)?\(r.key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")\"></script>"
            }
        }.joined()
    }

    // MARK: Downloads

    private static var cacheDir: URL {
        let base = PaneApp.isUnitTestHost || ProcessInfo.processInfo.arguments.contains("-uitest")
            ? FileManager.default.temporaryDirectory.appending(path: "amber-libs-test", directoryHint: .isDirectory)
            : FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane/AppLibraries", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    static func cacheFile(_ ref: NpmRef) -> URL {
        cacheDir.appending(path: E2EE.sha256Hex(ref.key) + ".js")
    }

    /// Libraries this page declared that were downloaded, for App Settings › Internet.
    static func downloaded(for html: String) -> [String] {
        declared(in: html).compactMap { d in
            if case .npm(let r) = d, FileManager.default.fileExists(atPath: cacheFile(r).path) { return r.label }
            return nil
        }
    }

    /// The package's bytes: from the device, or downloaded once and checked. Refuses a mismatch.
    static func npm(_ ref: NpmRef) async throws -> Data {
        let file = cacheFile(ref)
        if let data = try? Data(contentsOf: file), ref.matches(data) { return data }
        var request = URLRequest(url: ref.url, timeoutInterval: 30)
        request.setValue(nil, forHTTPHeaderField: "Referer")
        let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NotePage.OpError("\(ref.label) isn't on the CDN.") }
        guard data.count <= 5 * 1024 * 1024 else { throw NotePage.OpError("\(ref.label) is over 5 MB.") }
        guard ref.matches(data) else { throw NotePage.OpError("\(ref.label) doesn't match its hash. It wasn't used.") }
        try? data.write(to: file, options: .atomic)
        return data
    }

    static func bundledData(_ name: String) -> Data? {
        guard let lib = bundled.first(where: { $0.name == name }) else { return nil }
        let base = (lib.file as NSString).deletingPathExtension, ext = (lib.file as NSString).pathExtension
        return Bundle.main.url(forResource: base, withExtension: ext).flatMap { try? Data(contentsOf: $0) }
    }
}

/// amber-lib:///<name> and amber-lib:///npm/<name>@<version>?<integrity>: the libraries a page may
/// load. npm packages only when the page declared exactly that one.
final class LibraryScheme: NSObject, WKURLSchemeHandler {
    /// The npm packages the page declared (set when it loads).
    nonisolated(unsafe) var allowed: Set<NotePageLibraries.NpmRef> = []
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
        let path = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        func reply(_ data: Data) {
            guard !stopped.contains(ObjectIdentifier(task)) else { return }
            task.didReceive(URLResponse(url: url, mimeType: "text/javascript", expectedContentLength: data.count, textEncodingName: "utf-8"))
            task.didReceive(data)
            task.didFinish()
        }
        if path.hasPrefix("npm/") {
            let integrity = (url.query ?? "").removingPercentEncoding ?? ""
            let spec = String(path.dropFirst(4))
            guard let ref = allowed.first(where: { "\($0.name)@\($0.version)" == spec && $0.key == integrity }) else {
                task.didFailWithError(URLError(.noPermissionsToReadFile))
                return
            }
            Task { @MainActor in
                do { reply(try await NotePageLibraries.npm(ref)) } catch {
                    if !stopped.contains(ObjectIdentifier(task)) { task.didFailWithError(error) }
                }
            }
        } else if let data = NotePageLibraries.bundledData(path) {
            reply(data)
        } else {
            task.didFailWithError(URLError(.fileDoesNotExist))
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }
}
