import Foundation
import ZIPFoundation

/// Reads the first sheet of an .xlsx into a typed table: headers, cached cell values,
/// dropdown lists (data validations) and date cells. Formulas keep their last value.
enum XLSXImporter {
    enum Failure: LocalizedError {
        case unreadable, empty
        var errorDescription: String? {
            switch self {
            case .unreadable: "That file isn't a spreadsheet Amber Notes can read."
            case .empty: "The first sheet has no header row."
            }
        }
    }

    struct Sheet {
        var name: String
        var cells: [[String]]
        var validations: [Int: [String]] // column index → options
        var dateColumns: Set<Int>
    }

    static func table(from url: URL, keepRowsUntil cutoff: Date? = .now) throws -> (title: String, table: TypedTable) {
        let sheet = try readFirstSheet(url)
        guard let header = sheet.cells.first, header.contains(where: { !$0.isEmpty }) else { throw Failure.empty }
        let width = header.lastIndex(where: { !$0.isEmpty }).map { $0 + 1 } ?? header.count
        let names = (0..<width).map { i -> String in
            let n = i < header.count ? header[i].trimmingCharacters(in: .whitespaces) : ""
            return n.isEmpty ? "Column \(i + 1)" : n
        }
        var rows = sheet.cells.dropFirst().map { r in (0..<width).map { $0 < r.count ? r[$0] : "" } }

        // Types.
        var columns: [TypedTable.Column] = []
        for (i, name) in names.enumerated() {
            let values = rows.map { $0[i] }.filter { !$0.isEmpty }
            let type: TypedTable.ColumnType
            if let r = name.range(of: #"\((\d+)\s*[-–]\s*(\d+)\)"#, options: .regularExpression) {
                let n = name[r].filter { $0.isNumber || $0 == "-" || $0 == "–" }.split(whereSeparator: { $0 == "-" || $0 == "–" }).compactMap { Int($0) }
                type = n.count == 2 ? .scale(n[0], n[1]) : .number
            } else if let opts = sheet.validations[i], !opts.isEmpty {
                type = .choice(opts)
            } else if sheet.dateColumns.contains(i) {
                type = .date
            } else if !values.isEmpty, values.allSatisfy({ Double($0) != nil }) {
                type = .number
            } else if values.isEmpty, name.range(of: #"\b(hours?|minutes?|mins?|count|km|kg|steps|number|amount|#)\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
                type = .number
            } else {
                type = .text
            }
            columns.append(.init(name: name, type: type))
        }

        // Dates to yyyy-MM-dd; trim numbers.
        for r in rows.indices {
            for (i, c) in columns.enumerated() {
                let v = rows[r][i]
                if c.type == .date, let serial = Double(v) { rows[r][i] = TypedTable.day(excelDate(serial)) }
                else if case .number = c.type, let d = Double(v) { rows[r][i] = trim(d) }
                else if case .scale = c.type, let d = Double(v) { rows[r][i] = trim(d) }
            }
        }

        // Keep rows that happened: up to today by the first date column, or any row with content.
        let dateCol = columns.firstIndex { $0.type == .date }
        rows = rows.filter { row in
            guard row.contains(where: { !$0.isEmpty }) else { return false }
            if let dc = dateCol, let cutoff, let d = TypedTable.date(from: row[dc]) { return d <= cutoff }
            return true
        }

        let base = url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "_", with: " ")
        let title = base.prefix(1).uppercased() + base.dropFirst()
        return (title, TypedTable(columns: columns, rows: rows))
    }

    /// Excel's 1900 date system (with its leap-year quirk) to a local calendar day.
    static func excelDate(_ serial: Double) -> Date {
        var c = DateComponents(year: 1899, month: 12, day: 30)
        c.day! += Int(serial.rounded(.down))
        return Calendar.current.date(from: c) ?? .now
    }

    private static func trim(_ d: Double) -> String {
        d == d.rounded() ? String(Int(d)) : String(d)
    }

    // MARK: Reading the zip

    static func readFirstSheet(_ url: URL) throws -> Sheet {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let archive = try? Archive(url: url, accessMode: .read) else { throw Failure.unreadable }
        func file(_ path: String) -> Data? {
            guard let entry = archive[path] else { return nil }
            var data = Data()
            _ = try? archive.extract(entry, skipCRC32: true) { data.append($0) }
            return data
        }
        let shared = file("xl/sharedStrings.xml").map(SharedStrings.parse) ?? []
        let dateStyles = file("xl/styles.xml").map(Styles.dateStyleIndexes) ?? []

        // First sheet in workbook order.
        var sheetPath = "xl/worksheets/sheet1.xml"
        var sheetName = "Sheet1"
        if let wb = file("xl/workbook.xml"), let rels = file("xl/_rels/workbook.xml.rels") {
            let first = Workbook.firstSheet(wb)
            sheetName = first.name
            if let target = Workbook.target(rels, id: first.rid) {
                sheetPath = target.hasPrefix("/") ? String(target.dropFirst()) : "xl/" + target
            }
        }
        guard let xml = file(sheetPath) else { throw Failure.unreadable }
        let p = SheetParser(shared: shared, dateStyles: dateStyles)
        let parser = XMLParser(data: xml)
        parser.delegate = p
        parser.parse()
        return Sheet(name: sheetName, cells: p.grid(), validations: p.validations, dateColumns: p.dateColumns)
    }

    static func columnIndex(_ ref: String) -> Int {
        var n = 0
        for ch in ref.uppercased() where ch.isLetter { n = n * 26 + Int(ch.asciiValue! - 64) }
        return n - 1
    }
}

// MARK: XML pieces

/// Spreadsheet XML may prefix every tag (`x:c`); compare local names only.
private func localName(_ s: String) -> String { s.split(separator: ":").last.map(String.init) ?? s }
private func localAttrs(_ a: [String: String]) -> [String: String] {
    var out: [String: String] = [:]
    for (k, v) in a { out[k == "r:id" ? "rid" : localName(k)] = v }
    return out
}

private final class SharedStrings: NSObject, XMLParserDelegate {
    var out: [String] = []
    var cur = ""
    var inT = false
    static func parse(_ d: Data) -> [String] {
        let s = SharedStrings()
        let p = XMLParser(data: d)
        p.delegate = s
        p.parse()
        return s.out
    }
    func parser(_ p: XMLParser, didStartElement raw: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        let e = localName(raw)
        if e == "si" { cur = "" }
        if e == "t" { inT = true }
    }
    func parser(_ p: XMLParser, foundCharacters s: String) { if inT { cur += s } }
    func parser(_ p: XMLParser, didEndElement raw: String, namespaceURI: String?, qualifiedName: String?) {
        let e = localName(raw)
        if e == "t" { inT = false }
        if e == "si" { out.append(cur) }
    }
}

private enum Styles {
    /// Indexes of cell formats (cellXfs) that display dates.
    static func dateStyleIndexes(_ d: Data) -> Set<Int> {
        final class P: NSObject, XMLParserDelegate {
            var customDate: Set<Int> = []
            var inXfs = false
            var xf = 0
            var out: Set<Int> = []
            func parser(_ p: XMLParser, didStartElement raw: String, namespaceURI: String?, qualifiedName: String?, attributes rawAttrs: [String: String] = [:]) {
                let e = localName(raw), a = localAttrs(rawAttrs)
                if e == "numFmt", let id = a["numFmtId"].flatMap(Int.init), let code = a["formatCode"]?.lowercased(),
                   (code.contains("d") || code.contains("y")) && !code.contains("h") { customDate.insert(id) }
                if e == "cellXfs" { inXfs = true; xf = 0 }
                if inXfs, e == "xf" {
                    let id = a["numFmtId"].flatMap(Int.init) ?? 0
                    if (14...22).contains(id) || customDate.contains(id) { out.insert(xf) }
                    xf += 1
                }
            }
            func parser(_ p: XMLParser, didEndElement raw: String, namespaceURI: String?, qualifiedName: String?) {
                if localName(raw) == "cellXfs" { inXfs = false }
            }
        }
        let p = P()
        let x = XMLParser(data: d)
        x.delegate = p
        x.parse()
        return p.out
    }
}

private enum Workbook {
    static func firstSheet(_ d: Data) -> (name: String, rid: String) {
        final class P: NSObject, XMLParserDelegate {
            var first: (String, String)?
            func parser(_ p: XMLParser, didStartElement raw: String, namespaceURI: String?, qualifiedName: String?, attributes rawAttrs: [String: String] = [:]) {
                let e = localName(raw), a = localAttrs(rawAttrs)
                if e == "sheet", first == nil { first = (a["name"] ?? "Sheet1", a["rid"] ?? "") }
            }
        }
        let p = P()
        let x = XMLParser(data: d)
        x.delegate = p
        x.parse()
        return p.first.map { ($0.0, $0.1) } ?? ("Sheet1", "")
    }

    static func target(_ d: Data, id: String) -> String? {
        final class P: NSObject, XMLParserDelegate {
            let id: String
            var target: String?
            init(_ id: String) { self.id = id }
            func parser(_ p: XMLParser, didStartElement raw: String, namespaceURI: String?, qualifiedName: String?, attributes rawAttrs: [String: String] = [:]) {
                let e = localName(raw), a = localAttrs(rawAttrs)
                if e == "Relationship", a["Id"] == id { target = a["Target"] }
            }
        }
        let p = P(id)
        let x = XMLParser(data: d)
        x.delegate = p
        x.parse()
        return p.target
    }
}

private final class SheetParser: NSObject, XMLParserDelegate {
    let shared: [String]
    let dateStyles: Set<Int>
    var cells: [Int: [Int: String]] = [:]
    var validations: [Int: [String]] = [:]
    var dateColumns: Set<Int> = []
    private var row = 0, col = 0, type = "", style = 0
    private var text = ""
    private var inV = false, inT = false, inFormula1 = false
    private var sqref = ""
    private var isList = false

    init(shared: [String], dateStyles: Set<Int>) {
        self.shared = shared
        self.dateStyles = dateStyles
    }

    func grid() -> [[String]] {
        guard let maxRow = cells.keys.max() else { return [] }
        return (0...maxRow).map { r in
            let row = cells[r] ?? [:]
            guard let maxCol = row.keys.max() else { return [] }
            return (0...maxCol).map { row[$0] ?? "" }
        }
    }

    func parser(_ p: XMLParser, didStartElement raw: String, namespaceURI: String?, qualifiedName: String?, attributes rawAttrs: [String: String] = [:]) {
                let e = localName(raw), a = localAttrs(rawAttrs)
        switch e {
        case "c":
            let ref = a["r"] ?? ""
            col = XLSXImporter.columnIndex(ref)
            row = (Int(ref.filter(\.isNumber)) ?? 1) - 1
            type = a["t"] ?? "n"
            style = a["s"].flatMap(Int.init) ?? 0
            text = ""
        case "v": inV = true
        case "t": inT = true
        case "dataValidation":
            isList = a["type"] == "list"
            sqref = a["sqref"] ?? ""
        case "formula1": inFormula1 = true; text = ""
        default: break
        }
    }

    func parser(_ p: XMLParser, foundCharacters s: String) {
        if inV || inT || inFormula1 { text += s }
    }

    func parser(_ p: XMLParser, didEndElement raw: String, namespaceURI: String?, qualifiedName: String?) {
        let e = localName(raw)
        switch e {
        case "v": inV = false
        case "t": inT = false
        case "c":
            var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if type == "s", let i = Int(value), i < shared.count { value = shared[i] }
            if type == "b" { value = value == "1" ? "Yes" : "No" }
            if !value.isEmpty {
                cells[row, default: [:]][col] = value
                if type == "n", dateStyles.contains(style), row > 0 { dateColumns.insert(col) }
            }
        case "formula1":
            inFormula1 = false
            if isList {
                let opts = text.trimmingCharacters(in: CharacterSet(charactersIn: "\"")).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                for r in sqref.split(separator: " ") {
                    let start = r.split(separator: ":").first.map(String.init) ?? ""
                    validations[XLSXImporter.columnIndex(start)] = opts
                }
            }
        default: break
        }
    }
}
