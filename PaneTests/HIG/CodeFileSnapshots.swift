#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
import WebKit
@testable import Pane

/// An HTML file as code and as its Preview, light and dark, drawn off-screen in borderless windows
/// at -20000,-20000 and attached to the test results (CI keeps them as the "snapshots" artifact).
/// Runs on CI only.
@MainActor @Suite(.serialized) struct CodeFileSnapshots {
    static var onCI: Bool { ImageViewerSnapshots.onCI }

    static let page = """
    <!doctype html>
    <html lang="en">
    <head>
      <title>Trip to Lisbon</title>
      <!-- Plans for the weekend -->
      <style>
        body { font: 16px -apple-system, sans-serif; margin: 32px; color: #2a1d10; }
        h1 { color: #c2620a; }
      </style>
      <script>document.title = "script ran";</script>
    </head>
    <body>
      <h1>Trip to Lisbon</h1>
      <p>Flights on <b>Friday</b> at 07:40. Hotel near <a href="https://example.com/alfama">Alfama</a>.</p>
      <img src="https://example.com/tracker.png" alt="">
      <ul><li>Pastel de nata</li><li>Tram 28</li></ul>
    </body>
    </html>
    """

    func shoot(_ name: String, preview: Bool, dark: Bool) async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let folder = c.mainContext.createFolder(named: "Trips")
        let src = FileManager.default.temporaryDirectory.appending(path: "Lisbon.html")
        try Data(Self.page.utf8).write(to: src)
        let file = try #require(c.mainContext.addFiles([src], to: folder).first)
        defer { FileStore.remove(file) }
        let url = FileStore.url(for: file.id, filename: file.filename)
        let size = CGSize(width: 900, height: 600)
        let view = CodeFileView(file: file, url: url, preview: preview)
            .modelContainer(c)
            .frame(width: size.width, height: size.height)
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: size.width, height: size.height), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.contentViewController = NSHostingController(rootView: view)
        w.setContentSize(size)
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        w.orderFrontRegardless()
        defer { w.orderOut(nil); w.close() }
        let v = try #require(w.contentView)
        // The Preview loads once its block rules compile, which takes longer on a busy runner: wait
        // for the page's load to finish, not for a fixed time.
        if preview {
            var loaded = false
            for _ in 0..<300 {
                if let web = Self.web(in: v), (web.navigationDelegate as? LockedHTMLDelegate)?.finished == true { loaded = true; break }
                try await Task.sleep(for: .milliseconds(50))
            }
            #expect(loaded, "the Preview never finished loading")
        }
        try await Task.sleep(for: .seconds(1.5))
        v.layoutSubtreeIfNeeded()
        let rep = try #require(v.bitmapImageRepForCachingDisplay(in: v.bounds))
        v.cacheDisplay(in: v.bounds, to: rep)
        Testing.Attachment.record(try #require(rep.representation(using: .png, properties: [:])), named: "code-\(name)-\(dark ? "dark" : "light").png")
        // A web view draws outside cacheDisplay: its own snapshot, for the Preview.
        if preview, let web = Self.web(in: v) {
            let image = try await web.takeSnapshot(configuration: nil)
            let tiff = try #require(image.tiffRepresentation)
            let png = try #require(NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]))
            Testing.Attachment.record(png, named: "code-\(name)-page-\(dark ? "dark" : "light").png")
            #expect(try await web.evaluateJavaScript("document.title") as? String == "Trip to Lisbon")
        }
    }

    static func web(in view: NSView) -> WKWebView? {
        if let w = view as? WKWebView { return w }
        for s in view.subviews { if let w = web(in: s) { return w } }
        return nil
    }

    @Test(arguments: [false, true]) func htmlAsCode(dark: Bool) async throws {
        guard Self.onCI else { return }
        try await shoot("html", preview: false, dark: dark)
    }

    @Test(arguments: [false, true]) func htmlPreview(dark: Bool) async throws {
        guard Self.onCI else { return }
        try await shoot("html-preview", preview: true, dark: dark)
    }
}
#endif
