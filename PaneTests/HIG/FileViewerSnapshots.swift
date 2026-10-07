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
        // Borderless, far off screen, never ordered front: these run in every test run.
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: size.width, height: size.height), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.contentViewController = NSHostingController(rootView: view.frame(width: size.width, height: size.height))
        w.setContentSize(size)
        defer { w.close() }
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
            let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)!
            alert.window.appearance = appearance
            alert.layout()
            let frame = try #require(alert.window.contentView?.superview)
            // The alert's window is titled, so it is never ordered front (it would be pulled back
            // onto the display): drawn where it is, offscreen.
            alert.window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            try? await Task.sleep(for: .seconds(0.6))
            frame.layoutSubtreeIfNeeded()
            let rep = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
            frame.cacheDisplay(in: frame.bounds, to: rep)
            // cacheDisplay doesn't draw the alert's material: put the window's own ground under it,
            // in that appearance, so light and dark read as they do on screen.
            let size = frame.bounds.size
            let image = NSImage(size: size)
            image.lockFocus()
            appearance.performAsCurrentDrawingAppearance {
                NSColor.windowBackgroundColor.setFill()
                NSBezierPath(roundedRect: NSRect(origin: .zero, size: size), xRadius: 18, yRadius: 18).fill()
            }
            rep.draw(in: NSRect(origin: .zero, size: size))
            image.unlockFocus()
            let out = try #require(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
            Testing.Attachment.record(out, named: "cant-add-\(name)-\(dark ? "dark" : "light").png")
        }
    }
}

#endif
