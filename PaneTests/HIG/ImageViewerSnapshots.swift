#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
import UniformTypeIdentifiers
@testable import Pane

/// The picture viewer, light and dark, drawn off-screen in borderless windows at -20000,-20000 and
/// attached to the test results (CI keeps them as the "snapshots" artifact). Runs on CI only.
@MainActor @Suite(.serialized) struct ImageViewerSnapshots {
    /// Set by CI (TEST_RUNNER_PANE_SNAPSHOTS); unset on a developer's Mac, where these don't run.
    static var onCI: Bool { ProcessInfo.processInfo.environment["PANE_SNAPSHOTS"] == "1" }

    /// A photo-like picture: sky, sun, hills.
    static func photo(_ url: URL, width: Int, height: Int, type: UTType, alpha: Bool = false) throws {
        let ctx = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        if alpha {
            // A sticker: a sun and a card on nothing.
            ctx.setFillColor(CGColor(red: 0.98, green: 0.62, blue: 0.2, alpha: 1))
            ctx.fillEllipse(in: CGRect(x: width / 4, y: height / 2, width: width / 2, height: width / 2))
            ctx.setFillColor(CGColor(red: 0.3, green: 0.2, blue: 0.45, alpha: 0.85))
            ctx.fill(CGRect(x: width / 8, y: height / 6, width: width * 3 / 4, height: height / 4))
        } else {
            let colors = [CGColor(red: 0.98, green: 0.7, blue: 0.35, alpha: 1), CGColor(red: 0.45, green: 0.3, blue: 0.6, alpha: 1)] as CFArray
            ctx.drawLinearGradient(CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!, start: CGPoint(x: 0, y: height), end: .zero, options: [])
            ctx.setFillColor(CGColor(red: 1, green: 0.9, blue: 0.6, alpha: 1))
            ctx.fillEllipse(in: CGRect(x: width * 2 / 5, y: height * 2 / 5, width: width / 5, height: width / 5))
            ctx.setFillColor(CGColor(red: 0.16, green: 0.12, blue: 0.2, alpha: 1))
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height / 4))
        }
        let dest = try #require(CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, try #require(ctx.makeImage()), nil)
        #expect(CGImageDestinationFinalize(dest))
    }

    func shoot(_ name: String, file filename: String, width: Int, height: Int, type: UTType, alpha: Bool = false, turns: Int = 0, dark: Bool, actual: Bool = false) async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let folder = c.mainContext.createFolder(named: "Photos")
        let src = FileManager.default.temporaryDirectory.appending(path: filename)
        try Self.photo(src, width: width, height: height, type: type, alpha: alpha)
        let made = c.mainContext.addFiles([src, src], to: folder)
        defer { made.forEach(FileStore.remove) }
        let file = try #require(made.first)
        let url = FileStore.url(for: file.id, filename: file.filename)
        let size = CGSize(width: 900, height: 640)
        let view = ImageViewer(file: file, url: url, neighbours: c.mainContext.pictures(besides: file), open: { _ in }, turns: turns)
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
        try? await Task.sleep(for: .seconds(1.5))
        if actual, let scroll = Self.scroll(in: w.contentView) { scroll.magnification = 1; try? await Task.sleep(for: .seconds(0.8)) }
        let v = try #require(w.contentView)
        v.layoutSubtreeIfNeeded()
        let rep = try #require(v.bitmapImageRepForCachingDisplay(in: v.bounds))
        v.cacheDisplay(in: v.bounds, to: rep)
        Testing.Attachment.record(try #require(rep.representation(using: .png, properties: [:])), named: "image-\(name)-\(dark ? "dark" : "light").png")
    }

    static func scroll(in view: NSView?) -> NSScrollView? {
        guard let view else { return nil }
        if let s = view as? NSScrollView, s.allowsMagnification { return s }
        for v in view.subviews { if let s = scroll(in: v) { return s } }
        return nil
    }

    @Test(arguments: [false, true]) func photoFits(dark: Bool) async throws {
        guard Self.onCI else { return }
        try await shoot("photo-fit", file: "Lisbon.jpg", width: 4032, height: 3024, type: .jpeg, dark: dark)
    }

    @Test(arguments: [false, true]) func transparentOnCheckerboard(dark: Bool) async throws {
        guard Self.onCI else { return }
        try await shoot("transparent", file: "Sticker.png", width: 1080, height: 2338, type: .png, alpha: true, dark: dark)
    }

    @Test(arguments: [false, true]) func turnedAndActualSize(dark: Bool) async throws {
        guard Self.onCI else { return }
        try await shoot("turned", file: "Lisbon.heic", width: 1600, height: 1200, type: .heic, turns: 1, dark: dark)
        try await shoot("actual-size", file: "Lisbon.jpg", width: 4032, height: 3024, type: .jpeg, dark: dark, actual: true)
    }
}
#endif
