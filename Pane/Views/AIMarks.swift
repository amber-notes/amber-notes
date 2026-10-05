import SwiftUI

/// The app marks of the AIs people connect (from Simple Icons, as on the website; Incredible's
/// from its own brand files).
struct AIGlyph: View {
    let ai: String
    var size: CGFloat = 16

    /// App Store captures (`-uitest -storeSafe`) show no other company's marks, only a neutral sparkle.
    static let storeSafe = ProcessInfo.processInfo.arguments.contains("-uitest") && ProcessInfo.processInfo.arguments.contains("-storeSafe")

    var body: some View {
        if ai == Self.page {
            // An edit made on a note's page (NotePage): the page's own mark.
            Image(systemName: NoteAppMark.symbol).resizable().scaledToFit().frame(width: size * 0.85, height: size * 0.85)
                .frame(width: size, height: size)
                .foregroundStyle(Color.amberInk)
                .accessibilityHidden(true)
        } else if Self.storeSafe {
            Image(systemName: "sparkle").resizable().scaledToFit().frame(width: size * 0.85, height: size * 0.85)
                .frame(width: size, height: size)
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
        } else if let asset = Self.asset(ai) {
            Image(asset).resizable().scaledToFit().frame(width: size, height: size)
                .foregroundStyle(Self.color(ai))
                .accessibilityHidden(true)
        } else {
            // Any other app: a plain glyph that fits any size (text would be cut short in a small tile).
            Image(systemName: "link").resizable().scaledToFit().frame(width: size * 0.8, height: size * 0.8)
                .frame(width: size, height: size)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
    }

    /// Who made an edit on a note's page.
    static let page = "App"

    static func asset(_ ai: String) -> String? {
        switch ai {
        case "ChatGPT", "Codex": "AIGlyphOpenAI"
        case "Claude", "Claude Code": "AIGlyphClaude"
        case "Incredible": "AIGlyphIncredible"
        default: nil
        }
    }

    static func color(_ ai: String) -> Color {
        switch ai {
        case "Claude", "Claude Code": Color(red: 0.851, green: 0.467, blue: 0.341)
        case "Incredible": Color(red: 1, green: 0.435, blue: 0.129) // #FF6F21, Incredible's mark
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

    /// Rises in from the bottom edge; with Reduce Motion it only fades.
    static func slides(reduceMotion: Bool) -> Bool { !reduceMotion }

    static func transition(reduceMotion: Bool) -> AnyTransition {
        guard slides(reduceMotion: reduceMotion) else { return .opacity }
        return .asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.96, anchor: .bottom)),
                           removal: .opacity.combined(with: .offset(y: 6)))
    }

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

/// The mark of a note that is also an app (it has a page; see NotePage): in the note list and search
/// results, on its toggle, and on a sub-note's link. Two designs: an amber mark after the title (picked)
/// or, with `-appMark detail`, a small grey glyph beside the date.
enum NoteAppMark {
    static let symbol = "square.grid.2x2"
    enum Style { case detail, title }
    nonisolated(unsafe) static var style: Style = Capture.argument("-appMark") == "detail" ? .detail : .title

    @MainActor static func has(_ note: Note) -> Bool { !note.isLocked && NotePageStore.shared[note.id] != nil }
}
