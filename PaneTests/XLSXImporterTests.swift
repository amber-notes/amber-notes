import Foundation
import Testing
@testable import Pane

@Suite struct XLSXImporterTests {
    var fixture: URL {
        Bundle(for: Marker.self).url(forResource: "tracker-sample", withExtension: "xlsx")!
    }

    @Test func infersTypesFromHeadersDropdownsAndDates() throws {
        let cutoff = TypedTable.date(from: "2026-09-24")!
        let (title, t) = try XLSXImporter.table(from: fixture, keepRowsUntil: cutoff)
        #expect(title == "Tracker-sample")
        #expect(t.columns.map(\.name) == ["Date", "Day", "Work hours", "Energy (1-10)", "Mood (1-10)", "Diet on plan", "Strength", "What helped today?"])
        #expect(t.columns[0].type == .date)
        #expect(t.columns[2].type == .number)
        #expect(t.columns[3].type == .scale(1, 10))
        #expect(t.columns[5].type == .choice(["Yes", "No"]))
        #expect(t.columns[6].type == .choice(["Yes", "No", "N/A"]))
        #expect(t.columns[7].type == .text)
        // Rows up to the cutoff only; dates as local days.
        #expect(t.rows.map { $0[0] } == ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"])
        #expect(t.rows[0] == ["2026-09-20", "Sunday", "5", "6", "7", "Yes", "Yes", "Walk"])
    }

    @Test func readsNamespacePrefixedFiles() throws {
        let url = Bundle(for: Marker.self).url(forResource: "tracker-prefixed", withExtension: "xlsx")!
        let (_, t) = try XLSXImporter.table(from: url, keepRowsUntil: TypedTable.date(from: "2026-09-24")!)
        #expect(t.columns.count == 8)
        #expect(t.columns[6].type == .choice(["Yes", "No", "N/A"]))
        #expect(t.rows.count == 5)
    }

    @Test func producesMarkdownThatParsesBack() throws {
        let (_, t) = try XLSXImporter.table(from: fixture, keepRowsUntil: nil)
        let again = try #require(TypedTable.find(in: "Tracker\n\n" + t.markdown).first)
        #expect(again.columns == t.columns)
        #expect(again.rows.count == t.rows.count)
    }
}

private final class Marker {}
