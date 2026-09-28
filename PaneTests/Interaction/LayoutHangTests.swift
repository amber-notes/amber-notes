#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// Replays of edits that once hung TextKit's layout.
@MainActor @Suite(.serialized) struct LayoutHangTests {
    /// Fixtures come from the test bundle, never from the source folder.
    static func fixture(_ name: String) -> String {
        let parts = name.split(separator: ".")
        guard let url = Bundle(for: FixtureToken.self).url(forResource: String(parts[0]), withExtension: String(parts[1])) else { return "" }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["AMBER_REPLAY"] != nil)) func fuzzSeed2026Step159() async {
        let text = Self.fixture("hang-2026.txt")
        #expect(!text.isEmpty)
        let h = await EditorHarness(text)
        defer { h.close() }
        await h.select(2535)
        h.view.scrollRangeToVisible(NSRange(location: 2535, length: 0))
        h.window.displayIfNeeded()
        print("HANG before delete")
        h.view.insertText("", replacementRange: NSRange(location: 1103, length: 28))
        print("HANG after delete, before display")
        h.window.displayIfNeeded()
        await h.settle(0.2)
        h.window.displayIfNeeded()
        print("HANG displayed")
    }
}
private final class FixtureToken {}
#endif

#if os(macOS)
extension LayoutHangTests {
    /// Replays the fuzz run that hung, dumping every paragraph's line metrics first.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["AMBER_REPLAY"] != nil)) func replaySeed2026() async {
        let out = EditorHarness.shotsDirectory.appending(path: "hang-dump.txt")
        await IncrementalStyleTests().fuzz(seed: 2026, steps: 160, inspect: 159) { h in
            var lines: [String] = []
            let s = h.view.textStorage!
            let ns = s.string as NSString
            ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, e, _ in
                let p = s.attribute(.paragraphStyle, at: e.location, effectiveRange: nil) as? NSParagraphStyle
                let f = e.length > 0 ? (s.attribute(.font, at: e.location, effectiveRange: nil) as? NSFont)?.pointSize ?? -1 : -1
                var kerns: [CGFloat] = []
                s.enumerateAttribute(.kern, in: e) { v, _, _ in if let k = v as? CGFloat { kerns.append(k) } else if let k = v as? NSNumber { kerns.append(CGFloat(k.doubleValue)) } }
                let bad = kerns.filter { !$0.isFinite || abs($0) > 2000 }
                lines.append("\(bad.isEmpty ? "" : "BADKERN \(bad) ")kmax \(kerns.map(abs).max() ?? 0) \(r.location)+\(r.length) min \(p?.minimumLineHeight ?? -1) max \(p?.maximumLineHeight ?? -1) sp \(p?.paragraphSpacing ?? -1)/\(p?.paragraphSpacingBefore ?? -1) font \(f) | \(ns.substring(with: r).prefix(60))")
            }
            try? FileManager.default.createDirectory(at: EditorHarness.shotsDirectory, withIntermediateDirectories: true)
            try? lines.joined(separator: "\n").write(to: out, atomically: true, encoding: .utf8)
        }
    }
}
#endif

#if os(macOS)
extension LayoutHangTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["AMBER_REPLAY"] != nil)) func replaySeed2026AlwaysFull() async {
        await IncrementalStyleTests().fuzz(seed: 2026, steps: 170, alwaysFull: true)
        print("HANG full-restyle replay finished")
    }
}
#endif

#if os(macOS)
extension LayoutHangTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["AMBER_REPLAY"] != nil)) func sweepScrollOffsets() async {
        let text = Self.fixture("hang-2026.txt")
        for y in stride(from: 0, through: 2400, by: 200) {
            let h = await EditorHarness(text, height: 600)
            await h.select(2535)
            h.scroll.contentView.scroll(to: NSPoint(x: 0, y: CGFloat(y)))
            h.scroll.reflectScrolledClipView(h.scroll.contentView)
            FileHandle.standardError.write("HANG sweep y=\(y) before\n".data(using: .utf8)!)
            h.view.insertText("", replacementRange: NSRange(location: 1103, length: 28))
            h.window.displayIfNeeded()
            await h.settle(0.05)
            h.window.displayIfNeeded()
            FileHandle.standardError.write("HANG sweep y=\(y) ok\n".data(using: .utf8)!)
            h.close()
        }
    }
}
#endif

#if os(macOS)
extension LayoutHangTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["AMBER_REPLAY"] != nil)) func replaySeed2026EnsureLayout() async {
        await IncrementalStyleTests().fuzz(seed: 2026, steps: 170, inspect: 159) { h in
            if let tlm = h.view.textLayoutManager { tlm.ensureLayout(for: tlm.documentRange) }
            FileHandle.standardError.write("HANG ensured layout at 159\n".data(using: .utf8)!)
        }
        FileHandle.standardError.write("HANG ensure-layout replay finished\n".data(using: .utf8)!)
    }
}
#endif
