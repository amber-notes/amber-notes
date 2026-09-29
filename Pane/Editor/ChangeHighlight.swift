import CoreGraphics
import Foundation

/// Lines an AI connection just changed, tinted in amber behind the text.
///
/// App Store captures name the lines: `-uitest -highlight "Saffron|Chorizo"` (their text,
/// without the list marker). With `-designStudy`, an AI edit that lands on the open note tints
/// the lines it changed: the tint swells in, holds while you look, then fades away.
enum ChangeHighlight {
    static let lines: Set<String> = {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-highlight"), i + 1 < args.count else { return [] }
        return Set(args[i + 1].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) })
    }()

    /// Design study: the lines tinted right now, and how strongly (0 gone, 1 resting, a little over 1 while arriving).
    nonisolated(unsafe) static var live: Set<String> = []
    nonisolated(unsafe) static var strength: CGFloat = 0
    /// Text views redraw their tint when this is posted.
    static let changed = Notification.Name("pane.changeHighlight")

    /// A line's text without its list marker, the way lines are matched.
    static func key(_ paragraph: String) -> String {
        var text = paragraph.trimmingCharacters(in: .newlines)
        if let prefix = ListPrefix(line: text) { text = (text as NSString).substring(from: prefix.length) }
        return text.trimmingCharacters(in: .whitespaces)
    }

    /// Whether this markdown line (a whole paragraph, marker included) is one of them.
    static func matches(_ paragraph: String) -> Bool { tint(for: paragraph) > 0 }

    /// How strongly to tint this line: 0 for not at all.
    static func tint(for paragraph: String) -> CGFloat {
        guard !lines.isEmpty || (!live.isEmpty && strength > 0) else { return 0 }
        let k = key(paragraph)
        if lines.contains(k) { return 1 }
        return live.contains(k) ? strength : 0
    }

    /// The lines of `new` that aren't in `old`: added, rewritten or ticked off.
    static func changedLines(from old: String, to new: String) -> Set<String> {
        let a = old.components(separatedBy: "\n"), b = new.components(separatedBy: "\n")
        let before = Set(a)
        var out: Set<String> = []
        for change in b.difference(from: a) {
            // A line that only moved keeps its text, so a reordered list doesn't light up.
            if case .insert(_, let line, _) = change, !before.contains(line) {
                let k = key(line)
                if !k.isEmpty { out.insert(k) }
            }
        }
        return out
    }

    nonisolated(unsafe) private static var run = 0

    /// Swells in (a small pulse past resting), holds for `hold` seconds, then fades out.
    @MainActor static func play(_ changed: Set<String>, hold: Double = 2.6) {
        run += 1
        let mine = run
        live = changed
        strength = 0
        Task { @MainActor in
            let fps = 30.0
            func step(to target: CGFloat, over seconds: Double, _ curve: @Sendable (Double) -> Double) async -> Bool {
                let from = strength
                let n = max(1, Int(seconds * fps))
                for i in 1...n {
                    guard mine == run else { return false }
                    strength = from + (target - from) * CGFloat(curve(Double(i) / Double(n)))
                    NotificationCenter.default.post(name: Self.changed, object: nil)
                    try? await Task.sleep(for: .seconds(1 / fps))
                }
                return true
            }
            let easeOut: @Sendable (Double) -> Double = { 1 - pow(1 - $0, 3) }
            let easeInOut: @Sendable (Double) -> Double = { $0 < 0.5 ? 4 * $0 * $0 * $0 : 1 - pow(-2 * $0 + 2, 3) / 2 }
            guard await step(to: 1.5, over: 0.3, easeOut), await step(to: 1, over: 0.5, easeInOut) else { return }
            try? await Task.sleep(for: .seconds(hold))
            guard mine == run, await step(to: 0, over: 1.6, easeInOut) else { return }
            live = []
            NotificationCenter.default.post(name: Self.changed, object: nil)
        }
    }
}
