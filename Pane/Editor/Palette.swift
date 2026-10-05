import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Amber Notes' warm grey: a hint of the icon's brown (#8A4A1C) in the greys themselves, never a
/// layer over them. The sidebar takes the most, the list less, and the note page almost none.
/// On iPhone in dark mode the grounds stay pure black beside the Dynamic Island; only rows warm.
/// Always grey with a hint of warmth, never brown: dark surfaces lean 2–3% at most.
/// Compiled into the share extension too (with Platform.swift), so nothing here reaches app code.
enum Palette {
    /// The brown the greys lean toward.
    static let brown: UInt32 = 0x8A4A1C

    // Ink and muted text: the website's warm brown in the light; in the dark, warm greys (the
    // website's cream and tan read brown on the app's grey window).
    static let ink = pair(0x2A1D10, 0xF6EFE7)
    static let muted = pair(0x74604C, 0xBCB0A3)

    /// The deeper amber: accent, links and an AI's tint (AccentColor.colorset holds the same).
    static let amber = pair(0xD96A06, 0xF4AD33)
    /// The fill of amber primary buttons, in light and dark alike: the deeper amber, so their
    /// white label stays readable (the dark-mode amber is too light under white).
    static let amberButton = pair(0xD96A06, 0xD96A06)
    /// A primary button that can't be pressed yet: a quiet warm grey with muted text, not a faded
    /// amber, so it reads as "not yet" rather than as broken.
    static let disabledButton = pair(brown, 0.13, 0xFFFFFF, 0.11)
    static let disabledButtonLabel = pair(0x6A5743, 0xB0A498)
    /// The fill of destructive primary buttons (Start fresh), in light and dark alike: a red deep
    /// enough for the same white label.
    static let destructiveButton = pair(0xC62828, 0xC62828)
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
    static let row = pair(0xFDFCFB, 0x1F1E1D)
    #else
    /// Laid inside the sidebar's glass, so it keeps its vibrancy: about 5.5% toward the brown
    /// (5% in the dark, where more reads as brown).
    static let sidebarWarmth = pair(brown, 0.055, brown, 0.05)
    /// The notes list: a little warmth, less than the sidebar.
    static let listGround = pair(0xFCFAF8, 0x252423)
    #endif

    // Sign-in.
    /// The email field: white with a warm border on the cream ground, so it reads as a field at a
    /// glance; in the dark, a lighter translucent fill with a border of its own.
    static let field = pair(0xFFFFFF, 1, 0xFFFAF5, 0.10)
    static let fieldHairline = pair(brown, 0.30, 0xFFFFFF, 0.22)
    /// A field's placeholder: the muted text, dimmed, still about 4:1 on the field.
    static let placeholder = pair(0x74604C, 0.85, 0xBCB0A3, 0.80)
    /// The website's low marker under "your AI".
    static let underline = pair(0xF0901A, 0.42, 0xF5A53A, 0.50)

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
