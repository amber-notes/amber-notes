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

    /// 18% amber over the page (scaled by `strength` while a live tint comes and goes), as an
    /// opaque colour: neighbouring lines may overlap by a pixel, and a translucent fill would show
    /// that as a darker seam. The accent bar blends from the page to full amber the same way.
    private static func changeColors(_ strength: CGFloat) -> (tint: CGColor, bar: CGColor) {
        #if os(iOS)
        let page = UIColor.systemBackground.resolvedColor(with: .current)
        let accent = PColor.paneAccent.resolvedColor(with: .current)
        #else
        let page = NSColor.textBackgroundColor.usingColorSpace(.sRGB) ?? .white
        let accent = PColor.paneAccent.usingColorSpace(.sRGB) ?? PColor.paneAccent
        #endif
        var (pr, pg, pb, pa) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
        var (ar, ag, ab, aa) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
        page.getRed(&pr, green: &pg, blue: &pb, alpha: &pa)
        accent.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        func mix(_ t: CGFloat) -> CGColor { PColor(red: pr + (ar - pr) * t, green: pg + (ag - pg) * t, blue: pb + (ab - pb) * t, alpha: 1).cgColor }
        return (mix(0.18 * strength), mix(min(1, strength)))
    }

    /// Where this paragraph starts in the text, and the editor's tint for AI changes.
    private var tintAndOffset: (ChangeTint, Int)? {
        guard let tlm = textLayoutManager, let tint = (tlm.delegate as? DecoratingLayoutDelegate)?.tint, !tint.ranges.isEmpty,
              let tcm = tlm.textContentManager, let start = textElement?.elementRange?.location else { return nil }
        return (tint, tcm.offset(from: tcm.documentRange.location, to: start))
    }

    /// Changed by an AI connection just now: how strongly to tint it, 0 for not at all.
    private var highlight: CGFloat {
        if !ChangeHighlight.lines.isEmpty, let p = textElement as? NSTextParagraph {
            return ChangeHighlight.matches(p.attributedString.string) ? 1 : 0
        }
        guard let (tint, offset) = tintAndOffset else { return 0 }
        return tint.strength(at: offset)
    }

    /// Room for the tint while the line is one of the changed ones, even at zero, so the last
    /// frame of the fade paints over the band.
    private var highlighted: Bool {
        if !ChangeHighlight.lines.isEmpty { return highlight > 0 }
        guard let (tint, offset) = tintAndOffset else { return false }
        return tint.covers(offset)
    }

    override var renderingSurfaceBounds: CGRect {
        let base = super.renderingSurfaceBounds
        guard decoration != nil || highlighted else { return base }
        let left = -layoutFragmentFrame.minX
        return base.union(CGRect(x: left - 4, y: -14, width: containerWidth + 8, height: layoutFragmentFrame.height + 28))
    }

    /// Vertical center of the first line's text, for markers.
    private var firstLineMidY: CGFloat {
        guard let line = textLineFragments.first else { return layoutFragmentFrame.height / 2 }
        let b = line.typographicBounds
        return b.minY + (b.height - EditorMetrics.lineSpacing) / 2
    }

    /// Where a checkbox centres: halfway up the capitals, on the text's own baseline,
    /// so the circle sits level with the words whatever the line spacing.
    private var checkMidY: CGFloat {
        guard let line = textLineFragments.first else { return firstLineMidY }
        let font = PFont.systemFont(ofSize: EditorMetrics.body)
        return line.typographicBounds.minY + line.glyphOrigin.y - font.capHeight / 2
    }

    /// Where a bullet or dash centres: halfway up the lowercase letters, measured from the
    /// text's own baseline (the line box's middle sits above them, by the descender).
    private var bulletMidY: CGFloat {
        guard let line = textLineFragments.first else { return firstLineMidY }
        let font = PFont.systemFont(ofSize: EditorMetrics.body)
        return line.typographicBounds.minY + line.glyphOrigin.y - font.xHeight / 2
    }

    /// The checklist circle, in this fragment's coordinates.
    func checkboxRect(_ d: LineDecoration) -> CGRect {
        let size = EditorMetrics.checkSize
        return CGRect(x: d.markerX - size / 2, y: checkMidY - size / 2, width: size, height: size)
    }

    /// Notes' checklist circle: a light grey hairline ring, or a filled accent disc with a white tick.
    static func drawCheckbox(checked: Bool, in rect: CGRect, ctx: CGContext) {
        if checked {
            ctx.setFillColor(PColor.paneAccent.cgColor)
            ctx.fillEllipse(in: rect)
            let s = rect.width
            // The tick of SF Symbols' checkmark.circle.fill: short arm, long arm, round caps.
            ctx.setStrokeColor(PColor.white.cgColor)
            ctx.setLineWidth(s * 0.1)
            ctx.setLineCap(.round)
            ctx.setLineJoin(.round)
            ctx.move(to: CGPoint(x: rect.minX + s * 0.29, y: rect.minY + s * 0.51))
            ctx.addLine(to: CGPoint(x: rect.minX + s * 0.44, y: rect.minY + s * 0.66))
            ctx.addLine(to: CGPoint(x: rect.minX + s * 0.715, y: rect.minY + s * 0.355))
            ctx.strokePath()
        } else {
            let w = EditorMetrics.checkStroke
            ctx.setStrokeColor((EditorMetrics.increasedContrast ? PColor.paneSecondary : PColor.paneCheckRing).cgColor)
            ctx.setLineWidth(w)
            ctx.strokeEllipse(in: rect.insetBy(dx: w / 2, dy: w / 2))
        }
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        let strength = highlight
        if strength > 0 {
            // A soft amber band across the column with an accent bar at its left edge. Changed
            // lines next to each other join into one block, like a change marker.
            // Inside the rendering surface (4 pt either side). Edges are drawn without antialiasing so
            // neighbouring lines snap to the same pixel row and join with no seam.
            let rect = CGRect(x: point.x - layoutFragmentFrame.minX - 4, y: point.y,
                              width: containerWidth + 8, height: layoutFragmentFrame.height)
            context.saveGState()
            context.setShouldAntialias(false)
            let colors = Self.changeColors(strength)
            context.setFillColor(colors.tint)
            context.fill(rect)
            context.setFillColor(colors.bar)
            context.fill(CGRect(x: rect.minX, y: rect.minY, width: 3, height: rect.height))
            context.restoreGState()
        }
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
            // Solid dots in the text colour, like Notes.
            let r: CGFloat = EditorMetrics.body * 0.19
            let c = CGPoint(x: o.x + d.markerX, y: o.y + bulletMidY)
            ctx.setFillColor(PColor.paneLabel.cgColor)
            ctx.fillEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))

        case .dash:
            // Notes' dashed list: an en dash in the text colour, on the lowercase middle.
            let w = EditorMetrics.body * 0.5, t = max(1, EditorMetrics.body * 0.075)
            let c = CGPoint(x: o.x + d.markerX, y: o.y + bulletMidY)
            ctx.setFillColor(PColor.paneLabel.cgColor)
            ctx.fill(CGRect(x: c.x - w / 2, y: c.y - t / 2, width: w, height: t))

        case .checkbox(let checked):
            Self.drawCheckbox(checked: checked, in: checkboxRect(d).offsetBy(dx: o.x, dy: o.y), ctx: ctx)

        case .quote:
            let bar = CGRect(x: o.x + 2, y: o.y + 1, width: 3, height: h - 2)
            ctx.setFillColor(PColor.paneAccent.withAlphaComponent(0.7).cgColor)
            ctx.addPath(CGPath(roundedRect: bar, cornerWidth: 1.5, cornerHeight: 1.5, transform: nil))
            ctx.fillPath()

        case .code(let first, let last):
            panel(ctx, o: o, h: h, first: first, last: last, fill: PColor.paneFill, radius: 10, stroke: nil)

        case .table(let header, let first, let last, let columns, let width):
            let w = min(width, containerWidth)
            if h < 3 {
                // Collapsed delimiter row: the header's bottom rule.
                ctx.setFillColor(PColor.paneSeparator.withAlphaComponent(0.6).cgColor)
                ctx.fill(CGRect(x: o.x, y: o.y, width: w, height: 1))
                break
            }
            let rect = CGRect(x: o.x, y: o.y, width: w, height: h)
            let path = roundedPath(rect, top: first ? 10 : 0, bottom: last ? 10 : 0)
            ctx.addPath(path)
            ctx.setFillColor((header ? PColor.paneFill : PColor.panePanel).cgColor)
            ctx.fillPath()
            ctx.setFillColor(PColor.paneSeparator.withAlphaComponent(0.35).cgColor)
            for x in columns where x < w {
                ctx.fill(CGRect(x: o.x + x, y: o.y + 6, width: 0.75, height: h - 12))
            }
            if !last && !header {
                ctx.fill(CGRect(x: o.x + 10, y: o.y + h - 0.5, width: w - 20, height: 0.5))
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
        ctx.addPath(roundedPath(rect, top: first ? radius : 0, bottom: last ? radius : 0))
        ctx.setFillColor(fill.cgColor)
        ctx.fillPath()
    }

    /// A rectangle with independent top and bottom corner radii.
    private func roundedPath(_ rect: CGRect, top rt: CGFloat, bottom rb: CGFloat) -> CGPath {
        let path = CGMutablePath()
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
        return path
    }
}

/// Hands out decorated fragments to TextKit.
final class DecoratingLayoutDelegate: NSObject, NSTextLayoutManagerDelegate {
    /// Lines an AI just changed, for the fragments to tint.
    let tint = ChangeTint()

    func textLayoutManager(_ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: any NSTextLocation, in textElement: NSTextElement) -> NSTextLayoutFragment {
        DecoratedLayoutFragment(textElement: textElement, range: textElement.elementRange)
    }
}
