import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Amber Notes' warm grey: a hint of the icon's brown (#8A4A1C) in the greys themselves, never a
/// layer over them. The sidebar takes the most, the list less, and the note page almost none.
/// On iPhone in dark mode the grounds stay pure black beside the Dynamic Island; only rows warm.
/// Compiled into the share extension too (with Platform.swift), so nothing here reaches app code.
enum Palette {
    /// The brown the greys lean toward.
    static let brown: UInt32 = 0x8A4A1C

    // Ink and muted text: the website's warm brown, one step off pure black and white.
    static let ink = pair(0x2A1D10, 0xFBEEDD)
    static let muted = pair(0x74604C, 0xCDB598)

    /// The deeper amber: accent, links and an AI's tint (AccentColor.colorset holds the same).
    static let amber = pair(0xD96A06, 0xF4AD33)
    /// Amber as text beside an AI's mark: dark enough to read on white.
    static let amberInk = pair(0xA85700, 0xF4AD33)
    /// The soft amber fill behind an AI's receipt.
    static let amberSoft = pair(0xFFF1DC, 0x423014)

    /// The note itself: nearly white, and nearly native in the dark.
    #if os(iOS)
    static let page = pair(0xFFFEFD, 0x000000)
    #else
    static let page = pair(0xFFFEFD, 0x1F1E1D)
    #endif

    #if os(iOS)
    /// The folders' ground (the most warmth) and the notes list's (less). Pure black in the dark.
    static let foldersGround = pair(0xEFEBE9, 0x000000)
    static let listGround = pair(0xF2F0EE, 0x000000)
    /// A grouped row on either ground; in the dark the rows are where the warmth shows.
    static let row = pair(0xFDFCFB, 0x1F1C1A)
    #else
    /// Laid inside the sidebar's glass, so it keeps its vibrancy: about 5.5% toward the brown.
    static let sidebarWarmth = pair(brown, 0.055, brown, 0.10)
    /// The notes list: a little warmth, less than the sidebar.
    static let listGround = pair(0xFCFAF8, 0x252322)
    #endif

    // Sign-in.
    /// The email field: a warm off-white with a hairline.
    static let field = pair(0xFBF6EE, 0x2A241E)
    static let fieldHairline = pair(brown, 0.16, 0xFFDCAA, 0.14)
    /// Continue while it can't be pressed: near the field's tone.
    static let quietButton = pair(0xF2EAE0, 0x332B24)
    /// The website's low marker under "your AI".
    static let underline = pair(0xF0901A, 0.42, 0xF5A53A, 0.50)
    /// Dark ink on amber, readable in either appearance.
    static let onAmber = pair(0x2A1D10, 0x2A1D10)

    /// Tracking for display type (heavy and tight, as on the website) at `size`: about -0.03 em.
    static func tracking(_ size: CGFloat) -> CGFloat { -size * 0.03 }

    // MARK: Building colours

    static func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> PColor {
        PColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
               blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }

    static func pair(_ light: UInt32, _ dark: UInt32) -> PColor { pair(light, 1, dark, 1) }

    static func pair(_ light: UInt32, _ lightAlpha: CGFloat, _ dark: UInt32, _ darkAlpha: CGFloat) -> PColor {
        let l = rgb(light, lightAlpha), d = rgb(dark, darkAlpha)
        #if os(iOS)
        return UIColor { $0.userInterfaceStyle == .dark ? d : l }
        #else
        return NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? d : l }
        #endif
    }
}

extension Color {
    static let ink = Color(Palette.ink)
    static let muted = Color(Palette.muted)
    static let amberInk = Color(Palette.amberInk)
    static let amberSoft = Color(Palette.amberSoft)
    /// The note itself sits on a lighter page than the list and sidebar, like Apple Notes.
    static let notePage = Color(Palette.page)

    init(light: Color, dark: Color) {
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light) })
        #else
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
        #endif
    }
}

extension Font {
    /// The website's display type: heavy and tight. For the app's name, a note's title and
    /// iPhone's large titles only.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy) }
}
