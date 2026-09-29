import QuartzCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// When ticked items sink (or unticked ones rise), the rows slide to their new places like
/// Notes, instead of jumping. The text is reordered at once; for the length of the slide,
/// pictures of the old rows cover it and move from where each row was to where it is now.
@MainActor
enum ReorderSlide {
    static let duration: CFTimeInterval = 0.35

    /// For each old line, its index after the reorder. Lines are matched by their text; equal
    /// lines keep their relative order.
    static func moves(old: [String], new: [String]) -> [Int] {
        var used = Set<Int>()
        return old.map { line in
            let j = new.indices.first { !used.contains($0) && new[$0] == line } ?? 0
            used.insert(j)
            return j
        }
    }

    /// Each old line's top after the reorder, relative to the run's top, from the lines' heights
    /// (a row keeps its height: its text moves with it).
    static func targets(heights: [CGFloat], moves: [Int]) -> [CGFloat] {
        var byNew = Array(repeating: CGFloat(0), count: heights.count)
        for (i, j) in moves.enumerated() where j < byNew.count { byNew[j] = heights[i] }
        var tops: [CGFloat] = []
        var y: CGFloat = 0
        for h in byNew { tops.append(y); y += h }
        return moves.map { $0 < tops.count ? tops[$0] : 0 }
    }

    /// The run's lines as `(text, range)`, the last one without its newline.
    static func lines(of range: NSRange, in text: NSString) -> [(String, NSRange)] {
        var out: [(String, NSRange)] = []
        text.enumerateSubstrings(in: range, options: [.byLines]) { s, r, _, _ in out.append((s ?? "", r)) }
        return out
    }

    #if os(macOS)
    /// Slides pictures of the old rows (`rows`, in `view`'s flipped coordinates) to their new
    /// tops over a cover the colour of the page. Call right after the text is reordered.
    static func play(in view: NSView, rows: [(image: CGImage, frame: CGRect)], newTops: [CGFloat], cover: CGRect, pageColor: NSColor) {
        guard !CheckPop.reduceMotion, rows.count > 1, let host = view.layer else { return }
        let top = rows.map(\.frame.minY).min() ?? 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let shield = CALayer()
        shield.frame = cover
        // Resolve the page colour in the view's own appearance (light or dark), not the app's.
        var page = pageColor.cgColor
        view.effectiveAppearance.performAsCurrentDrawingAppearance { page = pageColor.cgColor }
        shield.backgroundColor = page
        shield.zPosition = 20
        host.addSublayer(shield)
        var layers = [shield]
        for (i, row) in rows.enumerated() {
            let l = CALayer()
            l.contents = row.image
            l.contentsScale = view.window?.backingScaleFactor ?? 2
            l.frame = row.frame
            l.zPosition = 21
            host.addSublayer(l)
            layers.append(l)
            let to = CGPoint(x: row.frame.midX, y: top + newTops[i] + row.frame.height / 2)
            let slide = CABasicAnimation(keyPath: "position")
            slide.fromValue = NSValue(point: CGPoint(x: row.frame.midX, y: row.frame.midY))
            slide.toValue = NSValue(point: to)
            slide.duration = duration
            slide.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            l.position = to
            l.add(slide, forKey: "slide")
        }
        CATransaction.commit()
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) { layers.forEach { $0.removeFromSuperlayer() } }
    }

    /// A picture of `rect` of `view` as it's drawn now.
    /// Drawn over the page colour, so the text is smoothed against the page as it is on screen.
    static func picture(of rect: CGRect, in view: NSView, page: NSColor = .textBackgroundColor) -> CGImage? {
        guard rect.width > 0, rect.height > 0, let rep = view.bitmapImageRepForCachingDisplay(in: rect),
              let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        view.effectiveAppearance.performAsCurrentDrawingAppearance {
            page.setFill()
            NSRect(x: 0, y: 0, width: rep.size.width, height: rep.size.height).fill()
        }
        NSGraphicsContext.restoreGraphicsState()
        view.cacheDisplay(in: rect, to: rep)
        return rep.cgImage
    }
    #else
    static func play(in view: UIView, rows: [(snapshot: UIView, frame: CGRect)], newTops: [CGFloat], cover: CGRect, pageColor: UIColor) {
        guard !CheckPop.reduceMotion, rows.count > 1 else { return }
        let top = rows.map(\.frame.minY).min() ?? 0
        let shield = UIView(frame: cover)
        shield.backgroundColor = pageColor
        shield.isUserInteractionEnabled = false
        view.addSubview(shield)
        for row in rows {
            row.snapshot.frame = row.frame
            row.snapshot.isUserInteractionEnabled = false
            view.addSubview(row.snapshot)
        }
        UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseInOut]) {
            for (i, row) in rows.enumerated() { row.snapshot.frame.origin.y = top + newTops[i] }
        } completion: { _ in
            shield.removeFromSuperview()
            rows.forEach { $0.snapshot.removeFromSuperview() }
        }
    }
    #endif
}
