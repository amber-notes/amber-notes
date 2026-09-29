import CoreGraphics
import Foundation

/// Lines named for App Store captures, tinted as if an AI had just changed them:
/// `-uitest -highlight "Saffron|Chorizo"` (their text, without the list marker).
enum ChangeHighlight {
    static let lines: Set<String> = {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-highlight"), i + 1 < args.count else { return [] }
        return Set(args[i + 1].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) })
    }()

    /// Whether this markdown line (a whole paragraph, marker included) is one of them.
    static func matches(_ paragraph: String) -> Bool {
        guard !lines.isEmpty else { return false }
        var text = paragraph.trimmingCharacters(in: .newlines)
        if let prefix = ListPrefix(line: text) { text = (text as NSString).substring(from: prefix.length) }
        return lines.contains(text.trimmingCharacters(in: .whitespaces))
    }
}

/// The lines an AI just changed in the open note, tinted amber behind the text: the tint
/// swells in, holds while you look, then fades. One per editor; its layout fragments ask it
/// whether their paragraph is one of the changed ones.
final class ChangeTint: @unchecked Sendable {
    /// Whole paragraphs (UTF-16, newline included) of the editor's text, in order.
    private(set) var ranges: [NSRange] = []
    /// 0 gone, 1 resting, a little over 1 while it arrives.
    private(set) var strength: CGFloat = 0
    /// Redraws these ranges (set by the text view).
    var redraw: ([NSRange]) -> Void = { _ in }
    private var run = 0

    /// Offscreen Mac recordings stretch time, so slow frame grabs still catch every step.
    nonisolated(unsafe) static var slowMotion: Double = 1

    /// How strongly to tint the paragraph starting at `offset`: 0 for not at all.
    func strength(at offset: Int) -> CGFloat {
        guard strength > 0 else { return 0 }
        return ranges.contains { NSLocationInRange(offset, $0) } ? strength : 0
    }

    /// Tints the paragraphs of `text` that `previous` didn't have, then fades them.
    @MainActor func play(from previous: String, to text: String, hold: Double = 2.6) {
        stop()
        ranges = Self.paragraphRanges(changedFrom: previous, to: text)
        guard !ranges.isEmpty else { return }
        let mine = run, lit = ranges
        let easeOut: @Sendable (Double) -> Double = { 1 - pow(1 - $0, 3) }
        let easeInOut: @Sendable (Double) -> Double = { $0 < 0.5 ? 4 * $0 * $0 * $0 : 1 - pow(-2 * $0 + 2, 3) / 2 }
        Task { @MainActor in
            guard await animate(to: 1.5, over: 0.3, easeOut, run: mine, lit: lit),
                  await animate(to: 1, over: 0.5, easeInOut, run: mine, lit: lit) else { return }
            try? await Task.sleep(for: .seconds(hold * Self.slowMotion))
            guard await animate(to: 0, over: 1.6, easeInOut, run: mine, lit: lit), mine == run else { return }
            ranges = []
        }
    }

    /// Steps the strength to `target` at 30 frames a second; false once another run took over.
    @MainActor private func animate(to target: CGFloat, over seconds: Double, _ curve: @Sendable (Double) -> Double, run mine: Int, lit: [NSRange]) async -> Bool {
        let fps = 30.0
        let n = max(1, Int(seconds * Self.slowMotion * fps))
        let from = strength
        for i in 1...n {
            guard mine == run else { return false }
            strength = from + (target - from) * CGFloat(curve(Double(i) / Double(n)))
            redraw(lit)
            try? await Task.sleep(for: .seconds(1 / fps))
        }
        return mine == run
    }

    /// Clears at once (you started typing, or undid the edit).
    @MainActor func stop() {
        run += 1
        guard strength > 0 || !ranges.isEmpty else { return }
        let lit = ranges
        strength = 0
        ranges = []
        redraw(lit)
    }

    /// Line numbers (0-based) of `new` that are added or rewritten compared with `old`. A line
    /// that only moved isn't one, and neither is a blank line.
    static func changedLines(from old: String, to new: String) -> [Int] {
        let a = old.components(separatedBy: "\n"), b = new.components(separatedBy: "\n")
        var out: [Int] = []
        for change in b.difference(from: a).inferringMoves() {
            guard case .insert(let offset, let line, let movedFrom) = change, movedFrom == nil else { continue }
            if !line.trimmingCharacters(in: .whitespaces).isEmpty { out.append(offset) }
        }
        return out.sorted()
    }

    /// The paragraphs of `new` (as ranges in it, newline included) that `changedLines` finds.
    static func paragraphRanges(changedFrom old: String, to new: String) -> [NSRange] {
        let changed = Set(changedLines(from: old, to: new))
        guard !changed.isEmpty else { return [] }
        let lines = new.components(separatedBy: "\n")
        var out: [NSRange] = []
        var at = 0
        for (i, line) in lines.enumerated() {
            let length = (line as NSString).length + (i < lines.count - 1 ? 1 : 0)
            if changed.contains(i) { out.append(NSRange(location: at, length: length)) }
            at += length
        }
        return out
    }
}
