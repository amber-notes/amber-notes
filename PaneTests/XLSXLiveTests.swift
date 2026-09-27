import Foundation
import Testing
@testable import Pane

/// Opt-in: reports only the schema inferred from a real spreadsheet ($PANE_LIVE_XLSX).
@Suite struct XLSXLiveTests {
    @Test func inferredSchema() throws {
        let env = ProcessInfo.processInfo.environment
        guard let path = env["PANE_LIVE_XLSX"], let out = env["PANE_LIVE_OUT"] else { return }
        let url = URL(fileURLWithPath: path)
        let clock = ContinuousClock()
        var sheet: XLSXImporter.Sheet?
        let read = try clock.measure { sheet = try XLSXImporter.readFirstSheet(url) }
        var t: TypedTable!
        let all = try clock.measure { t = try XLSXImporter.table(from: url).table }
        _ = sheet
        let report = t.columns.map { "\($0.name) = \($0.type.spec)" }.joined(separator: "\n") + "\nrows kept: \(t.rows.count)\nread: \(read)\ntotal: \(all)"
        try report.write(toFile: out, atomically: true, encoding: .utf8)
    }
}
