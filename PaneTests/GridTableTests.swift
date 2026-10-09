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

    @Test func handleLabelsDescribeRowAndColumnOptions() {
        #expect(TableGridView.columnHandleLabel(header: "Hours", column: 0) == "Hours column options")
        #expect(TableGridView.columnHandleLabel(header: "", column: 1) == "Column 2 options")
        #expect(TableGridView.rowHandleLabel(row: 2) == "Row 3 options")
    }
}

/// A table straight from the Table button, and the edits its handles make (1.1.2 showed a new
/// table as one cell, and adding a column to it left markdown that was no longer a table).
@MainActor @Suite struct GridEditTests {
    /// A note with a table just inserted on its last, empty line.
    static func noteWithNewTable() -> String {
        let text = "Sunday paella\n\n"
        let (edit, _) = EditorCore().newGridEdit(text: text, selection: NSRange(location: (text as NSString).length, length: 0))
        return (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
    }

    static func table(_ text: String) throws -> GridTable { try #require(GridTable.find(in: text).first) }

    @Test func aNewTableIsTwoByTwo() throws {
        let text = Self.noteWithNewTable()
        #expect(try Self.table(text).rows == [["", ""], ["", ""]])
        // The editor's one-pass scan reads it the same way.
        #expect(NoteStructure(text).grids.map(\.rows) == [[["", ""], ["", ""]]])
    }

    @Test func addingAColumnToANewTableKeepsItATable() throws {
        var t = try Self.table(Self.noteWithNewTable())
        t.insertColumn(at: 1)
        #expect(t.markdown == "|   |   |   |\n| --- | --- | --- |\n|   |   |   |")
        #expect(try Self.table(t.markdown).rows == [["", "", ""], ["", "", ""]])
    }

    @Test func rowsAndColumnsComeAndGoOnAnEmptyTable() throws {
        var t = try Self.table(Self.noteWithNewTable())
        t.rows.insert(t.blankRow, at: 1)
        t = try Self.table(t.markdown)
        #expect(t.rows == [["", ""], ["", ""], ["", ""]])
        t.insertColumn(at: 0)
        t.insertColumn(at: 3)
        t = try Self.table(t.markdown)
        #expect(t.rows == Array(repeating: ["", "", "", ""], count: 3))
        t.removeColumn(at: 0)
        t.rows.remove(at: 2)
        t = try Self.table(t.markdown)
        #expect(t.rows == [["", "", ""], ["", "", ""]])
        // The last column stays.
        t.removeColumn(at: 0)
        t.removeColumn(at: 0)
        t.removeColumn(at: 0)
        #expect(try Self.table(t.markdown).rows == [[""], [""]])
    }

    @Test func rowsAndColumnsComeAndGoOnAFilledTable() throws {
        var t = try Self.table("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |")
        // An empty row between filled ones is still a row.
        #expect(t.rows == [["a", "b"], ["1", "2"], ["", ""], ["3", "4"]])
        t.insertColumn(at: 2)
        t = try Self.table(t.markdown)
        #expect(t.rows == [["a", "b", ""], ["1", "2", ""], ["", "", ""], ["3", "4", ""]])
        t.removeColumn(at: 0)
        t.rows.remove(at: 2)
        #expect(try Self.table(t.markdown).rows == [["b", ""], ["2", ""], ["4", ""]])
    }

    @Test func aTypedTableKeepsItsTypesThroughColumnEdits() throws {
        var t = try Self.table("<!-- pane-table: Date=date; Km=number -->\n| Date | Km |\n| --- | --- |\n| 2026-10-09 | 5 |")
        t.insertColumn(at: 1)
        #expect(try Self.table(t.markdown).types == [.date, .text, .number])
        t.removeColumn(at: 0)
        #expect(try Self.table(t.markdown).types == [.text, .number])
    }

    @Test func theDelimiterIsNeverMadeFromCellText() throws {
        var t = try Self.table(Self.noteWithNewTable())
        t.rows = [["—", "--"], ["-", "---"]]
        let lines = t.markdown.components(separatedBy: "\n")
        #expect(lines == ["| — | -- |", "| --- | --- |", "| - | --- |"])
        // Cells that look like a delimiter come back as cells.
        #expect(try Self.table(t.markdown).rows == t.rows)
    }

    /// What the bug saved: smart punctuation had turned the dashes under the header long.
    @Test func aDelimiterWithLongDashesStillOpensAndIsWrittenBackPlain() throws {
        let saved = "Sunday paella\n\n| Ingredient |   |\n| -— | — |\n\nAmount"
        var t = try Self.table(saved)
        #expect(t.rows == [["Ingredient", ""]])
        #expect(NoteStructure(saved).grids.map(\.rows) == [[["Ingredient", ""]]])
        #expect((saved as NSString).substring(with: t.range) == "| Ingredient |   |\n| -— | — |")
        t.rows[0][1] = "Amount"
        #expect(t.markdown == "| Ingredient | Amount |\n| --- | --- |")
        // A line of long dashes alone is no table.
        #expect(GridTable.find(in: "| a |\n| b — c |").isEmpty)
        #expect(GridTable.find(in: "— a |\n— | —").isEmpty)
    }

    /// Markdown can't hold the space at the end of a cell; the grid keeps it while you type.
    @Test func aSpaceTypedAtTheEndOfACellIsNotAChangeFromElsewhere() throws {
        var typed = try Self.table("| Place | Order |\n| --- | --- |\n| Ramiro | Seafood |")
        typed.rows[1][1] = "Seafood "
        let back = try Self.table(typed.markdown)
        #expect(back.rows[1][1] == "Seafood")
        #expect(typed.reads(as: back))
        var other = back
        other.rows[1][0] = "Cervejaria Ramiro"
        #expect(!typed.reads(as: other))
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
