import ImageIO
import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// A picture kept in a folder, viewed the way Preview and Photos show one: it fits the pane,
/// zooms (⌘+ ⌘- ⌘0, pinch, double-click or double-tap between fit and 100%), pans when zoomed,
/// turns (⌘R, for viewing; Save a Copy keeps it), copies, and steps to the folder's next or
/// previous picture with the arrow keys or a swipe. Big photos are decoded off the main thread at
/// the size the screen needs; 100% asks for more pixels when it's reached.
@MainActor @Observable
final class ImageViewerModel {
    let url: URL
    /// The picture's own size in pixels, as it's meant to be seen (EXIF orientation applied).
    private(set) var pixelSize: CGSize = .zero
    /// What's drawn: a version no bigger than needed, or the frames of an animated GIF.
    private(set) var image: CGImage?
    private(set) var frames: [CGImage] = []
    private(set) var frameDuration: Double = 0.1
    private(set) var hasAlpha = false
    private(set) var failed = false

    /// Points shown per pixel of the picture: 1 is 100%.
    var zoom: CGFloat = 1
    var fits = true
    /// Quarter turns, clockwise, for viewing only.
    var turns = 0
    /// The pane's size, for Fit.
    var paneSize: CGSize = .zero

    /// Pixels decoded so far along the longer side (0: nothing yet).
    @ObservationIgnored private var decoded = 0
    /// The view hands its zoom here (the scroll view does the zooming).
    @ObservationIgnored var apply: (CGFloat, Bool) -> Void = { _, _ in }

    static let steps: [CGFloat] = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16]

    init(url: URL) { self.url = url }

    /// Tests: what load() would learn from the file.
    func setForTests(pixelSize: CGSize) { self.pixelSize = pixelSize }

    /// The picture as turned.
    var shownSize: CGSize { turns % 2 == 0 ? pixelSize : CGSize(width: pixelSize.height, height: pixelSize.width) }

    /// The zoom at which the picture fits the pane (never above 100%: a small picture stays sharp).
    var fitZoom: CGFloat {
        let s = shownSize
        guard s.width > 0, s.height > 0, paneSize.width > 0, paneSize.height > 0 else { return 1 }
        return min(1, min(paneSize.width / s.width, paneSize.height / s.height))
    }

    /// "1080 × 2338 · 50%"
    var readout: String {
        guard pixelSize.width > 0 else { return "" }
        let s = shownSize
        return "\(Int(s.width)) \u{00D7} \(Int(s.height)) \u{00B7} \(Int((zoom * 100).rounded()))%"
    }

    static func step(from z: CGFloat, up: Bool) -> CGFloat {
        if up { return steps.first { $0 > z + 0.001 } ?? steps.last! }
        return steps.last { $0 < z - 0.001 } ?? steps.first!
    }

    func zoom(in up: Bool) { set(Self.step(from: zoom, up: up), fits: false) }
    func actualSize() { set(1, fits: false) }
    func fit() { set(fitZoom, fits: true) }
    /// Double-click or double-tap: fit, or 100% where it was clicked.
    func toggle() { fits || abs(zoom - fitZoom) < 0.001 ? actualSize() : fit() }

    func set(_ z: CGFloat, fits: Bool) {
        self.fits = fits
        zoom = z
        apply(z, fits)
        Task { await sharpen() }
    }

    /// The view zoomed (pinch, trackpad).
    func zoomed(to z: CGFloat) {
        zoom = z
        fits = abs(z - fitZoom) < 0.001
        Task { await sharpen() }
    }

    func turn() {
        turns = (turns + 1) % 4
        Task { await load() }
    }

    // MARK: Decoding, off the main thread

    /// The longest side the screen needs at the current zoom, in pixels (with the display's scale).
    var neededPixels: Int {
        let scale: CGFloat
        #if os(macOS)
        scale = NSScreen.main?.backingScaleFactor ?? 2
        #else
        scale = 3
        #endif
        let s = shownSize
        // Fitting: the fit zoom, whatever the zoom was before the size was known.
        let shown = max(s.width, s.height) * (fits ? fitZoom : max(zoom, fitZoom)) * scale
        return Int(min(max(shown, 512), max(s.width, s.height), 8192))
    }

    func load() async {
        let url = url, turns = turns
        guard let info = await Task.detached(priority: .userInitiated, operation: { ImageDecoder.info(url) }).value else { failed = true; return }
        pixelSize = info.size
        hasAlpha = info.alpha
        if fits { zoom = fitZoom }
        if info.frames > 1 {
            let (f, d) = await Task.detached(priority: .userInitiated) { ImageDecoder.frames(url, turns: turns, maxPixels: 1600) }.value
            frames = f
            frameDuration = d
            image = f.first
            decoded = 1600
        } else {
            decoded = 0
            await sharpen(force: true)
        }
        if fits { fit() }
    }

    /// Decodes again at more pixels when the zoom needs them.
    func sharpen(force: Bool = false) async {
        guard frames.isEmpty else { return }
        let want = neededPixels
        guard force || want > decoded + 64 else { return }
        let url = url, turns = turns
        let img = await Task.detached(priority: .userInitiated) { ImageDecoder.decode(url, maxPixels: want, turns: turns) }.value
        guard let img else { if image == nil { failed = true }; return }
        image = img
        decoded = want
    }
}

/// Reading pictures with ImageIO: their size without decoding, and a decode at most `maxPixels` on
/// the longer side (a 50 MB photo is never decoded whole to fit a pane).
enum ImageDecoder {
    struct Info: Sendable { var size: CGSize; var alpha: Bool; var frames: Int }

    static func info(_ url: URL) -> Info? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = p[kCGImagePropertyPixelWidth] as? CGFloat, let h = p[kCGImagePropertyPixelHeight] as? CGFloat else { return nil }
        // Orientations 5-8 are a quarter turn: width and height swap.
        let o = (p[kCGImagePropertyOrientation] as? Int) ?? 1
        let size = o >= 5 ? CGSize(width: h, height: w) : CGSize(width: w, height: h)
        return Info(size: size, alpha: (p[kCGImagePropertyHasAlpha] as? Bool) ?? false, frames: CGImageSourceGetCount(src))
    }

    static func decode(_ url: URL, maxPixels: Int, turns: Int = 0) -> CGImage? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(maxPixels, 1),
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return rotated(img, turns: turns)
    }

    /// An animated GIF's frames (at most 300) and how long each shows.
    static func frames(_ url: URL, turns: Int, maxPixels: Int) -> ([CGImage], Double) {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return ([], 0.1) }
        let n = min(CGImageSourceGetCount(src), 300)
        var out: [CGImage] = [], total = 0.0
        let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxPixels]
        for i in 0 ..< n {
            guard let img = CGImageSourceCreateThumbnailAtIndex(src, i, opts as CFDictionary) else { continue }
            out.append(rotated(img, turns: turns) ?? img)
            let gif = (CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [CFString: Any])?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let d = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
            total += d < 0.02 ? 0.1 : d
        }
        return (out, out.isEmpty ? 0.1 : total / Double(out.count))
    }

    /// The picture turned clockwise by quarter turns.
    static func rotated(_ img: CGImage, turns: Int) -> CGImage? {
        let t = ((turns % 4) + 4) % 4
        guard t != 0 else { return img }
        let w = img.width, h = img.height
        let (ow, oh) = t % 2 == 0 ? (w, h) : (h, w)
        guard let ctx = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: img.colorSpace ?? CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.translateBy(x: CGFloat(ow) / 2, y: CGFloat(oh) / 2)
        ctx.rotate(by: -CGFloat(t) * .pi / 2)
        ctx.draw(img, in: CGRect(x: -CGFloat(w) / 2, y: -CGFloat(h) / 2, width: CGFloat(w), height: CGFloat(h)))
        return ctx.makeImage()
    }

    /// The picture turned, encoded again for Save a Copy: JPEG, PNG and HEIC keep their kind;
    /// anything else (GIF, WebP) becomes PNG.
    static func encodeRotated(_ url: URL, turns: Int) -> (Data, String)? {
        guard let img = decode(url, maxPixels: Int.max / 4, turns: turns) else { return nil }
        let ext = url.pathExtension.lowercased()
        let (type, outExt): (UTType, String) = ["jpg", "jpeg"].contains(ext) ? (.jpeg, ext) : ["heic", "heif"].contains(ext) ? (.heic, ext) : (.png, "png")
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return (data as Data, outExt)
    }
}

// MARK: The viewer

struct ImageViewer: View {
    @Bindable var file: Attachment
    let url: URL
    /// The folder's pictures, in the list's order, for the arrow keys and swipes.
    let neighbours: [Attachment]
    let open: (UUID) -> Void
    @Environment(\.modelContext) private var context
    @State private var model: ImageViewerModel
    @State private var copied = false
    @FocusState private var focused: Bool
    /// Stepping with the keys keeps the keys working on the next picture (a click in the list doesn't).
    @MainActor static var stepping = false

    init(file: Attachment, url: URL, neighbours: [Attachment], open: @escaping (UUID) -> Void, turns: Int = ImageViewer.captureTurns, actualSize: Bool = false) {
        self.file = file
        self.url = url
        self.neighbours = neighbours
        self.open = open
        let m = ImageViewerModel(url: url)
        m.turns = turns
        if actualSize { m.fits = false; m.zoom = 1 }
        _model = State(initialValue: m)
    }

    /// Captures: `-uitest -imageTurns 1` opens a picture turned a quarter.
    static var captureTurns: Int {
        let a = ProcessInfo.processInfo.arguments
        guard a.contains("-uitest"), let i = a.firstIndex(of: "-imageTurns"), i + 1 < a.count else { return 0 }
        return Int(a[i + 1]) ?? 0
    }

    private var index: Int? { neighbours.firstIndex { $0.id == file.id } }

    var body: some View {
        VStack(spacing: 0) {
            bar
            Divider()
            ZStack {
                Color.notePage
                if model.failed {
                    ContentUnavailableView("Can't show this picture", systemImage: "photo", description: Text("Its data doesn't open as an image."))
                } else {
                    ZoomingImage(model: model, next: { go(1) }, previous: { go(-1) })
                        .accessibilityLabel(file.filename)
                        .accessibilityIdentifier("file.image")
                }
            }
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size in
                model.paneSize = size
                if model.fits { model.fit() }
            }
            // The arrow keys step through the folder's pictures, and ⌘C copies this one, while the
            // picture has focus (a click on it): never taken from the search field or a note.
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onAppear { if Self.stepping { focused = true; Self.stepping = false } }
            .onKeyPress(.leftArrow) { go(-1); return .handled }
            .onKeyPress(.rightArrow) { go(1); return .handled }
            #if os(macOS)
            .onCopyCommand { [NSItemProvider(contentsOf: url)].compactMap { $0 } }
            #endif
        }
        .task(id: url) { await model.load() }
        .background {
            Button("Zoom In") { model.zoom(in: true) }.keyboardShortcut("=", modifiers: .command).hidden()
        }
    }

    private func go(_ by: Int) {
        guard let i = index, neighbours.indices.contains(i + by) else { return }
        Self.stepping = focused
        open(neighbours[i + by].id)
    }

    // MARK: The bar, as the PDF reader's

    private var bar: some View {
        HStack(spacing: 8) {
            #if os(macOS)
            Button { model.zoom(in: false) } label: { Label("Zoom Out", systemImage: "minus.magnifyingglass") }
                .keyboardShortcut("-", modifiers: .command)
                .help("Zoom Out (⌘-)")
            #endif
            Text(model.readout)
                .font(.callout.monospacedDigit())
                .foregroundStyle(Color.muted)
                .lineLimit(1)
                .fixedSize()
                .accessibilityIdentifier("image.readout")
            #if os(macOS)
            Button { model.zoom(in: true) } label: { Label("Zoom In", systemImage: "plus.magnifyingglass") }
                .keyboardShortcut("+", modifiers: .command)
                .help("Zoom In (⌘+)")
            Menu {
                Button("Fit") { model.fit() }
                Button("Actual Size") { model.actualSize() }.keyboardShortcut("0", modifiers: .command)
            } label: {
                Label("Zoom", systemImage: model.fits ? "arrow.up.left.and.arrow.down.right" : "1.magnifyingglass")
            }
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Fit or Actual Size (⌘0)")
            #endif
            Spacer(minLength: 8)
            if neighbours.count > 1, let i = index {
                Button { go(-1) } label: { Label("Previous Picture", systemImage: "chevron.left") }
                    .disabled(i == 0)
                    .help("Previous picture (←)")
                Text("\(i + 1) of \(neighbours.count)")
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(Color.muted)
                    .fixedSize()
                    .accessibilityIdentifier("image.position")
                Button { go(1) } label: { Label("Next Picture", systemImage: "chevron.right") }
                    .disabled(i == neighbours.count - 1)
                    .help("Next picture (→)")
                Spacer(minLength: 8)
            }
            Button { model.turn() } label: { Label("Rotate", systemImage: "rotate.right") }
                .keyboardShortcut("r", modifiers: .command)
                .help("Rotate (⌘R). The file stays as it is unless you save a copy.")
                .accessibilityIdentifier("image.rotate")
            if model.turns != 0 {
                Button { saveRotatedCopy() } label: { Label("Save a Copy", systemImage: "square.and.arrow.down.on.square") }
                    #if os(macOS)
                    .labelStyle(.titleOnly)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    #endif
                    .help("Save the turned picture as a copy next to this one")
                    .accessibilityIdentifier("image.saveCopy")
            }
            Button { copy() } label: { Label(copied ? "Copied" : "Copy Image", systemImage: copied ? "checkmark" : "doc.on.doc") }
                .help("Copy Image")
                .accessibilityIdentifier("image.copy")
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.bar)
    }

    private func copy() {
        ImageClipboard.copy(url: url, name: file.filename)
        withAnimation(.snappy) { copied = true }
        Task { try? await Task.sleep(for: .seconds(1.5)); withAnimation(.snappy) { copied = false } }
    }

    /// The turned picture as a new file next to this one; the original stays as it is.
    private func saveRotatedCopy() {
        let turns = model.turns, url = url, name = file.filename, folderID = file.folderID
        Task {
            guard let (data, ext) = await Task.detached(priority: .userInitiated, operation: { ImageDecoder.encodeRotated(url, turns: turns) }).value,
                  let folder = folderID.flatMap({ context.folder($0) }) else { return }
            let stem = (name as NSString).deletingPathExtension
            let tmp = FileManager.default.temporaryDirectory.appending(path: "\(stem) rotated.\(ext)")
            try? data.write(to: tmp, options: .atomic)
            if let made = context.addFiles([tmp], to: folder).first { open(made.id) }
            try? FileManager.default.removeItem(at: tmp)
        }
    }
}

/// The picture on the clipboard: the image itself, and the file for apps that take files.
enum ImageClipboard {
    @MainActor static func copy(url: URL, name: String) {
        #if os(macOS)
        let pb = NSPasteboard.general
        pb.clearContents()
        var items: [NSPasteboardWriting] = []
        if let img = NSImage(contentsOf: url) { items.append(img) }
        items.append(url as NSURL)
        pb.writeObjects(items)
        #else
        if let img = UIImage(contentsOfFile: url.path) { UIPasteboard.general.image = img }
        #endif
    }
}

/// The checkerboard under a picture with transparent parts, in the warm palette's greys.
enum Checkerboard {
    static let cell: CGFloat = 10

    static func image(dark: Bool) -> CGImage? {
        let s = Int(cell * 2)
        guard let ctx = CGContext(data: nil, width: s, height: s, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let (a, b): (CGColor, CGColor) = dark
            ? (CGColor(red: 0.16, green: 0.15, blue: 0.14, alpha: 1), CGColor(red: 0.21, green: 0.20, blue: 0.19, alpha: 1))
            : (CGColor(red: 0.99, green: 0.98, blue: 0.97, alpha: 1), CGColor(red: 0.92, green: 0.89, blue: 0.86, alpha: 1))
        ctx.setFillColor(a); ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))
        ctx.setFillColor(b)
        ctx.fill(CGRect(x: 0, y: 0, width: s / 2, height: s / 2))
        ctx.fill(CGRect(x: s / 2, y: s / 2, width: s / 2, height: s / 2))
        return ctx.makeImage()
    }
}

// MARK: Zooming, by the platform's own scroll views

#if os(macOS)
struct ZoomingImage: NSViewRepresentable {
    let model: ImageViewerModel
    let next: () -> Void
    let previous: () -> Void

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.contentView = CenteringClipView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.allowsMagnification = true
        scroll.minMagnification = ImageViewerModel.steps.first!
        scroll.maxMagnification = ImageViewerModel.steps.last!
        let doc = PictureView()
        scroll.documentView = doc
        let double = NSClickGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleClick(_:)))
        double.numberOfClicksRequired = 2
        doc.addGestureRecognizer(double)
        context.coordinator.scroll = scroll
        context.coordinator.model = model
        context.coordinator.observe()
        model.apply = { [weak scroll] z, _ in
            guard let scroll else { return }
            // Around the middle of what's shown, as Preview zooms.
            let v = scroll.documentVisibleRect
            scroll.animator().setMagnification(z, centeredAt: CGPoint(x: v.midX, y: v.midY))
            (scroll.documentView as? PictureView)?.zoom = z
        }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let doc = scroll.documentView as? PictureView else { return }
        let size = model.shownSize
        if doc.frame.size != size, size.width > 0 {
            doc.frame = CGRect(origin: .zero, size: size)
            // A new picture (or a turn) opens on its middle.
            DispatchQueue.main.async {
                let v = scroll.documentVisibleRect
                scroll.contentView.scroll(to: CGPoint(x: max(0, (size.width - v.width) / 2), y: max(0, (size.height - v.height) / 2)))
                scroll.reflectScrolledClipView(scroll.contentView)
            }
        }
        doc.show(model.image, frames: model.frames, duration: model.frameDuration, checker: model.hasAlpha)
        if abs(scroll.magnification - model.zoom) > 0.001 {
            let v = scroll.documentVisibleRect
            scroll.setMagnification(model.zoom, centeredAt: CGPoint(x: v.midX, y: v.midY))
        }
        doc.zoom = model.zoom
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor final class Coordinator: NSObject {
        weak var scroll: NSScrollView?
        weak var model: ImageViewerModel?
        nonisolated(unsafe) private var token: NSObjectProtocol?

        func observe() {
            guard let scroll else { return }
            token = NotificationCenter.default.addObserver(forName: NSScrollView.didEndLiveMagnifyNotification, object: scroll, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    if let s = self?.scroll {
                        self?.model?.zoomed(to: s.magnification)
                        (s.documentView as? PictureView)?.zoom = s.magnification
                    }
                }
            }
        }

        @objc func doubleClick(_ g: NSClickGestureRecognizer) { model?.toggle() }

        deinit { if let token { NotificationCenter.default.removeObserver(token) } }
    }
}

/// Keeps a picture smaller than the pane in its middle.
final class CenteringClipView: NSClipView {
    override func constrainBoundsRect(_ proposed: NSRect) -> NSRect {
        var r = super.constrainBoundsRect(proposed)
        guard let doc = documentView else { return r }
        if r.width > doc.frame.width { r.origin.x = (doc.frame.width - r.width) / 2 }
        if r.height > doc.frame.height { r.origin.y = (doc.frame.height - r.height) / 2 }
        return r
    }
}

/// The picture, over a checkerboard where it's transparent. GIFs animate.
final class PictureView: NSView {
    private let imageView = NSImageView()
    private var checker = false
    private var shown = ""
    /// The scroll view's zoom: the checkerboard keeps its size on screen whatever the zoom.
    var zoom: CGFloat = 1 { didSet { if checker, abs(zoom - oldValue) > 0.0001 { needsDisplay = true } } }

    override init(frame: NSRect) {
        super.init(frame: frame)
        imageView.imageScaling = .scaleAxesIndependently
        imageView.animates = true
        imageView.autoresizingMask = [.width, .height]
        addSubview(imageView)
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    func show(_ image: CGImage?, frames: [CGImage], duration: Double, checker: Bool) {
        if self.checker != checker { self.checker = checker; needsDisplay = true }
        imageView.frame = bounds
        // Set again only when the picture or the size changed: an animation keeps running.
        let key = "\(frames.count > 1 ? frames.first.map { ObjectIdentifier($0) }.debugDescription : image.map { ObjectIdentifier($0) }.debugDescription)|\(bounds.size)"
        guard key != shown else { return }
        shown = key
        if frames.count > 1 {
            imageView.image = Self.animated(frames, duration: duration, size: bounds.size)
        } else if let image {
            imageView.image = NSImage(cgImage: image, size: bounds.size)
        }
    }

    /// An NSImage that NSImageView animates: a GIF made from the frames.
    static func animated(_ frames: [CGImage], duration: Double, size: CGSize) -> NSImage? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, UTType.gif.identifier as CFString, frames.count, nil) else { return nil }
        CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        for f in frames { CGImageDestinationAddImage(dest, f, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: duration]] as CFDictionary) }
        guard CGImageDestinationFinalize(dest), let img = NSImage(data: data as Data) else { return nil }
        img.size = size
        return img
    }

    override func draw(_ dirtyRect: NSRect) {
        guard checker, let ctx = NSGraphicsContext.current?.cgContext,
              let tile = Checkerboard.image(dark: effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua) else { return }
        let side = Checkerboard.cell * 2 / max(zoom, 0.01)
        ctx.draw(tile, in: CGRect(x: 0, y: 0, width: side, height: side), byTiling: true)
    }
}
#else
struct ZoomingImage: UIViewRepresentable {
    let model: ImageViewerModel
    let next: () -> Void
    let previous: () -> Void

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.delegate = context.coordinator
        scroll.minimumZoomScale = ImageViewerModel.steps.first!
        scroll.maximumZoomScale = ImageViewerModel.steps.last!
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        let doc = PictureView()
        scroll.addSubview(doc)
        context.coordinator.scroll = scroll
        context.coordinator.doc = doc
        context.coordinator.model = model
        let double = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTap(_:)))
        double.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(double)
        for dir in [UISwipeGestureRecognizer.Direction.left, .right] {
            let swipe = UISwipeGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.swipe(_:)))
            swipe.direction = dir
            scroll.addGestureRecognizer(swipe)
        }
        model.apply = { [weak scroll] z, _ in
            UIView.animate(withDuration: 0.25) { scroll?.zoomScale = z }
        }
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        let c = context.coordinator
        c.next = next
        c.previous = previous
        guard let doc = c.doc else { return }
        let size = model.shownSize
        if size.width > 0, doc.bounds.size != size {
            scroll.zoomScale = 1
            doc.frame = CGRect(origin: .zero, size: size)
            scroll.contentSize = size
        }
        doc.show(model.image, frames: model.frames, duration: model.frameDuration, checker: model.hasAlpha)
        if abs(scroll.zoomScale - model.zoom) > 0.001 { scroll.zoomScale = model.zoom }
        doc.zoom = scroll.zoomScale
        c.center()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var scroll: UIScrollView?
        weak var doc: PictureView?
        weak var model: ImageViewerModel?
        var next: () -> Void = {}
        var previous: () -> Void = {}

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { doc }
        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            center()
            doc?.zoom = scrollView.zoomScale
        }
        func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) { model?.zoomed(to: scale) }

        /// Smaller than the pane: in its middle.
        func center() {
            guard let scroll, let doc else { return }
            let b = scroll.bounds.size, f = doc.frame.size
            scroll.contentInset = UIEdgeInsets(top: max(0, (b.height - f.height) / 2), left: max(0, (b.width - f.width) / 2), bottom: 0, right: 0)
        }

        @objc func doubleTap(_ g: UITapGestureRecognizer) { model?.toggle() }

        /// A swipe when the picture fits: the next or previous one.
        @objc func swipe(_ g: UISwipeGestureRecognizer) {
            guard model?.fits ?? false else { return }
            g.direction == .left ? next() : previous()
        }
    }
}

final class PictureView: UIView {
    private let imageView = UIImageView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        imageView.contentMode = .scaleToFill
        backgroundColor = .clear
        contentMode = .redraw
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(imageView)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ image: CGImage?, frames: [CGImage], duration: Double, checker: Bool) {
        imageView.frame = bounds
        if frames.count > 1 {
            if imageView.image?.images?.count != frames.count {
                imageView.image = UIImage.animatedImage(with: frames.map { UIImage(cgImage: $0) }, duration: duration * Double(frames.count))
            }
        } else if let image, imageView.image?.cgImage !== image {
            imageView.image = UIImage(cgImage: image)
        }
        if self.checker != checker { self.checker = checker; setNeedsDisplay() }
    }

    private var checker = false
    /// The scroll view's zoom: the checkerboard keeps its size on screen whatever the zoom.
    var zoom: CGFloat = 1 { didSet { if checker, abs(zoom - oldValue) > 0.0001 { setNeedsDisplay() } } }

    override func draw(_ rect: CGRect) {
        guard checker, let ctx = UIGraphicsGetCurrentContext(), let tile = Checkerboard.image(dark: traitCollection.userInterfaceStyle == .dark) else { return }
        let side = Checkerboard.cell * 2 / max(zoom, 0.01)
        ctx.draw(tile, in: CGRect(x: 0, y: 0, width: side, height: side), byTiling: true)
    }
}
#endif
