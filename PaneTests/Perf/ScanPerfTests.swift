import Foundation
import Testing
@testable import Pane

@MainActor @Suite struct ScanPerfTests {
    @Test func wholeNoteScans() {
        let text = PerfFixtures.longNote()
        let ns = text as NSString
        let clock = ContinuousClock()
        func t(_ name: String, _ f: () -> Void) {
            let d = clock.measure { for _ in 0..<5 { f() } }
            print("PERF scan \(name): \(Double(d.components.attoseconds) / 5e15 + Double(d.components.seconds) * 200) ms")
        }
        t("GridTable.find") { _ = GridTable.find(in: text) }
        t("LineEmbed.find") { _ = LineEmbed.find(in: text) }
        t("CodeRanges.find") { _ = CodeRanges.find(in: text) }
        t("EditorBlock.find") { _ = EditorBlock.find(in: text) }
        t("fenceCount") { _ = EditorCore.fenceCount(ns) }
        t("titleLocation") { _ = MarkdownStyler.titleLocation(ns) }

    }
}

@Suite struct NoteStructureTests {
    @Test func matchesTheSeparateFinders() {
        for text in [PerfFixtures.longNote(lines: 400), PerfFixtures.blockyNote(), GridTableTestsSource.source,
                     "| x |\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\n| not | table |\n| --- | --- |\nhttps://in.code\n```\nhttps://out.side\n"] {
            let s = NoteStructure(text)
            #expect(s.grids == GridTable.find(in: text))
            let code = CodeRanges.find(in: text)
            let embeds = LineEmbed.find(in: text).filter { e in !code.contains { NSIntersectionRange($0, e.range).length > 0 } }
            #expect(s.embeds.map(\.range) == embeds.map(\.range))
            #expect(s.code == code)
        }
    }
}

enum GridTableTestsSource {
    static let source = """
    Tracker

    <!-- pane-table: Date=date; Energy=scale 1-10; Diet=choice Yes|No|N/A -->
    | Date | Energy | Diet |
    | --- | --- | --- |
    | 2026-09-27 | 8 | Yes |

    | a | b |
    | --- | --- |
    | 1 | 2 |
    """
}
