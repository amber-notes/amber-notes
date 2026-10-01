import Foundation
import Testing
@testable import Pane

@Suite struct TypedTableTests {
    let source = """
    Evening tracker

    <!-- pane-table: Date=date; Energy (1-10)=scale 1-10; Diet=choice Yes|No|N/A; Hours=number; Notes=text -->
    | Date | Energy (1-10) | Diet | Hours | Notes |
    | --- | --- | --- | --- | --- |
    | 2026-09-26 | 6 | No | 5 | Tired \\| slow |
    | 2026-09-27 | 8 | Yes | 7.5 |  |

    after
    """

    @Test func parsesSchemaAndRows() throws {
        let t = try #require(TypedTable.find(in: source).first)
        #expect(t.columns.map(\.name) == ["Date", "Energy (1-10)", "Diet", "Hours", "Notes"])
        #expect(t.columns[1].type == .scale(1, 10))
        #expect(t.columns[2].type == .choice(["Yes", "No", "N/A"]))
        #expect(t.rows.count == 2)
        #expect(t.rows[0][4] == "Tired | slow")
        #expect(t.rows[1][4] == "")
        #expect((source as NSString).substring(with: t.range).hasPrefix("<!-- pane-table"))
        #expect((source as NSString).substring(with: t.range).hasSuffix("|  |"))
    }

    @Test func roundTripsMarkdown() throws {
        let t = try #require(TypedTable.find(in: source).first)
        let again = try #require(TypedTable.find(in: t.markdown).first)
        #expect(again.columns == t.columns)
        #expect(again.rows == t.rows)
    }

    @Test func summarisesRecentRows() throws {
        let t = try #require(TypedTable.find(in: source).first)
        let s = Dictionary(uniqueKeysWithValues: t.summary())
        #expect(s["Energy"] == "7")
        #expect(s["Diet"] == "1/2")
        #expect(s["Hours"] == TypedTable.format(6.25))
        #expect(TypedTable.format(6.25).contains("3"))
    }

    @Test func blankRowHasToday() throws {
        let t = try #require(TypedTable.find(in: source).first)
        let day = TypedTable.date(from: "2026-10-01")!.addingTimeInterval(23 * 3600 + 50 * 60) // 23:50 local
        #expect(t.blankRow(today: day)[0] == "2026-10-01")
        #expect(t.rowIndex(for: TypedTable.date(from: "2026-09-27")!) == 1)
    }

    @Test func ignoresPlainTables() {
        #expect(TypedTable.find(in: "| a | b |\n| --- | --- |\n| 1 | 2 |").isEmpty)
    }
}

/// Note previews in the list (TestFlight 1.1.1 showed `<!-- pane-table: Date=date; …`).
@Suite struct ListPreviewTests {
    @Test func aTablesColumnTypesNeverShow() {
        let body = "Running log\n\n<!-- pane-table: Date=date; Distance km=number; Minutes=number -->\n| Date | Distance km | Minutes |\n|---|---|---|\n| 2026-09-30 | 5 | 28 |"
        #expect(NoteText.title(of: body) == "Running log")
        #expect(NoteText.preview(of: body) == "Date  Distance km  Minutes")
        #expect(NoteHead.of(body).preview == "Date  Distance km  Minutes")
    }

    @Test func commentsAreLeftOutLikeTheServer() {
        #expect(NoteText.title(of: "<!-- hidden -->\nTitle") == "Title")
        #expect(NoteText.title(of: "Before <!-- note -->after") == "Before after")
        #expect(NoteText.preview(of: "Title\n<!-- an open comment") == "No additional text")
    }
}
