import Observation
import SwiftData
import SwiftUI

/// Design upgrades taken from the website, behind `-designStudy` so the same build shows before and after.
///
/// What's faked: the server doesn't yet say which AI changed a note (only that one did, as a daily
/// count), so the edits here come from `DesignStudy.fakeAIEdit`, not from sync.
enum DesignStudy {
    nonisolated(unsafe) static var on = ProcessInfo.processInfo.arguments.contains("-designStudy")
    /// Offscreen Mac recordings stretch time so slow frame grabs still catch every step; the video is sped back up.
    nonisolated(unsafe) static var slowMotion: Double = 1

    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// What an AI might do to a demo note, as the website's demo tells it.
    static func edited(_ body: String, scene: String) -> String {
        switch scene {
        case "paella":
            return body.replacingOccurrences(of: "- [ ] Oat milk", with: "- [ ] Paella rice\n- [ ] Saffron\n- [ ] Chorizo\n- [ ] Chicken thighs\n- [ ] Smoked paprika\n- [ ] Oat milk")
        case "lisbon":
            return body.replacingOccurrences(of: "- [ ] Day trip to Sintra", with: "- [ ] Day trip to Sintra\n- [ ] Late checkout requested, confirm by 10 May")
        default:
            return body
        }
    }

    /// Stands in for a sync that delivers an AI's edit: the note changes and is marked as the AI's.
    @MainActor static func fakeAIEdit(_ context: ModelContext, title: String, scene: String, by ai: String) {
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        guard let note = notes.first(where: { $0.title == title && $0.deletedAt == nil }) else { return }
        let old = note.body
        let new = edited(old, scene: scene)
        guard new != old else { return }
        note.body = new
        note.updatedAt = .now
        AIEdits.shared.record(note.id, from: old, to: new, by: ai)
    }

    /// `-designStudy -aiEdit Groceries -aiScene paella -aiBy ChatGPT -aiAfter 2.5`: plays an AI edit after launch.
    @MainActor static func scheduleFromArguments(_ context: ModelContext) {
        // Captures play it without the study too, to show today's behaviour.
        guard on || ProcessInfo.processInfo.arguments.contains("-uitest"), let title = argument("-aiEdit") else { return }
        let delay = argument("-aiAfter").flatMap(Double.init) ?? 2.5
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            fakeAIEdit(context, title: title, scene: argument("-aiScene") ?? "paella", by: argument("-aiBy") ?? "ChatGPT")
        }
    }
}

/// Notes an AI changed that you haven't looked at yet, and what it changed.
@MainActor
@Observable
final class AIEdits {
    static let shared = AIEdits()

    struct Mark: Equatable {
        var by: String
        var at: Date
        var lines: Set<String>
        /// The note before the AI's edit, for Undo.
        var previous: String
        var seen = false
    }

    private(set) var marks: [UUID: Mark] = [:]

    func record(_ id: UUID, from old: String, to new: String, by ai: String) {
        marks[id] = Mark(by: ai, at: .now, lines: ChangeHighlight.changedLines(from: old, to: new), previous: old)
    }

    func unseen(_ id: UUID) -> Mark? { marks[id].flatMap { $0.seen ? nil : $0 } }

    func markSeen(_ id: UUID) { marks[id]?.seen = true }

    /// Puts the note back the way it was before the AI's edit.
    func undo(_ note: Note) {
        guard let m = marks[note.id] else { return }
        note.body = m.previous
        note.touch()
        marks[note.id] = nil
        ChangeHighlight.live = []
        NotificationCenter.default.post(name: ChangeHighlight.changed, object: nil)
    }
}

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

/// "Updated by ChatGPT", with Undo: shown on the open note when an AI's edit lands on it.
struct AIReceipt: View {
    let mark: AIEdits.Mark
    let undo: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            AIGlyph(ai: mark.by, size: 14)
            Text(summary)
                .font(.system(size: Self.text, weight: .semibold))
                .foregroundStyle(Color.amberInk)
            Divider().frame(height: 14)
            Button("Undo", action: undo)
                .buttonStyle(.plain)
                .font(.system(size: Self.text, weight: .semibold))
                .foregroundStyle(Color.amberInk)
                .contentShape(.rect)
                .accessibilityHint("Puts the note back the way it was before \(mark.by)'s edit")
        }
        .padding(.horizontal, 14)
        .frame(height: Self.height)
        .background(Color.amberSoft, in: .capsule)
        .overlay(Capsule().strokeBorder(Color.amberInk.opacity(0.22), lineWidth: 0.5))
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.12), radius: 12, y: 6)
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.08), radius: 2, y: 1)
        .accessibilityElement(children: .contain)
    }

    private var summary: String {
        let n = mark.lines.count
        return n == 0 ? "Updated by \(mark.by)" : "\(mark.by) changed \(n == 1 ? "1 line" : "\(n) lines")"
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
