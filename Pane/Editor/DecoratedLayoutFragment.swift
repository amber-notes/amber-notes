import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Draws a line's decoration (checkbox, bullet, quote bar, code or table panel)
/// behind its text. One markdown line is one TextKit paragraph.
final class DecoratedLayoutFragment: NSTextLayoutFragment {
    var decoration: LineDecoration? {
        guard let p = textElement as? NSTextParagraph, p.attributedString.length > 0 else { return nil }
        return p.attributedString.attribute(.paneLine, at: 0, effectiveRange: nil) as? LineDecoration
    }

    private var containerWidth: CGFloat {
        let w = textLayoutManager?.textContainer?.size.width ?? layoutFragmentFrame.width
        let pad = textLayoutManager?.textContainer?.lineFragmentPadding ?? 0
        return max(w - pad * 2, layoutFragmentFrame.width)
    }

    override var renderingSurfaceBounds: CGRect {
        let base = super.renderingSurfaceBounds
        guard decoration != nil else { return base }
        return base.union(CGRect(x: -4, y: -2, width: containerWidth + 8, height: layoutFragmentFrame.height + 4))
    }

    /// Vertical center of the first line's text, for markers.
    private var firstLineMidY: CGFloat {
        guard let line = textLineFragments.first else { return layoutFragmentFrame.height / 2 }
        let b = line.typographicBounds
        return b.minY + (b.height - EditorMetrics.lineSpacing) / 2
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        if let d = decoration {
            context.saveGState()
            drawDecoration(d, at: point, in: context)
            context.restoreGState()
        }
        super.draw(at: point, in: context)
    }

    private func drawDecoration(_ d: LineDecoration, at o: CGPoint, in ctx: CGContext) {
        let h = layoutFragmentFrame.height
        switch d.kind {
        case .bullet:
            let r: CGFloat = EditorMetrics.body * 0.17
            let c = CGPoint(x: o.x + d.markerX, y: o.y + firstLineMidY)
            ctx.setFillColor(PColor.paneSecondary.cgColor)
            ctx.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))

        case .checkbox(let checked):
            let size = EditorMetrics.body * 1.12
            let rect = CGRect(x: o.x + d.markerX - size / 2, y: o.y + firstLineMidY - size / 2, width: size, height: size)
            if checked {
                ctx.setFillColor(PColor.paneAccent.cgColor)
                ctx.fillEllipse(in: rect)
                let s = size
                ctx.setStrokeColor(PColor.white.cgColor)
                ctx.setLineWidth(s * 0.11)
                ctx.setLineCap(.round)
                ctx.setLineJoin(.round)
                ctx.move(to: CGPoint(x: rect.minX + s * 0.28, y: rect.midY + s * 0.02))
                ctx.addLine(to: CGPoint(x: rect.minX + s * 0.44, y: rect.midY + s * 0.17))
                ctx.addLine(to: CGPoint(x: rect.minX + s * 0.73, y: rect.midY - s * 0.16))
                ctx.strokePath()
            } else {
                ctx.setStrokeColor(PColor.paneTertiary.cgColor)
                ctx.setLineWidth(1.4)
                ctx.strokeEllipse(in: rect.insetBy(dx: 0.7, dy: 0.7))
            }

        case .quote:
            let bar = CGRect(x: o.x + 2, y: o.y + 1, width: 3, height: h - 2)
            ctx.setFillColor(PColor.paneAccent.withAlphaComponent(0.7).cgColor)
            ctx.addPath(CGPath(roundedRect: bar, cornerWidth: 1.5, cornerHeight: 1.5, transform: nil))
            ctx.fillPath()

        case .code(let first, let last):
            panel(ctx, o: o, h: h, first: first, last: last, fill: PColor.paneFill, radius: 10, stroke: nil)

        case .table(let header, let first, let last):
            panel(ctx, o: o, h: h, first: first, last: last, fill: header ? PColor.paneFill : PColor.paneFill.withAlphaComponent(0.4), radius: 8, stroke: nil)
            if !last {
                ctx.setFillColor(PColor.paneSeparator.withAlphaComponent(0.35).cgColor)
                ctx.fill(CGRect(x: o.x + 8, y: o.y + h - 0.5, width: containerWidth - 16, height: 0.5))
            }

        case .rule:
            ctx.setFillColor(PColor.paneSeparator.cgColor)
            ctx.fill(CGRect(x: o.x, y: o.y + firstLineMidY, width: containerWidth, height: 1))
        }
    }

    /// A panel that joins with its neighbours: only the block's outer corners are round.
    private func panel(_ ctx: CGContext, o: CGPoint, h: CGFloat, first: Bool, last: Bool, fill: PColor, radius: CGFloat, stroke: PColor?) {
        let top: CGFloat = first ? 2 : 0
        let bottom: CGFloat = last ? 2 : 0
        let rect = CGRect(x: o.x, y: o.y + top, width: containerWidth, height: h - top - bottom)
        let path = CGMutablePath()
        let rt = first ? radius : 0, rb = last ? radius : 0
        path.move(to: CGPoint(x: rect.minX + rt, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - rt, y: rect.minY))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + rt), radius: rt)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - rb))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - rb, y: rect.maxY), radius: rb)
        path.addLine(to: CGPoint(x: rect.minX + rb, y: rect.maxY))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - rb), radius: rb)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + rt))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + rt, y: rect.minY), radius: rt)
        path.closeSubpath()
        ctx.addPath(path)
        ctx.setFillColor(fill.cgColor)
        ctx.fillPath()
    }
}

/// Hands out decorated fragments to TextKit.
final class DecoratingLayoutDelegate: NSObject, NSTextLayoutManagerDelegate {
    func textLayoutManager(_ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: any NSTextLocation, in textElement: NSTextElement) -> NSTextLayoutFragment {
        DecoratedLayoutFragment(textElement: textElement, range: textElement.elementRange)
    }
}
