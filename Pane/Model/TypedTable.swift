import Foundation

/// A markdown table with typed columns, declared by a comment right above it:
///
///     <!-- pane-table: Date=date; Energy=scale 1-10; Diet=choice Yes|No|N/A; Notes=text -->
///     | Date | Energy | Diet | Notes |
///     | --- | --- | --- | --- |
///     | 2026-09-27 | 7 | Yes | Good day |
///
/// The markdown stays the source of truth, so any editor or AI can read and write it.
struct TypedTable: Equatable {
    enum ColumnType: Equatable {
        case text
        case number
        case date
        case scale(Int, Int)
        case choice([String])

        var spec: String {
            switch self {
            case .text: "text"
            case .number: "number"
            case .date: "date"
            case .scale(let a, let b): "scale \(a)-\(b)"
            case .choice(let o): "choice " + o.joined(separator: "|")
            }
        }

        static func parse(_ s: String) -> ColumnType {
            let t = s.trimmingCharacters(in: .whitespaces)
            let lower = t.lowercased()
            if lower == "number" { return .number }
            if lower == "date" { return .date }
            if lower.hasPrefix("scale"), let r = t.range(of: #"(\d+)\s*-\s*(\d+)"#, options: .regularExpression) {
                let nums = t[r].split(separator: "-").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
                if nums.count == 2 { return .scale(nums[0], nums[1]) }
            }
            if lower.hasPrefix("choice") {
                let opts = t.dropFirst(6).split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                if !opts.isEmpty { return .choice(opts) }
            }
            return .text
        }
    }

    struct Column: Equatable {
        var name: String
        var type: ColumnType
    }

    var columns: [Column]
    /// Cell text, row-major; always `columns.count` wide.
    var rows: [[String]]

    /// Where it lives in the note: from the schema comment to the last row.
    var range: NSRange = NSRange(location: 0, length: 0)
    var index: Int = 0

    static let marker = "pane-table:"

    // MARK: Parsing

    static func find(in text: String) -> [TypedTable] {
        let ns = text as NSString
        var lines: [NSRange] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in lines.append(r) }
        var out: [TypedTable] = []
        var i = 0
        while i < lines.count {
            let line = ns.substring(with: lines[i]).trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("<!--"), line.hasSuffix("-->"), line.contains(marker) else { i += 1; continue }
            var j = i + 1
            var tableLines: [String] = []
            while j < lines.count {
                let l = ns.substring(with: lines[j]).trimmingCharacters(in: .whitespaces)
                guard l.hasPrefix("|") else { break }
                tableLines.append(l)
                j += 1
            }
            if tableLines.count >= 2, var t = parse(comment: line, table: tableLines) {
                t.range = NSRange(location: lines[i].location, length: NSMaxRange(lines[j - 1]) - lines[i].location)
                t.index = out.count
                out.append(t)
            }
            i = max(j, i + 1)
        }
        return out
    }

    static func parse(comment: String, table: [String]) -> TypedTable? {
        guard let m = comment.range(of: marker) else { return nil }
        var spec = String(comment[m.upperBound...])
        if let end = spec.range(of: "-->") { spec = String(spec[..<end.lowerBound]) }
        var types: [String: ColumnType] = [:]
        for part in spec.split(separator: ";") {
            let kv = part.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if kv.count == 2 { types[kv[0].lowercased()] = ColumnType.parse(kv[1]) }
        }
        let header = cells(table[0])
        guard !header.isEmpty else { return nil }
        let columns = header.map { Column(name: $0, type: types[$0.lowercased()] ?? .text) }
        let body = table.dropFirst().filter { !$0.allSatisfy { "|-: ".contains($0) } }
        let rows = body.map { line -> [String] in
            var c = cells(line)
            if c.count < columns.count { c += Array(repeating: "", count: columns.count - c.count) }
            return Array(c.prefix(columns.count))
        }
        return TypedTable(columns: columns, rows: rows)
    }

    static func cells(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") && !s.hasSuffix("\\|") { s.removeLast() }
        var out: [String] = []
        var cur = ""
        var escape = false
        for ch in s {
            if escape { cur.append(ch); escape = false; continue }
            if ch == "\\" { escape = true; cur.append(ch); continue }
            if ch == "|" { out.append(cur); cur = ""; continue }
            cur.append(ch)
        }
        out.append(cur)
        return out.map { $0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\\|", with: "|") }
    }

    // MARK: Writing

    var markdown: String {
        let comment = "<!-- \(Self.marker) " + columns.map { "\($0.name)=\($0.type.spec)" }.joined(separator: "; ") + " -->"
        func row(_ c: [String]) -> String {
            "| " + c.map { $0.isEmpty ? " " : $0.replacingOccurrences(of: "|", with: "\\|").replacingOccurrences(of: "\n", with: " ") }.joined(separator: " | ") + " |"
        }
        var lines = [comment, row(columns.map(\.name)), "|" + Array(repeating: " --- ", count: columns.count).joined(separator: "|") + "|"]
        lines += rows.map(row)
        return lines.joined(separator: "\n")
    }

    // MARK: Values

    /// Dates are local calendar days, written yyyy-MM-dd.
    static func day(_ d: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func date(from s: String, calendar: Calendar = .current) -> Date? {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    /// A new row with today's date and blank fields.
    func blankRow(today: Date = .now) -> [String] {
        columns.map { c in
            switch c.type {
            case .date where c == columns.first { $0.type == .date }: Self.day(today)
            default: ""
            }
        }
    }

    /// Index of the row for `day` in the first date column, if any.
    func rowIndex(for day: Date) -> Int? {
        guard let col = columns.firstIndex(where: { $0.type == .date }) else { return nil }
        let key = Self.day(day)
        return rows.firstIndex { $0[col] == key }
    }

    /// Rows sorted newest first by the first date column (or as written).
    var recentRows: [(offset: Int, cells: [String])] {
        let indexed = rows.enumerated().map { ($0.offset, $0.element) }
        guard let col = columns.firstIndex(where: { $0.type == .date }) else { return indexed.reversed() }
        return indexed.sorted { $0.1[col] > $1.1[col] }
    }

    /// Averages for number and scale columns and hit rates for choices, over the last `days` rows with data.
    func summary(last days: Int = 7) -> [(String, String)] {
        let recent = recentRows.prefix(days).map(\.cells)
        var out: [(String, String)] = []
        for (i, c) in columns.enumerated() {
            let values = recent.map { $0[i] }.filter { !$0.isEmpty }
            guard !values.isEmpty else { continue }
            switch c.type {
            case .number, .scale:
                let nums = values.compactMap { Double($0.replacingOccurrences(of: ",", with: ".")) }
                guard !nums.isEmpty else { continue }
                let avg = nums.reduce(0, +) / Double(nums.count)
                out.append((shortName(c.name), Self.format(avg)))
            case .choice(let opts):
                guard let yes = opts.first else { continue }
                let counted = values.filter { $0 != "N/A" }
                guard !counted.isEmpty else { continue }
                out.append((shortName(c.name), "\(counted.filter { $0 == yes }.count)/\(counted.count)"))
            default: continue
            }
        }
        return out
    }

    static func format(_ v: Double) -> String {
        v.formatted(.number.precision(.fractionLength(0...1)).rounded(rule: .toNearestOrAwayFromZero))
    }

    private func shortName(_ s: String) -> String {
        s.replacingOccurrences(of: #"\s*\(.*\)"#, with: "", options: .regularExpression)
    }
}
