#if os(macOS)
import AppKit
import PDFKit
import SwiftUI
import Testing
@testable import Pane

/// Pictures of the PDF reader and the "Can't add" alert, light and dark, drawn off-screen with
/// cacheDisplay and attached to the test results (CI exports them as the "snapshots" artifact).
/// Nothing appears on any screen.
@MainActor @Suite(.serialized) struct FileViewerSnapshots {
    /// A short book with a table of contents.
    static func book() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "Fluent Python.pdf")
        try DemoData.bookPDF(title: "Fluent Python", chapters: DemoData.fluentPythonChapters).write(to: url)
        return url
    }

    static func picture(_ view: some View, size: CGSize, dark: Bool, wait: Double = 1.2) async throws -> Data {
        let w = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: size.width, height: size.height), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.contentViewController = NSHostingController(rootView: view.frame(width: size.width, height: size.height))
        w.setContentSize(size)
        w.orderFrontRegardless()
        defer { w.orderOut(nil); w.close() }
        try? await Task.sleep(for: .seconds(wait))
        let v = try #require(w.contentView)
        v.layoutSubtreeIfNeeded()
        let rep = try #require(v.bitmapImageRepForCachingDisplay(in: v.bounds))
        v.cacheDisplay(in: v.bounds, to: rep)
        return try #require(rep.representation(using: .png, properties: [:]))
    }

    @Test(arguments: [false, true]) func pdfReaderWithPagesAndFind(dark: Bool) async throws {
        let png = try await Self.picture(PDFReader(url: try Self.book(), sidebar: true, find: "python"), size: CGSize(width: 900, height: 640), dark: dark)
        Testing.Attachment.record(png, named: "pdf-reader-pages-find-\(dark ? "dark" : "light").png")
    }

    @Test(arguments: [false, true]) func pdfReaderContents(dark: Bool) async throws {
        let png = try await Self.picture(PDFReader(url: try Self.book(), sidebar: true, contents: true), size: CGSize(width: 900, height: 640), dark: dark)
        Testing.Attachment.record(png, named: "pdf-reader-contents-\(dark ? "dark" : "light").png")
    }

    @Test(arguments: [false, true]) func cantAddAlert(dark: Bool) async throws {
        for (name, r) in [("one", FileRefusal(unsupported: ["Holiday in Lisbon.mov"], tooBig: [])),
                          ("several", FileRefusal(unsupported: ["Clip 1.mov", "Clip 2.mov", "Voice memo.m4a", "Book.epub", "Old.zip", "Notes.exe"], tooBig: []))] {
            let alert = NSAlert()
            alert.messageText = r.title
            alert.informativeText = r.message
            alert.addButton(withTitle: "OK")
            alert.window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            alert.layout()
            let frame = try #require(alert.window.contentView?.superview)
            alert.window.setFrameOrigin(CGPoint(x: -30000, y: -30000))
            alert.window.orderFrontRegardless()
            try? await Task.sleep(for: .seconds(0.6))
            let rep = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
            frame.cacheDisplay(in: frame.bounds, to: rep)
            alert.window.orderOut(nil)
            Testing.Attachment.record(try #require(rep.representation(using: .png, properties: [:])), named: "cant-add-\(name)-\(dark ? "dark" : "light").png")
        }
    }
}

#endif
