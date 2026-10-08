#if os(macOS)
import AppKit
import PDFKit
import Testing
@testable import Pane

/// The PDF reader zooms around the middle of what's shown and keeps a page narrower than the view
/// centred on every step, with nothing moving afterwards (Emil: "it only centers after a zoom").
/// A real PDFView in a borderless window at -20000,-20000 that's never ordered front. Each step's
/// page placement is attached to the results as the frame-by-frame record. CI only.
@MainActor @Suite(.serialized) struct PDFZoomTests {
    static var onCI: Bool { ProcessInfo.processInfo.environment["PANE_SNAPSHOTS"] == "1" }

    @Test func zoomStaysCentredOnEveryStep() async throws {
        guard Self.onCI else { return }
        let doc = try #require(PDFDocument(data: DemoData.bookPDF(title: "Fluent Python", chapters: DemoData.fluentPythonChapters)))
        let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 900, height: 640), styleMask: [.borderless], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        let v = PDFView(frame: CGRect(x: 0, y: 0, width: 900, height: 640))
        v.document = doc
        v.displayMode = .singlePageContinuous
        v.autoScales = true
        w.contentView = v
        defer { w.close() }
        v.layoutDocumentView()
        try? await Task.sleep(for: .milliseconds(400))
        let model = PDFReaderModel(document: doc)
        model.view = v
        v.go(to: try #require(doc.page(at: 2)))
        var record: [String] = []
        func check(_ step: String) async throws {
            // Same turn: right after the zoom. Then again after the run loop has had its say: no snap.
            let now = try #require(PDFZoom.placement(v))
            try? await Task.sleep(for: .milliseconds(200))
            let later = try #require(PDFZoom.placement(v))
            record.append("\(step): scale \(String(format: "%.2f", v.scaleFactor)) page.midX \(Int(now.page.midX)) visible.midX \(Int(now.visible.midX)) later.page.midX \(Int(later.page.midX))")
            if now.page.width < now.visible.width {
                #expect(abs(now.page.midX - now.visible.midX) <= 1, "\(step): centred at once")
            }
            #expect(abs(later.page.midX - now.page.midX) <= 1 && abs(later.page.midY - now.page.midY) <= 1, "\(step): nothing moves after the zoom")
        }
        try await check("fit")
        for i in 1 ... 6 { model.zoom(in: true); try await check("in \(i)") }
        for i in 1 ... 10 { model.zoom(in: false); try await check("out \(i)") }
        model.actualSize(); try await check("actual size")
        // Zooming in around the middle: the point of the page in the middle is still in the middle.
        let before = try #require(PDFZoom.placement(v))
        let middleBefore = CGPoint(x: (before.visible.midX - before.page.minX) / before.page.width, y: (before.visible.midY - before.page.minY) / before.page.height)
        model.zoom(in: true)
        let after = try #require(PDFZoom.placement(v))
        let middleAfter = CGPoint(x: (after.visible.midX - after.page.minX) / after.page.width, y: (after.visible.midY - after.page.minY) / after.page.height)
        record.append("anchor before \(middleBefore) after \(middleAfter)")
        #expect(abs(middleAfter.y - middleBefore.y) < 0.02, "the same line of the page stays in the middle")
        Testing.Attachment.record(record.joined(separator: "\n"), named: "pdf-zoom-frames.txt")
    }
}
#endif
