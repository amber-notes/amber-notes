import CoreGraphics
import Foundation
import ImageIO
import SwiftData
import Testing
import UniformTypeIdentifiers
@testable import Pane

private final class ImageFixtureToken {}

/// The picture viewer's decoding, zoom and order (ImageViewer.swift).
@MainActor @Suite(.serialized) struct ImageViewerTests {
    static let tmp = FileManager.default.temporaryDirectory.appending(path: "image-viewer-tests")

    /// A picture written with ImageIO: `type` is a UTType identifier; frames > 1 makes an animated GIF.
    static func picture(_ name: String, width: Int, height: Int, type: UTType, alpha: Bool = false, frames: Int = 1) throws -> URL {
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let url = tmp.appending(path: name)
        let dest = try #require(CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, frames, nil))
        for f in 0 ..< frames {
            let ctx = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                             bitmapInfo: (alpha ? CGImageAlphaInfo.premultipliedLast : .noneSkipLast).rawValue))
            ctx.setFillColor(CGColor(red: 0.95, green: 0.6 + 0.05 * Double(f % 4), blue: 0.25, alpha: alpha ? 0.5 : 1))
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height / 2))
            CGImageDestinationAddImage(dest, try #require(ctx.makeImage()), frames > 1 ? [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.08]] as CFDictionary : nil)
        }
        #expect(CGImageDestinationFinalize(dest))
        return url
    }

    @Test func everyKindDecodes() throws {
        for (name, type) in [("p.png", UTType.png), ("p.jpg", .jpeg), ("p.heic", .heic), ("p.gif", .gif)] {
            let url = try Self.picture(name, width: 300, height: 200, type: type)
            let info = try #require(ImageDecoder.info(url), "\(name) reads")
            #expect(info.size == CGSize(width: 300, height: 200), "\(name)")
            #expect(ImageDecoder.decode(url, maxPixels: 100)?.width == 100, "\(name) decodes smaller")
        }
        // WebP (ImageIO reads it; it can't write it, so it's a fixture).
        let webp = try #require(Bundle(for: ImageFixtureToken.self).url(forResource: "sunset", withExtension: "webp"))
        #expect(ImageDecoder.info(webp)?.size.width == 120)
        #expect(ImageDecoder.decode(webp, maxPixels: 60) != nil)
        // Transparency is known before decoding: the checkerboard shows under it.
        #expect(ImageDecoder.info(try Self.picture("alpha.png", width: 40, height: 40, type: .png, alpha: true))?.alpha == true)
        #expect(ImageDecoder.info(try Self.picture("opaque.jpg", width: 40, height: 40, type: .jpeg))?.alpha == false)
    }

    @Test func animatedGIFsKeepTheirFrames() throws {
        let url = try Self.picture("dance.gif", width: 80, height: 60, type: .gif, frames: 6)
        #expect(ImageDecoder.info(url)?.frames == 6)
        let (frames, duration) = ImageDecoder.frames(url, turns: 0, maxPixels: 1600)
        #expect(frames.count == 6)
        #expect(abs(duration - 0.08) < 0.02)
    }

    @Test func aBigPhotoIsDecodedOffTheMainThreadAtTheSizeShown() async throws {
        let url = try Self.picture("big.jpg", width: 8000, height: 6000, type: .jpeg)
        let m = ImageViewerModel(url: url)
        m.paneSize = CGSize(width: 800, height: 600)
        // The main actor keeps running while it loads: a heartbeat every 5 ms.
        var beats = 0
        let heart = Task { @MainActor in while !Task.isCancelled { beats += 1; try? await Task.sleep(for: .milliseconds(5)) } }
        let clock = ContinuousClock(), start = clock.now
        await m.load()
        let took = clock.now - start
        heart.cancel()
        #expect(m.pixelSize == CGSize(width: 8000, height: 6000))
        let img = try #require(m.image)
        #expect(max(img.width, img.height) <= 2400, "decoded for the pane (800 points at up to 3x), not 8000 pixels")
        #expect(m.fits && abs(m.zoom - 0.1) < 0.001, "fits: 800 of 8000")
        let ms = Double(took.components.seconds) * 1000 + Double(took.components.attoseconds) / 1e15
        #expect(Double(beats) > ms / 20, "the main thread wasn't held while decoding (\(beats) beats in \(Int(ms)) ms)")
        // 100%: more pixels are decoded, still off the main thread.
        m.actualSize()
        try? await Task.sleep(for: .seconds(2))
        #expect(max(m.image?.width ?? 0, m.image?.height ?? 0) > 2400)
    }

    @Test func zoomFitAndReadout() {
        let m = ImageViewerModel(url: URL(fileURLWithPath: "/dev/null"))
        m.paneSize = CGSize(width: 540, height: 1169)
        // What load() learns: a phone screenshot.
        m.setForTests(pixelSize: CGSize(width: 1080, height: 2338))
        #expect(abs(m.fitZoom - 0.5) < 0.001)
        m.fit()
        #expect(m.readout == "1080 \u{00D7} 2338 \u{00B7} 50%")
        m.zoom(in: true)
        #expect(m.zoom == 0.67 && !m.fits)
        m.toggle()
        #expect(m.fits && abs(m.zoom - 0.5) < 0.001, "double-click: back to fit")
        m.toggle()
        #expect(m.zoom == 1, "and to 100%")
        // A small picture fits at 100%, never blown up.
        m.setForTests(pixelSize: CGSize(width: 100, height: 80))
        #expect(m.fitZoom == 1)
        #expect(ImageViewerModel.step(from: 16, up: true) == 16 && ImageViewerModel.step(from: 0.05, up: false) == 0.05)
    }

    @Test func turningIsForViewingAndSaveACopyKeepsIt() throws {
        let url = try Self.picture("wide.png", width: 300, height: 200, type: .png)
        let m = ImageViewerModel(url: url)
        m.setForTests(pixelSize: CGSize(width: 300, height: 200))
        m.turns = 1
        #expect(m.shownSize == CGSize(width: 200, height: 300))
        #expect(m.readout.hasPrefix("200 \u{00D7} 300"))
        let turned = try #require(ImageDecoder.decode(url, maxPixels: 1000, turns: 1))
        #expect(turned.width == 200 && turned.height == 300)
        let before = try Data(contentsOf: url)
        let (data, ext) = try #require(ImageDecoder.encodeRotated(url, turns: 1))
        #expect(ext == "png")
        #expect(try Data(contentsOf: url) == before, "the file itself is untouched")
        let src = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        #expect((CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any])?[kCGImagePropertyPixelWidth] as? Int == 200)
        #expect(ImageDecoder.encodeRotated(try Self.picture("photo.jpg", width: 40, height: 30, type: .jpeg), turns: 2)?.1 == "jpg")
    }

    @Test func theFoldersPicturesInTheListsOrder() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let folder = ctx.createFolder(named: "Photos")
        let urls = try ["a.png", "b.png", "c.png"].map { try Self.picture($0, width: 10, height: 10, type: .png) } + [try Self.picture("doc.gif", width: 10, height: 10, type: .gif)]
        let made = ctx.addFiles(urls, to: folder)
        defer { made.forEach(FileStore.remove) }
        for (i, f) in made.enumerated() { f.modifiedAt = Date(timeIntervalSince1970: 1_800_000_000 + Double(i) * 60) }
        let pdf = try FileStore.importData(Data("%PDF".utf8), filename: "x.pdf", type: .pdf)
        pdf.folderID = folder.id
        ctx.insert(pdf)
        defer { FileStore.remove(pdf) }
        let order = ctx.pictures(besides: made[0]).map(\.filename)
        #expect(order == ["doc.gif", "c.png", "b.png", "a.png"], "newest first, pictures only")
    }
}
