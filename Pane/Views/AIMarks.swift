import SwiftUI

/// The app marks of the AIs people connect (from Simple Icons, as on the website).
struct AIGlyph: View {
    let ai: String
    var size: CGFloat = 16

    var body: some View {
        if let asset = Self.asset(ai) {
            Image(asset).resizable().scaledToFit().frame(width: size, height: size)
                .foregroundStyle(Self.color(ai))
                .accessibilityHidden(true)
        } else {
            Text("MCP").font(.system(size: size * 0.42, weight: .heavy)).foregroundStyle(.tint)
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }

    static func asset(_ ai: String) -> String? {
        switch ai {
        case "ChatGPT", "Codex": "AIGlyphOpenAI"
        case "Claude", "Claude Code": "AIGlyphClaude"
        default: nil
        }
    }

    static func color(_ ai: String) -> Color {
        switch ai {
        case "Claude", "Claude Code": Color(red: 0.851, green: 0.467, blue: 0.341)
        default: .primary
        }
    }
}

/// The glyph on a small white tile with a hairline and a soft shadow, like the website's AI strip.
struct AITile: View {
    let ai: String
    var size: CGFloat = 30

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        AIGlyph(ai: ai, size: size * 0.56)
            .frame(width: size, height: size)
            .background(Color.white, in: shape)
            .overlay(shape.strokeBorder(Color.black.opacity(0.08), lineWidth: 0.5))
            .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.10), radius: 3, y: 1.5)
            .environment(\.colorScheme, .light)
    }
}

/// "ChatGPT changed 5 lines", with Undo: shown on the open note when an AI's edit lands on it.
struct AIReceipt: View {
    let receipt: AIEdit.Receipt
    let undo: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            AIGlyph(ai: receipt.by, size: 14)
            Text(receipt.summary)
                .font(.system(size: Self.text, weight: .semibold))
                .foregroundStyle(Color.amberInk)
            Divider().frame(height: 14)
            Button("Undo", action: undo)
                .buttonStyle(.plain)
                .font(.system(size: Self.text, weight: .semibold))
                .foregroundStyle(Color.amberInk)
                .contentShape(.rect)
                .accessibilityHint("Puts the note back the way it was before \(receipt.by)'s edit")
        }
        .padding(.horizontal, 14)
        .frame(height: Self.height)
        .background(Color.amberSoft, in: .capsule)
        .overlay(Capsule().strokeBorder(Color.amberInk.opacity(0.22), lineWidth: 0.5))
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.12), radius: 12, y: 6)
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.08), radius: 2, y: 1)
        .accessibilityElement(children: .contain)
    }

    #if os(macOS)
    static let text: CGFloat = 12
    static let height: CGFloat = 30
    #else
    static let text: CGFloat = 15
    static let height: CGFloat = 40
    #endif
}

extension Color {
    /// The website's amber ink and soft amber fill, for things an AI did.
    static let amberInk = Color(light: Color(red: 0.66, green: 0.34, blue: 0), dark: Color(red: 0.96, green: 0.68, blue: 0.2))
    static let amberSoft = Color(light: Color(red: 1, green: 0.945, blue: 0.863), dark: Color(red: 0.26, green: 0.19, blue: 0.08))

    init(light: Color, dark: Color) {
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(dark) : NSColor(light) })
        #else
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
        #endif
    }
}
