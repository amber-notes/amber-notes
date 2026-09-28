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
