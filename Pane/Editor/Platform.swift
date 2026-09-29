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
    /// Checklist circle, the size Notes uses.
    static var checkSize: CGFloat { body * 1.35 }
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
