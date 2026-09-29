#if os(macOS)
import AppKit
import SwiftUI

/// A toolbar symbol redrawn so its ink sits in the optical centre of the button.
/// AppKit centres a symbol's layout box, and a few symbols (the compose pencil) carry ink
/// well off that centre; `.offset` on a toolbar label is ignored, so the fix lives in the image.
enum ToolbarGlyph {
    /// Point size that matches the other symbols in the unified toolbar.
    static let pointSize: CGFloat = 16

    static func image(_ name: String, shift: CGSize) -> Image {
        Image(nsImage: nsImage(name, shift: shift))
    }

    static func nsImage(_ name: String, shift: CGSize) -> NSImage {
        let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .regular, scale: .medium)
        guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) else { return NSImage() }
        // Same canvas as the symbol, so the button keeps the size of its neighbours.
        let size = symbol.size
        // shift is in points, +x right, +y down (like SwiftUI).
        let image = NSImage(size: size, flipped: false) { rect in
            symbol.draw(in: rect.offsetBy(dx: shift.width, dy: -shift.height))
            return true
        }
        image.isTemplate = true
        return image
    }

    /// The compose pencil's ink sits right of and below the symbol's centre.
    static let composeShift = CGSize(width: -0.75, height: 0.25)
}
#endif
