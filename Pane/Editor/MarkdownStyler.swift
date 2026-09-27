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
        case table(header: Bool, first: Bool, last: Bool)
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

    var bodyFont: PFont { .systemFont(ofSize: bodySize) }
    var monoFont: PFont { .monospacedSystemFont(ofSize: bodySize * 0.88, weight: .regular) }

    private var hiddenFont: PFont { .systemFont(ofSize: 0.01) }

    func headingFont(_ level: Int) -> PFont {
        switch level {
        case 1: .systemFont(ofSize: EditorMetrics.title, weight: .bold)
        case 2: .systemFont(ofSize: bodySize * 1.35, weight: .bold)
        case 3: .systemFont(ofSize: bodySize * 1.15, weight: .semibold)
        default: .systemFont(ofSize: bodySize, weight: .semibold)
        }
    }

    func baseParagraph() -> NSMutableParagraphStyle {
        let p = NSMutableParagraphStyle()
        p.lineSpacing = EditorMetrics.lineSpacing
        p.paragraphSpacing = 2
        return p
    }

    var typingAttributes: [NSAttributedString.Key: Any] {
        [.font: bodyFont, .foregroundColor: PColor.paneLabel, .paragraphStyle: baseParagraph()]
    }

    /// Restyles the whole storage. `active` is the caret's selection.
    func apply(to storage: NSTextStorage, active: NSRange) {
        let text = storage.string
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        let activeLines = ns.length == 0 ? NSRange(location: 0, length: 0) : ns.lineRange(for: NSRange(location: min(active.location, ns.length), length: active.length))
        func isActive(_ r: NSRange) -> Bool {
            NSIntersectionRange(r, activeLines).length > 0 || (r.location >= activeLines.location && r.location <= NSMaxRange(activeLines))
        }

        storage.beginEditing()
        defer { storage.endEditing() }
        storage.setAttributes(typingAttributes, range: full)
        guard ns.length > 0 else { return }

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
        var tableRow = 0
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
                let prevIn = lineRange.location > 0 && tableLines.contains(ns.lineRange(for: NSRange(location: lineRange.location - 1, length: 0)).location)
                tableRow = prevIn ? tableRow + 1 : 0
                let nextStart = NSMaxRange(enclosing)
                let next = nextStart < ns.length && tableLines.contains(nextStart)
                storage.addAttribute(.paneLine, value: LineDecoration(.table(header: tableRow == 0, first: !prevIn, last: !next)), range: enclosing)
                let p = baseParagraph()
                p.lineSpacing = 3
                p.paragraphSpacing = 0
                p.firstLineHeadIndent = 10
                p.headIndent = 10
                storage.addAttribute(.paragraphStyle, value: p, range: enclosing)
                storage.addAttribute(.font, value: tableRow == 0 ? monoFont.with(.paneBold) : monoFont, range: lineRange)
                // Pipes and the delimiter row recede.
                let pipes = try! NSRegularExpression(pattern: #"\||(?<=\|)[ :\-]+(?=\|)"#)
                let isDelimiter = trimmed.allSatisfy { "|-: ".contains($0) }
                if isDelimiter {
                    storage.addAttribute(.foregroundColor, value: PColor.paneTertiary.withAlphaComponent(0.5), range: lineRange)
                } else {
                    for m in pipes.matches(in: ns as String, range: lineRange) {
                        storage.addAttribute(.foregroundColor, value: PColor.paneTertiary, range: m.range)
                    }
                }
                sawTitle = true
                return
            }

            if trimmed.isEmpty { return }

            if !sawTitle {
                sawTitle = true
                // The first line is the title, as in Apple Notes.
                if !trimmed.hasPrefix("#") {
                    storage.addAttribute(.font, value: headingFont(1), range: lineRange)
                    let p = baseParagraph()
                    p.paragraphSpacing = 6
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
                storage.addAttribute(.foregroundColor, value: PColor.paneSecondary, range: NSRange(location: prefix.upperBound, length: lineRange.length - len))
                let p = (storage.attribute(.paragraphStyle, at: lineRange.location, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? baseParagraph()
                p.headIndent = 16
                storage.addAttribute(.paragraphStyle, value: p, range: enclosing)
            }
        }
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
        p.paragraphSpacing = 3

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
            let width = lead + EditorMetrics.gutter
            storage.addAttributes(hiddenKerned(to: width, length: prefix.length), range: prefix)
            let markerX = lead + EditorMetrics.gutter * 0.4
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
        p.paragraphSpacingBefore = heading.level <= 2 ? 10 : 6
        p.paragraphSpacing = 4
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
    }

    mutating func visitTable(_ table: Markdown.Table) {
        guard let r = map.range(table.range), safe(r) else { return descendInto(table) }
        var starts = IndexSet()
        ns.enumerateSubstrings(in: ns.lineRange(for: r), options: [.byParagraphs, .substringNotRequired]) { _, line, _, _ in
            starts.insert(line.location)
        }
        tableLineStarts.formUnion(starts)
        descendInto(table)
    }

    mutating func visitHTMLBlock(_ html: HTMLBlock) {
        guard let r = map.range(html.range), safe(r) else { return }
        storage.addAttributes([.font: styler.monoFont, .foregroundColor: PColor.paneSecondary], range: r)
    }
}
