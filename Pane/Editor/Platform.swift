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
    /// Pane's accent: a warm amber that reads on glass in light and dark.
    static var paneAccent: PColor { PColor(red: 0.96, green: 0.68, blue: 0.20, alpha: 1) }
}

/// Type sizes for the editor. iOS reads at arm's length; the Mac at a desk.
enum EditorMetrics {
    #if os(iOS)
    static let body: CGFloat = 17
    static let title: CGFloat = 28
    static let lineSpacing: CGFloat = 5
    #else
    // Apple Notes on the Mac: 13 pt body, 24 pt title.
    static let body: CGFloat = 13
    static let title: CGFloat = 24
    static let lineSpacing: CGFloat = 4
    #endif
    static let gutter: CGFloat = body * 1.6
    static let nestStep: CGFloat = body * 1.4
}
