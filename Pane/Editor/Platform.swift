#if os(iOS)
import UIKit
typealias PFont = UIFont
typealias PColor = UIColor
typealias PFontDescriptor = UIFontDescriptor

extension PFontDescriptor.SymbolicTraits {
    static let paneBold: Self = .traitBold
    static let paneItalic: Self = .traitItalic
    static let paneMonoSpace: Self = .traitMonoSpace
}

extension PFont {
    func with(_ traits: UIFontDescriptor.SymbolicTraits) -> PFont {
        guard let d = fontDescriptor.withSymbolicTraits(fontDescriptor.symbolicTraits.union(traits)) else { return self }
        return PFont(descriptor: d, size: pointSize)
    }
}

extension PColor {
    static var paneLabel: PColor { .label }
    static var paneSecondary: PColor { .secondaryLabel }
    static var paneTertiary: PColor { .tertiaryLabel }
    static var paneFill: PColor { .secondarySystemBackground }
    static var panePanel: PColor { UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.13, alpha: 1) : UIColor(white: 0.975, alpha: 1) } }
    static var paneSeparator: PColor { .separator }
}
#else
import AppKit
typealias PFont = NSFont
typealias PColor = NSColor
typealias PFontDescriptor = NSFontDescriptor

extension PFontDescriptor.SymbolicTraits {
    static let paneBold: Self = .bold
    static let paneItalic: Self = .italic
    static let paneMonoSpace: Self = .monoSpace
}

extension PFont {
    func with(_ traits: NSFontDescriptor.SymbolicTraits) -> PFont {
        let d = fontDescriptor.withSymbolicTraits(fontDescriptor.symbolicTraits.union(traits))
        return PFont(descriptor: d, size: pointSize) ?? self
    }
}

extension PColor {
    static var paneLabel: PColor { .labelColor }
    static var paneSecondary: PColor { .secondaryLabelColor }
    static var paneTertiary: PColor { .tertiaryLabelColor }
    static var paneFill: PColor { NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 0.19, alpha: 1) : NSColor(white: 0.94, alpha: 1) } }
    static var panePanel: PColor { NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 0.15, alpha: 1) : NSColor(white: 0.975, alpha: 1) } }
    static var paneSeparator: PColor { .separatorColor }
}
#endif

extension PColor {
    /// An empty checklist circle: Notes' light grey ring (systemGray3), a touch lighter than secondary text.
    static var paneCheckRing: PColor {
        #if os(iOS)
        .systemGray3
        #else
        NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 0.36, alpha: 1) : NSColor(white: 0.77, alpha: 1) }
        #endif
    }

    /// The warm amber accent: a touch deeper in light mode so it still reads on white.
    static var paneAccent: PColor { PColor(named: "AccentColor") ?? PColor(red: 0.96, green: 0.68, blue: 0.20, alpha: 1) }
}

/// Type sizes for the editor. iOS reads at arm's length; the Mac at a desk.
enum EditorMetrics {
    #if os(iOS)
    // Follows the reader's text size (Dynamic Type), from 17 pt at the default size, like Notes.
    static var body: CGFloat { UIFontMetrics(forTextStyle: .body).scaledValue(for: 17) }
    static var title: CGFloat { UIFontMetrics(forTextStyle: .title1).scaledValue(for: 28) }
    static var lineSpacing: CGFloat { UIFontMetrics(forTextStyle: .body).scaledValue(for: 5) }
    #else
    // Apple Notes on the Mac: 13 pt body, ~20 pt title, tight lines.
    static let body: CGFloat = 13
    static let title: CGFloat = 20
    static let lineSpacing: CGFloat = 1.5
    #endif
    static var gutter: CGFloat { body * 1.6 }
    // Checklists, measured from Apple Notes (.shots/checklist/reference.md), as ratios of the body size.
    /// Circle diameter: 20.3 pt at iOS's 17 pt body.
    static var checkSize: CGFloat { body * 1.2 }
    /// From the circle's right edge to the text.
    static var checkGap: CGFloat { body * 0.64 }
    /// Distance from one item's baseline to the next.
    static var checkPitch: CGFloat { body * 1.76 }
    /// The empty circle's hairline: about 1.1 pt on iPhone, never under 1 pt.
    static var checkStroke: CGFloat { max(1, body * 0.065) }
    /// How far from the circle's centre a click still ticks it (a 24 pt target at least).
    static var checkHitRadius: CGFloat { max(checkSize / 2 + 3, 12) }
    static var nestStep: CGFloat { body * 1.4 }

    /// Increase Contrast is on: outlines drawn by hand use the label colour.
    nonisolated static var increasedContrast: Bool {
        #if os(iOS)
        UIAccessibility.isDarkerSystemColorsEnabled
        #else
        NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
        #endif
    }
}

/// iPhone: a note opens with its date just above the top, like Notes; you pull down to see it.
enum DateFold {
    static let labelTop: CGFloat = 12
    static let labelHeight: CGFloat = 18
    /// How far the note starts scrolled: the date and a little air under it.
    static let hide: CGFloat = labelTop + labelHeight + 2

    /// The content offset that puts the date just out of view.
    static func offset(top: CGFloat) -> CGFloat { -top + hide }

    /// The extra room a short note needs at the bottom so it can still scroll past the date.
    static func bottomInset(viewHeight: CGFloat, contentHeight: CGFloat, top: CGFloat, bottom: CGFloat) -> CGFloat {
        max(0, viewHeight - top - bottom + hide - contentHeight)
    }

    /// Captures: `-uitest -showDate` opens notes with the date in view (as if pulled down).
    static let showOnOpen = ProcessInfo.processInfo.arguments.contains("-uitest") && ProcessInfo.processInfo.arguments.contains("-showDate")
}
