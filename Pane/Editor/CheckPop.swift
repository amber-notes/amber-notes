import QuartzCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The little pop a checklist circle gives when you tick it, like Notes: the filled disc
/// grows in with a slight overshoot and settles. Drawn as a short-lived layer over the
/// circle the text already shows, then removed. Nothing plays with Reduce Motion on.
@MainActor
enum CheckPop {
    static var reduceMotion: Bool {
        #if os(iOS)
        UIAccessibility.isReduceMotionEnabled
        #else
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #endif
    }

    /// `rect` is the circle in `host`'s coordinates (y grows downwards, as in text views).
    static func play(in host: CALayer, rect: CGRect) {
        guard !reduceMotion, rect.width > 0 else { return }
        let s = rect.width
        let pop = CALayer()
        pop.frame = rect
        pop.zPosition = 10

        let disc = CAShapeLayer()
        disc.frame = pop.bounds
        disc.path = CGPath(ellipseIn: pop.bounds, transform: nil)
        disc.fillColor = PColor.paneAccent.cgColor
        pop.addSublayer(disc)

        let tick = CAShapeLayer()
        tick.frame = pop.bounds
        let path = CGMutablePath()
        path.move(to: CGPoint(x: s * 0.29, y: s * 0.51))
        path.addLine(to: CGPoint(x: s * 0.44, y: s * 0.66))
        path.addLine(to: CGPoint(x: s * 0.715, y: s * 0.355))
        tick.path = path
        tick.strokeColor = PColor.white.cgColor
        tick.fillColor = nil
        tick.lineWidth = s * 0.1
        tick.lineCap = .round
        tick.lineJoin = .round
        pop.addSublayer(tick)
        host.addSublayer(pop)

        CATransaction.begin()
        CATransaction.setCompletionBlock { pop.removeFromSuperlayer() }
        let grow = CAKeyframeAnimation(keyPath: "transform.scale")
        grow.values = [0.55, 1.12, 0.97, 1.0]
        grow.keyTimes = [0, 0.45, 0.75, 1]
        grow.timingFunctions = [CAMediaTimingFunction(name: .easeOut), CAMediaTimingFunction(name: .easeInEaseOut), CAMediaTimingFunction(name: .easeInEaseOut)]
        grow.duration = 0.32
        pop.add(grow, forKey: "grow")
        let draw = CABasicAnimation(keyPath: "strokeEnd")
        draw.fromValue = 0
        draw.toValue = 1
        draw.beginTime = CACurrentMediaTime() + 0.06
        draw.duration = 0.2
        draw.fillMode = .backwards
        draw.timingFunction = CAMediaTimingFunction(name: .easeOut)
        tick.add(draw, forKey: "draw")
        CATransaction.commit()
    }
}
