import Foundation
import Testing
@testable import Pane

@Suite struct GridTableTests {
    let source = """
    Tracker

    <!-- pane-table: Date=date; Energy=scale 1-10; Diet=choice Yes|No|N/A -->
    | Date | Energy | Diet |
    | --- | --- | --- |
    | 2026-09-27 | 8 | Yes |

    | a | b |
    | --- | --- |
    | 1 | 2 |
    """

    @Test func findsTypedAndPlainTablesInOrder() throws {
        let all = GridTable.find(in: source)
        #expect(all.count == 2)
        #expect(all.map(\.index) == [0, 1])
        #expect(all[0].types == [.date, .scale(1, 10), .choice(["Yes", "No", "N/A"])])
        #expect(all[1].types == nil)
        // A typed table's range starts at its comment, so an edit replaces both.
        #expect((source as NSString).substring(with: all[0].range).hasPrefix("<!-- pane-table:"))
    }

    @Test func typedMarkdownKeepsTheSchema() throws {
        var t = try #require(GridTable.find(in: source).first)
        t.rows[1][2] = "No"
        let again = try #require(GridTable.find(in: t.markdown).first)
        #expect(again.types == t.types)
        #expect(again.rows == t.rows)
        #expect(try #require(TypedTable.find(in: t.markdown).first).rows[0] == ["2026-09-27", "8", "No"])
    }

    @Test func plainTablesStayPlain() throws {
        let t = GridTable.find(in: source)[1]
        #expect(!t.markdown.contains("pane-table"))
    }

    @Test func newRowsGetTodaysDate() throws {
        let t = try #require(GridTable.find(in: source).first)
        #expect(t.blankRow == [TypedTable.day(.now), "", ""])
    }

    @Test func settingATypeOnAPlainTableAddsTheComment() throws {
        var t = GridTable.find(in: source)[1]
        t.types = [.text, .choice(["Yes", "No"])]
        #expect(t.markdown.hasPrefix("<!-- pane-table: a=text; b=choice Yes|No -->"))
    }
}

/// Column widths on a narrow screen (TestFlight 1.1.1 cut the Running log's fourth column on iPhone).
@Suite struct GridColumnWidthTests {
    static let runningLog = GridTable(rows: [["Date", "Distance km", "Minutes", "Feel"], ["2026-09-22", "5", "27", "4"], ["2026-09-24", "7.5", "42", "3"]],
                                      range: NSRange(location: 0, length: 0), index: 0)

    @Test func aFourColumnLogFitsAnIPhone() {
        let font = PFont.systemFont(ofSize: EditorMetrics.body)
        let text = (0..<4).map { c in ceil(Self.runningLog.rows.map { ($0[c] as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0) }
        let roomy = text.map { min(max($0 + 24, 64), 280) }.reduce(0, +)
        let tight = text.map { max($0 + 16, 44) }.reduce(0, +)
        // A screen narrower than the roomy widths but wide enough for the text (an iPhone).
        let available = (roomy + tight) / 2
        let widths = Self.runningLog.columnWidths(available: available)
        #expect(abs(widths.reduce(0, +) - available) < 0.5, "fits exactly: \(widths)")
        for (c, w) in widths.enumerated() {
            #expect(w >= text[c] + 16 - 0.01, "column \(c) keeps its text whole")
        }
    }

    @Test func aWideTableStillScrolls() {
        let wide = GridTable(rows: [(0..<8).map { "Column number \($0)" }], range: NSRange(location: 0, length: 0), index: 0)
        #expect(wide.columnWidths(available: 340).reduce(0, +) > 340)
    }

    @Test func aNarrowTableStretches() {
        let widths = GridTable(rows: [["A", "B"]], range: NSRange(location: 0, length: 0), index: 0).columnWidths(available: 340)
        #expect(abs(widths.reduce(0, +) - 340) < 0.5)
    }
}
