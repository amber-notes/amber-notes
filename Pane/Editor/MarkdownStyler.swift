import Foundation
import Markdown
#if os(iOS)
import UIKit
#else
import AppKit
#endif

extension NSAttributedString.Key {
    /// Per-line decoration drawn by `DecoratedLayoutFragment`.
    static let paneLine = NSAttributedString.Key("pane.line")
}


/// What a line of the note should draw beside or behind its text.
final class LineDecoration: NSObject {
    enum Kind: Equatable {
        case bullet
        case checkbox(checked: Bool)
        case quote
        case code(first: Bool, last: Bool)
        case rule
        case table(header: Bool, first: Bool, last: Bool, columns: [CGFloat], width: CGFloat)
    }
    let kind: Kind
    /// Where the marker is centered, from the fragment's leading edge.
    let markerX: CGFloat
    init(_ kind: Kind, markerX: CGFloat = 0) {
        self.kind = kind
        self.markerX = markerX
    }
    override func isEqual(_ object: Any?) -> Bool {
        guard let o = object as? LineDecoration else { return false }
        return o.kind == kind && o.markerX == markerX
    }
}

/// Parses a list item prefix such as `  - [x] ` or `3. `.
struct ListPrefix: Equatable {
    var indent: String
    var marker: String
    var spacing: String
    var checkbox: Bool?
    /// Length of the whole prefix in UTF-16 units.
    var length: Int
    var ordered: Bool { marker.first?.isNumber == true }
    var level: Int { indent.replacingOccurrences(of: "\t", with: "  ").count / 2 }

    private static let regex = try! NSRegularExpression(pattern: #"^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[([ xX])\][ \t]+)?"#)

    init?(line: String) {
        let ns = line as NSString
        guard let m = Self.regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { return nil }
        indent = ns.substring(with: m.range(at: 1))
        marker = ns.substring(with: m.range(at: 2))
        spacing = ns.substring(with: m.range(at: 3))
        if m.range(at: 4).location != NSNotFound, !marker.first!.isNumber {
            checkbox = ns.substring(with: m.range(at: 5)) != " "
            length = m.range.length
        } else {
            checkbox = nil
            length = m.range(at: 3).upperBound
        }
    }

    /// The prefix to start the next item with when you press Return.
    var continuation: String {
        var next = marker
        if ordered, let n = Int(marker.dropLast()) { next = "\(n + 1)\(marker.last!)" }
        return indent + next + " " + (checkbox != nil ? "[ ] " : "")
    }
}

/// Turns markdown source into attributes, live-preview style: syntax is hidden
/// except on the lines the caret is on, where it shows dimmed so you can edit it.
struct MarkdownStyler {
    var bodySize = EditorMetrics.body
    /// Style the first plain line as the title (off for card contents).
    var firstLineIsTitle = true
    /// Height to reserve for a card shown as a view (collapsed or expanded).
    var tableHeight: (TypedTable) -> CGFloat = { TableCardMetrics.height($0, expanded: false) }

    var bodyFont: PFont { .systemFont(ofSize: bodySize) }
    var monoFont: PFont { .monospacedSystemFont(ofSize: bodySize * 0.88, weight: .regular) }

    private var hiddenFont: PFont { .systemFont(ofSize: 0.01) }

    func headingFont(_ level: Int) -> PFont {
        switch level {
        case 1: .systemFont(ofSize: EditorMetrics.title, weight: .bold)
        case 2: .systemFont(ofSize: bodySize * 1.25, weight: .bold)
        case 3: .systemFont(ofSize: bodySize * 1.1, weight: .semibold)
        default: .systemFont(ofSize: bodySize, weight: .semibold)
        }
    }

    func baseParagraph() -> NSMutableParagraphStyle {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = EditorMetrics.lineSpacing
        // Like Notes: no extra space between paragraphs; blank lines make the gaps.
        p.paragraphSpacing = 0
        return p
    }

    var typingAttributes: [NSAttributedString.Key: Any] {
        [.font: bodyFont, .foregroundColor: PColor.paneLabel, .paragraphStyle: baseParagraph()]
    }

    /// Restyles the whole storage. `active` is the caret's selection.
    /// Returns the cards and embeds to show as views (those the caret isn't on).
    @discardableResult
    func apply(to storage: NSTextStorage, active: NSRange) -> StyledBlocks {
        let text = storage.string
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        let editing = active.location != NSNotFound && ns.length > 0
        let activeLines = editing ? ns.lineRange(for: NSRange(location: min(active.location, ns.length), length: min(active.length, ns.length - min(active.location, ns.length)))) : NSRange(location: NSNotFound, length: 0)
        func isActive(_ r: NSRange) -> Bool {
            guard editing else { return false }
            return NSIntersectionRange(r, activeLines).length > 0 || NSLocationInRange(r.location, activeLines)
                || (r.length == 0 && r.location == NSMaxRange(activeLines))
        }

        storage.beginEditing()
        defer { storage.endEditing() }
        storage.setAttributes(typingAttributes, range: full)
        guard ns.length > 0 else { return StyledBlocks() }

        let map = UTF16Map(text)
        let doc = Document(parsing: text, options: [.disableSmartOpts])
        var codeLines = IndexSet()
        var tableLines = IndexSet()

        var walker = StyleWalker(storage: storage, map: map, styler: self, isActive: isActive)
        walker.visit(doc)
        codeLines = walker.codeLineStarts
        tableLines = walker.tableLineStarts

        // Line pass: title, lists, checkboxes, quotes, rules, code and table decoration.
        var sawTitle = false
        ns.enumerateSubstrings(in: full, options: [.byParagraphs, .substringNotRequired]) { _, lineRange, enclosing, _ in
            let line = ns.substring(with: lineRange)
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if codeLines.contains(lineRange.location) {
                let fence = trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~")
                let prev = lineRange.location == 0 ? false : codeLines.contains(ns.lineRange(for: NSRange(location: lineRange.location - 1, length: 0)).location)
                let nextStart = NSMaxRange(enclosing)
                let next = nextStart < ns.length && codeLines.contains(nextStart)
                storage.addAttribute(.paneLine, value: LineDecoration(.code(first: !prev, last: !next)), range: enclosing)
                let p = baseParagraph()
                p.lineSpacing = 2
                p.paragraphSpacing = 0
                p.firstLineHeadIndent = 12
                p.headIndent = 12
                p.tailIndent = -12
                storage.addAttribute(.paragraphStyle, value: p, range: enclosing)
                if fence {
                    storage.addAttributes([.foregroundColor: PColor.paneTertiary, .font: monoFont], range: lineRange)
                }
                sawTitle = true
                return
            }

            if tableLines.contains(lineRange.location) {
                sawTitle = true
                return
            }

            if trimmed.isEmpty { return }

            if !sawTitle {
                sawTitle = true
                // The first plain line is the title, as in Apple Notes.
                let plain = !trimmed.hasPrefix("#") && !trimmed.hasPrefix(">") && !trimmed.hasPrefix("<") && ListPrefix(line: line) == nil
                if firstLineIsTitle && plain {
                    storage.addAttribute(.font, value: headingFont(1), range: lineRange)
                    let p = baseParagraph()
                    p.paragraphSpacing = 4
                    storage.addAttribute(.paragraphStyle, value: p, range: enclosing)
                    return
                }
            }

            if trimmed.count >= 3, ["-", "*", "_"].contains(where: { c in trimmed.replacingOccurrences(of: " ", with: "").allSatisfy { String($0) == c } }) {
                storage.addAttribute(.paneLine, value: LineDecoration(.rule), range: enclosing)
                storage.addAttributes(isActive(lineRange) ? [.foregroundColor: PColor.paneTertiary] : hidden, range: lineRange)
                return
            }

            if let list = ListPrefix(line: line) {
                styleList(list, lineRange: lineRange, enclosing: enclosing, storage: storage)
                return
            }

            if let q = line.range(of: #"^[ \t]*>[ \t]?"#, options: .regularExpression) {
                let len = (line[q.lowerBound..<q.upperBound] as Substring).utf16.count
                let prefix = NSRange(location: lineRange.location, length: len)
                storage.addAttributes(hiddenKerned(to: 16, length: len), range: prefix)
                storage.addAttribute(.paneLine, value: LineDecoration(.quote), range: enclosing)
                let body = NSRange(location: prefix.upperBound, length: lineRange.length - len)
                storage.enumerateAttribute(.link, in: body) { link, sub, _ in
                    if link == nil { storage.addAttribute(.foregroundColor, value: PColor.paneSecondary, range: sub) }
                }
                let p = (storage.attribute(.paragraphStyle, at: lineRange.location, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? baseParagraph()
                p.headIndent = 16
                storage.addAttribute(.paragraphStyle, value: p, range: enclosing)
            }
        }

        for table in walker.tables {
            layoutTable(table, storage: storage, isActive: isActive)
        }

        styleUnderlines(storage, isActive: isActive, skip: walker.codeRanges)
        let tables = styleTypedTables(storage, isActive: isActive, skip: walker.codeRanges)
        let grids = styleGrids(storage, isActive: isActive)
        let embeds = styleEmbeds(storage, isActive: isActive, skip: walker.codeRanges)
        return StyledBlocks(embeds: embeds, tables: tables, grids: grids)
    }

    /// Plain tables become an editable grid (a live view over a reserved line), like Notes.
    /// If the caret lands inside the markdown itself, the aligned source shows instead.
    private func styleGrids(_ storage: NSTextStorage, isActive: (NSRange) -> Bool) -> [GridTable] {
        let ns = storage.string as NSString
        var shown: [GridTable] = []
        for var g in GridTable.find(in: storage.string) where !isActive(g.range) {
            let lines = ns.lineRange(for: g.range)
            let first = ns.lineRange(for: NSRange(location: g.range.location, length: 0))
            storage.removeAttribute(.paneLine, range: lines)
            storage.addAttributes(hidden, range: g.range)
            storage.removeAttribute(.kern, range: g.range)
            let h = GridMetrics.height(g)
            let head = NSMutableParagraphStyle()
            head.minimumLineHeight = h
            head.maximumLineHeight = h
            head.paragraphSpacingBefore = 2
            head.paragraphSpacing = 8
            storage.addAttribute(.paragraphStyle, value: head, range: first)
            let rest = NSRange(location: NSMaxRange(first), length: NSMaxRange(lines) - NSMaxRange(first))
            if rest.length > 0 {
                let flat = NSMutableParagraphStyle()
                flat.minimumLineHeight = 0.01
                flat.maximumLineHeight = 0.01
                flat.lineSpacing = 0
                flat.paragraphSpacing = 0
                storage.addAttribute(.paragraphStyle, value: flat, range: rest)
            }
            g.index = shown.count
            shown.append(g)
        }
        return shown
    }

    private static let underline = try! NSRegularExpression(pattern: #"<u>(.+?)</u>"#, options: [.caseInsensitive])

    /// Markdown has no underline, so Amber Notes uses <u>…</u> (GitHub shows it too).
    /// The tags hide like other syntax and the text between them is underlined.
    private func styleUnderlines(_ storage: NSTextStorage, isActive: (NSRange) -> Bool, skip: [NSRange]) {
        let full = NSRange(location: 0, length: storage.length)
        for m in Self.underline.matches(in: storage.string, range: full) {
            if skip.contains(where: { NSIntersectionRange($0, m.range).length > 0 }) { continue }
            let inner = m.range(at: 1)
            storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: inner)
            let look = hiddenOrDim(active: isActive(m.range))
            storage.addAttributes(look, range: NSRange(location: m.range.location, length: 3))
            storage.addAttributes(look, range: NSRange(location: NSMaxRange(inner), length: 4))
        }
    }

    /// Typed tables become a table card; with the caret inside, the markdown shows.
    private func styleTypedTables(_ storage: NSTextStorage, isActive: (NSRange) -> Bool, skip: [NSRange]) -> [TypedTable] {
        let ns = storage.string as NSString
        var shown: [TypedTable] = []
        for t in TypedTable.find(in: storage.string) {
            if skip.contains(where: { NSIntersectionRange($0, t.range).length > 0 }) { continue }
            let lines = ns.lineRange(for: t.range)
            let first = ns.lineRange(for: NSRange(location: t.range.location, length: 0))
            if isActive(t.range) {
                storage.addAttributes([.foregroundColor: PColor.paneTertiary, .font: monoFont], range: NSRange(location: first.location, length: first.length))
                continue
            }
            storage.removeAttribute(.paneLine, range: lines)
            storage.addAttributes(hidden, range: t.range)
            storage.removeAttribute(.kern, range: t.range)
            let h = tableHeight(t)
            let head = NSMutableParagraphStyle()
            head.minimumLineHeight = h
            head.maximumLineHeight = h
            head.paragraphSpacingBefore = 6
            head.paragraphSpacing = 10
            storage.addAttribute(.paragraphStyle, value: head, range: first)
            let rest = NSRange(location: NSMaxRange(first), length: NSMaxRange(lines) - NSMaxRange(first))
            if rest.length > 0 {
                let flat = NSMutableParagraphStyle()
                flat.minimumLineHeight = 0.01
                flat.maximumLineHeight = 0.01
                flat.lineSpacing = 0
                flat.paragraphSpacing = 0
                storage.addAttribute(.paragraphStyle, value: flat, range: rest)
            }
            var t = t
            t.index = shown.count
            shown.append(t)
        }
        return shown
    }

    /// File, image and link lines become one reserved line for a live view.
    private func styleEmbeds(_ storage: NSTextStorage, isActive: (NSRange) -> Bool, skip: [NSRange]) -> [LineEmbed] {
        var shown: [LineEmbed] = []
        let ns = storage.string as NSString
        for e in LineEmbed.find(in: storage.string) {
            if skip.contains(where: { NSIntersectionRange($0, e.range).length > 0 }) { continue }
            let line = ns.lineRange(for: e.range)
            if isActive(e.range) {
                storage.addAttribute(.foregroundColor, value: PColor.paneSecondary, range: e.range)
                continue
            }
            storage.removeAttribute(.paneLine, range: line)
            storage.addAttributes(hidden, range: e.range)
            storage.removeAttribute(.link, range: e.range)
            storage.removeAttribute(.kern, range: e.range)
            let p = NSMutableParagraphStyle()
            p.minimumLineHeight = e.height
            p.maximumLineHeight = e.height
            p.paragraphSpacingBefore = 4
            p.paragraphSpacing = 8
            storage.addAttribute(.paragraphStyle, value: p, range: line)
            var e = e
            e.index = shown.count
            shown.append(e)
        }
        return shown
    }

    /// Lays a GFM table out as a grid: pipes are hidden and each cell is
    /// pushed to its column with kerning, so the source stays plain markdown.
    private func layoutTable(_ range: NSRange, storage: NSTextStorage, isActive: (NSRange) -> Bool) {
        let ns = storage.string as NSString
        struct Row { var line: NSRange; var enclosing: NSRange; var cells: [NSRange]; var delimiter: Bool }
        var rows: [Row] = []
        ns.enumerateSubstrings(in: range, options: [.byParagraphs, .substringNotRequired]) { _, line, enclosing, _ in
            let text = ns.substring(with: line)
            let delimiter = text.contains("-") && text.allSatisfy { "|-: \t".contains($0) }
            rows.append(Row(line: line, enclosing: enclosing, cells: Self.cells(in: line, ns: ns), delimiter: delimiter))
        }
        guard !rows.isEmpty else { return }
        let caretInTable = isActive(range)
        let pad: CGFloat = 12, gap: CGFloat = 22

        // Editing inside a table: show the whole table as tidy source, monospaced,
        // pipes faded and lined up, on one panel. Mixing grid rows and raw rows looks broken.
        if caretInTable {
            let mono = monoFont
            let advance = ("0" as NSString).size(withAttributes: [.font: mono]).width
            var widths: [Int] = []
            for row in rows {
                for (i, c) in row.cells.enumerated() {
                    if widths.count <= i { widths.append(0) }
                    widths[i] = max(widths[i], c.length)
                }
            }
            for (i, row) in rows.enumerated() {
                storage.addAttributes([.font: mono, .foregroundColor: row.delimiter ? PColor.paneTertiary : PColor.paneLabel], range: row.line)
                for m in Self.pipeRegex.matches(in: ns as String, range: row.line) {
                    storage.addAttribute(.foregroundColor, value: PColor.paneTertiary, range: m.range)
                }
                // Pad short cells with kerning so every pipe lines up, without touching the text.
                for (ci, c) in row.cells.enumerated() where ci < widths.count {
                    let short = widths[ci] - c.length
                    let after = NSMaxRange(c)
                    if short > 0, after < NSMaxRange(row.line) {
                        storage.addAttribute(.kern, value: CGFloat(short) * advance, range: NSRange(location: after, length: 1))
                    }
                }
                if i == 0 { storage.addAttribute(.font, value: mono.with(.paneBold), range: row.line) }
                let p = baseParagraph()
                p.lineSpacing = 2
                p.paragraphSpacing = 0
                p.firstLineHeadIndent = 12
                p.headIndent = 12
                p.lineBreakMode = .byClipping
                storage.addAttribute(.paragraphStyle, value: p, range: row.enclosing)
                storage.addAttribute(.paneLine, value: LineDecoration(.code(first: i == 0, last: i == rows.count - 1)), range: row.enclosing)
            }
            return
        }

        // Header row is bold; everything uses the body face so it reads like text.
        let headerFont = PFont.systemFont(ofSize: bodySize, weight: .semibold)
        for (i, row) in rows.enumerated() where !row.delimiter {
            for c in row.cells where c.length > 0 {
                storage.enumerateAttribute(.font, in: c) { v, sub, _ in
                    guard let f = v as? PFont, f.pointSize > 1 else { return }
                    let base: PFont = f.fontDescriptor.symbolicTraits.contains(.paneMonoSpace) ? f : (i == 0 ? headerFont : bodyFont)
                    let keep = f.fontDescriptor.symbolicTraits.intersection([.paneItalic, .paneBold])
                    storage.addAttribute(.font, value: keep.isEmpty ? base : base.with(keep), range: sub)
                }
            }
        }

        let columnCount = rows.map(\.cells.count).max() ?? 0
        var widths = [CGFloat](repeating: 24, count: columnCount)
        for row in rows where !row.delimiter {
            for (i, c) in row.cells.enumerated() where c.length > 0 {
                widths[i] = max(widths[i], ceil(storage.attributedSubstring(from: c).size().width))
            }
        }
        var starts: [CGFloat] = []
        var x = pad
        for w in widths { starts.append(x); x += w + gap }
        let tableWidth = x - gap + pad

        for (i, row) in rows.enumerated() {
            let p = baseParagraph()
            p.lineSpacing = 0
            p.paragraphSpacing = 0
            p.paragraphSpacingBefore = 0
            p.minimumLineHeight = bodySize * 2.1
            p.lineBreakMode = .byClipping
            let showRaw = caretInTable && isActive(row.line)
            if row.delimiter {
                if caretInTable {
                    storage.addAttributes([.foregroundColor: PColor.paneTertiary, .font: PFont.systemFont(ofSize: bodySize * 0.7)], range: row.line)
                    p.minimumLineHeight = bodySize * 1.2
                } else {
                    storage.addAttributes(hidden, range: row.line)
                    p.minimumLineHeight = 1
                    p.maximumLineHeight = 1
                }
            } else if showRaw {
                // The row being edited shows its pipes so you can see what you type.
                for m in Self.pipeRegex.matches(in: ns as String, range: row.line) {
                    storage.addAttribute(.foregroundColor, value: PColor.paneTertiary, range: m.range)
                }
                p.firstLineHeadIndent = pad
            } else {
                var cursor = row.line.location
                var penX: CGFloat = 0
                for (ci, c) in row.cells.enumerated() {
                    let hiddenRange = NSRange(location: cursor, length: c.location - cursor)
                    if hiddenRange.length > 0 {
                        storage.addAttributes(hidden, range: hiddenRange)
                        storage.addAttribute(.kern, value: starts[ci] - penX, range: NSRange(location: NSMaxRange(hiddenRange) - 1, length: 1))
                    } else if ci == 0 {
                        p.firstLineHeadIndent = starts[0]
                    }
                    penX = starts[ci] + (c.length > 0 ? ceil(storage.attributedSubstring(from: c).size().width) : 0)
                    cursor = NSMaxRange(c)
                }
                if cursor < NSMaxRange(row.line) {
                    storage.addAttributes(hidden, range: NSRange(location: cursor, length: NSMaxRange(row.line) - cursor))
                }
            }
            let dividers = starts.dropFirst().map { $0 - gap / 2 }
            let deco = LineDecoration(.table(header: i == 0, first: i == 0, last: i == rows.count - 1, columns: Array(dividers), width: tableWidth))
            storage.addAttribute(.paneLine, value: deco, range: row.enclosing)
            storage.addAttribute(.paragraphStyle, value: p, range: row.enclosing)
        }
    }

    private static let pipeRegex = try! NSRegularExpression(pattern: #"(?<!\\)\|"#)

    /// Content ranges of each cell, trimmed; an empty cell is a zero-length range at its end.
    static func cells(in line: NSRange, ns: NSString) -> [NSRange] {
        var bounds = pipeRegex.matches(in: ns as String, range: line).map(\.range.location)
        let text = ns.substring(with: line).trimmingCharacters(in: .whitespaces)
        if !text.hasPrefix("|") { bounds.insert(line.location - 1, at: 0) }
        if !text.hasSuffix("|") || bounds.count < 2 { bounds.append(NSMaxRange(line)) }
        var cells: [NSRange] = []
        for i in 0..<(bounds.count - 1) {
            var a = bounds[i] + 1, b = bounds[i + 1]
            while a < b, [0x20, 0x09].contains(ns.character(at: a)) { a += 1 }
            while b > a, [0x20, 0x09].contains(ns.character(at: b - 1)) { b -= 1 }
            cells.append(a == b ? NSRange(location: bounds[i + 1], length: 0) : NSRange(location: a, length: b - a))
        }
        return cells
    }

    private var hidden: [NSAttributedString.Key: Any] {
        [.font: hiddenFont, .foregroundColor: PColor.clear]
    }

    /// Hidden characters whose last glyph is kerned so the run is `width` wide.
    private func hiddenKerned(to width: CGFloat, length: Int) -> [NSAttributedString.Key: Any] {
        var a = hidden
        a[.kern] = width / CGFloat(max(length, 1))
        return a
    }

    private func styleList(_ list: ListPrefix, lineRange: NSRange, enclosing: NSRange, storage: NSTextStorage) {
        let level = CGFloat(list.level)
        let lead = level * EditorMetrics.nestStep
        let prefix = NSRange(location: lineRange.location, length: min(list.length, lineRange.length))
        let content = NSRange(location: prefix.upperBound, length: lineRange.length - prefix.length)
        let p = baseParagraph()

        if list.ordered {
            // Numbers stay visible: they carry meaning. The indent before them is kerned.
            let number = NSRange(location: lineRange.location + (list.indent as NSString).length, length: (list.marker as NSString).length)
            if list.indent.isEmpty == false {
                storage.addAttributes(hiddenKerned(to: lead, length: (list.indent as NSString).length), range: NSRange(location: lineRange.location, length: (list.indent as NSString).length))
            }
            let numberFont = PFont.monospacedDigitSystemFont(ofSize: bodySize, weight: .regular)
            storage.addAttributes([.foregroundColor: PColor.paneSecondary, .font: numberFont], range: number)
            let measured = (list.marker as NSString).size(withAttributes: [.font: numberFont]).width
            let spaceRange = NSRange(location: number.upperBound, length: prefix.upperBound - number.upperBound)
            storage.addAttributes(hiddenKerned(to: max(EditorMetrics.gutter - measured, 6), length: spaceRange.length), range: spaceRange)
            p.headIndent = lead + max(EditorMetrics.gutter, measured + 6)
        } else {
            // Checklists get Notes' larger circle and a little air between items.
            let isCheck = list.checkbox != nil
            let width = lead + (isCheck ? EditorMetrics.checkSize + 9 : EditorMetrics.gutter)
            storage.addAttributes(hiddenKerned(to: width, length: prefix.length), range: prefix)
            let markerX = isCheck ? lead + EditorMetrics.checkSize / 2 + 1 : lead + EditorMetrics.gutter * 0.4
            if isCheck { p.paragraphSpacing = 5 }
            if let checked = list.checkbox {
                storage.addAttribute(.paneLine, value: LineDecoration(.checkbox(checked: checked), markerX: markerX), range: enclosing)
                if checked {
                    storage.addAttribute(.foregroundColor, value: PColor.paneSecondary, range: content)
                }
            } else {
                storage.addAttribute(.paneLine, value: LineDecoration(.bullet, markerX: markerX), range: enclosing)
            }
            p.headIndent = width
        }
        storage.addAttribute(.paragraphStyle, value: p, range: enclosing)
    }

    fileprivate func hiddenOrDim(active: Bool) -> [NSAttributedString.Key: Any] {
        active ? [.foregroundColor: PColor.paneTertiary] : hidden
    }
}

/// What the styler turned into live views.
struct StyledBlocks {
    var embeds: [LineEmbed] = []
    var tables: [TypedTable] = []
    var grids: [GridTable] = []
}

/// Maps swift-markdown's line/column (UTF-8) locations onto UTF-16 offsets.
struct UTF16Map {
    private var lineStarts: [Int] = [0] // UTF-8 offset where each line starts
    private var utf8ToUtf16: [Int]

    init(_ s: String) {
        var table = [Int]()
        table.reserveCapacity(s.utf8.count + 1)
        var u16 = 0
        var u8 = 0
        for scalar in s.unicodeScalars {
            let n8 = String(scalar).utf8.count
            for _ in 0..<n8 { table.append(u16) }
            u8 += n8
            u16 += scalar.utf16.count
            if scalar == "\n" { lineStarts.append(u8) }
        }
        table.append(u16)
        utf8ToUtf16 = table
    }

    func offset(_ loc: SourceLocation) -> Int {
        let line = min(max(loc.line - 1, 0), lineStarts.count - 1)
        let u8 = min(lineStarts[line] + loc.column - 1, utf8ToUtf16.count - 1)
        return utf8ToUtf16[max(u8, 0)]
    }

    func range(_ r: SourceRange?) -> NSRange? {
        guard let r else { return nil }
        let a = offset(r.lowerBound), b = offset(r.upperBound)
        return b >= a ? NSRange(location: a, length: b - a) : nil
    }
}

/// Walks the markdown tree and applies inline styles.
private struct StyleWalker: MarkupWalker {
    let storage: NSTextStorage
    let map: UTF16Map
    let styler: MarkdownStyler
    let isActive: (NSRange) -> Bool
    var codeLineStarts = IndexSet()
    var tableLineStarts = IndexSet()
    var tables: [NSRange] = []
    var codeRanges: [NSRange] = []

    private var ns: NSString { storage.string as NSString }

    private func safe(_ r: NSRange) -> Bool { r.location >= 0 && NSMaxRange(r) <= ns.length }

    private func addTrait(_ trait: PFontDescriptor.SymbolicTraits, _ r: NSRange) {
        storage.enumerateAttribute(.font, in: r) { value, sub, _ in
            guard let f = value as? PFont, f.pointSize > 1 else { return }
            storage.addAttribute(.font, value: f.with(trait), range: sub)
        }
    }

    /// Hides (or dims) `count` characters at each end of `r`.
    private func markDelimiters(_ r: NSRange, lead: Int, trail: Int) {
        let dim = styler.hiddenOrDim(active: isActive(r))
        if lead > 0, r.length >= lead { storage.addAttributes(dim, range: NSRange(location: r.location, length: lead)) }
        if trail > 0, r.length >= lead + trail { storage.addAttributes(dim, range: NSRange(location: NSMaxRange(r) - trail, length: trail)) }
    }

    private func delimiterLength(_ r: NSRange, char: unichar) -> Int {
        var n = 0
        while n < r.length, ns.character(at: r.location + n) == char { n += 1 }
        return n
    }

    mutating func visitHeading(_ heading: Heading) {
        guard let r = map.range(heading.range), safe(r) else { return descendInto(heading) }
        storage.addAttribute(.font, value: styler.headingFont(heading.level), range: r)
        let p = styler.baseParagraph()
        p.paragraphSpacingBefore = heading.level <= 2 ? 4 : 2
        p.paragraphSpacing = 2
        storage.addAttribute(.paragraphStyle, value: p, range: ns.paragraphRange(for: r))
        let hashes = delimiterLength(r, char: 0x23)
        var marker = hashes
        while r.location + marker < NSMaxRange(r), ns.character(at: r.location + marker) == 0x20 { marker += 1 }
        storage.addAttributes(styler.hiddenOrDim(active: isActive(r)), range: NSRange(location: r.location, length: marker))
        descendInto(heading)
    }

    mutating func visitStrong(_ strong: Strong) {
        guard let r = map.range(strong.range), safe(r) else { return descendInto(strong) }
        addTrait(.paneBold, r)
        markDelimiters(r, lead: 2, trail: 2)
        descendInto(strong)
    }

    mutating func visitEmphasis(_ emphasis: Emphasis) {
        guard let r = map.range(emphasis.range), safe(r) else { return descendInto(emphasis) }
        addTrait(.paneItalic, r)
        markDelimiters(r, lead: 1, trail: 1)
        descendInto(emphasis)
    }

    mutating func visitStrikethrough(_ s: Strikethrough) {
        guard let r = map.range(s.range), safe(r) else { return descendInto(s) }
        let n = delimiterLength(r, char: 0x7E)
        storage.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: PColor.paneSecondary], range: r)
        markDelimiters(r, lead: n, trail: n)
        descendInto(s)
    }

    mutating func visitInlineCode(_ code: InlineCode) {
        guard let r = map.range(code.range), safe(r) else { return }
        let n = delimiterLength(r, char: 0x60)
        storage.addAttributes([.font: styler.monoFont, .backgroundColor: PColor.paneFill, .foregroundColor: PColor.paneLabel], range: r)
        markDelimiters(r, lead: n, trail: n)
    }

    mutating func visitLink(_ link: Link) {
        guard let r = map.range(link.range), safe(r) else { return descendInto(link) }
        let source = ns.substring(with: r)
        if source.hasPrefix("["), let close = source.range(of: "](") {
            let textLen = (source[source.index(after: source.startIndex)..<close.lowerBound] as Substring).utf16.count
            let textRange = NSRange(location: r.location + 1, length: textLen)
            storage.addAttribute(.foregroundColor, value: PColor.paneAccent, range: textRange)
            if let dest = link.destination, let url = URL(string: dest) {
                storage.addAttribute(.link, value: url, range: textRange)
            }
            let dim = styler.hiddenOrDim(active: isActive(r))
            storage.addAttributes(dim, range: NSRange(location: r.location, length: 1))
            storage.addAttributes(dim, range: NSRange(location: textRange.upperBound, length: NSMaxRange(r) - textRange.upperBound))
        } else {
            // Autolinks and bare URLs.
            storage.addAttribute(.foregroundColor, value: PColor.paneAccent, range: r)
            if let dest = link.destination, let url = URL(string: dest) { storage.addAttribute(.link, value: url, range: r) }
        }
        descendInto(link)
    }

    mutating func visitImage(_ image: Image) {
        guard let r = map.range(image.range), safe(r) else { return }
        storage.addAttribute(.foregroundColor, value: PColor.paneSecondary, range: r)
    }

    mutating func visitCodeBlock(_ block: CodeBlock) {
        guard let r = map.range(block.range), safe(r) else { return }
        storage.addAttributes([.font: styler.monoFont, .foregroundColor: PColor.paneLabel], range: r)
        var starts = IndexSet()
        ns.enumerateSubstrings(in: ns.lineRange(for: r), options: [.byParagraphs, .substringNotRequired]) { _, line, _, _ in
            starts.insert(line.location)
        }
        codeLineStarts.formUnion(starts)
        codeRanges.append(r)
    }

    mutating func visitTable(_ table: Markdown.Table) {
        guard let r = map.range(table.range), safe(r) else { return descendInto(table) }
        var starts = IndexSet()
        ns.enumerateSubstrings(in: ns.lineRange(for: r), options: [.byParagraphs, .substringNotRequired]) { _, line, _, _ in
            starts.insert(line.location)
        }
        tableLineStarts.formUnion(starts)
        tables.append(ns.lineRange(for: r))
        descendInto(table)
    }

    mutating func visitHTMLBlock(_ html: HTMLBlock) {
        guard let r = map.range(html.range), safe(r) else { return }
        storage.addAttributes([.font: styler.monoFont, .foregroundColor: PColor.paneSecondary], range: r)
    }
}
