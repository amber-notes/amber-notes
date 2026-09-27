import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Converts rich text (from Apple Notes, web pages, Pages…) into Pane's markdown.
/// Handles headings (by relative size), bold, italic, strikethrough, code,
/// links, nested bulleted and numbered lists, checklists and, on the Mac, tables.
enum RichTextToMarkdown {
    @MainActor
    static func markdown(fromHTML html: String) -> String {
        guard let data = html.data(using: .utf8),
              let attributed = try? NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue],
                documentAttributes: nil)
        else { return html }
        return markdown(from: attributed)
    }

    static func markdown(from text: NSAttributedString) -> String {
        let ns = text.string as NSString
        // Markdown typed into Apple Notes' Monospaced style is already the source.
        if monospacedShare(text) >= 0.8 {
            var out: [String] = []
            for l in text.string.components(separatedBy: .newlines) {
                let line = l.replacingOccurrences(of: "\u{00A0}", with: " ")
                if line.trimmingCharacters(in: .whitespaces).isEmpty {
                    if !(out.last?.isEmpty ?? true) { out.append("") }
                } else { out.append(line) }
            }
            while out.last?.isEmpty == true { out.removeLast() }
            return out.joined(separator: "\n")
        }
        let bodySize = dominantFontSize(text)
        var code: [String] = []
        func flushCode(into lines: inout [String]) {
            guard !code.isEmpty else { return }
            while code.last?.isEmpty == true { code.removeLast() }
            if !lines.isEmpty, lines.last != "" { lines.append("") }
            lines.append("```")
            lines += code
            lines.append("```")
            code.removeAll()
        }
        var lines: [String] = []
        var index = 0
        var orderedCounters: [Int: Int] = [:]

        while index < ns.length {
            let para = ns.paragraphRange(for: NSRange(location: index, length: 0))
            index = NSMaxRange(para)
            let content = trimmedParagraph(para, ns: ns)
            let style = content.length > 0 ? text.attribute(.paragraphStyle, at: content.location, effectiveRange: nil) as? NSParagraphStyle : nil

            #if os(macOS)
            if let block = style?.textBlocks.first as? NSTextTableBlock {
                let (tableLines, end) = table(starting: para, block: block, in: text)
                if !lines.isEmpty, lines.last != "" { lines.append("") }
                lines += tableLines
                lines.append("")
                index = end
                continue
            }
            #endif

            if content.length == 0 {
                if !code.isEmpty { code.append(""); continue }
                if lines.last != "" { lines.append("") }
                orderedCounters.removeAll()
                continue
            }

            let raw = ns.substring(with: content)
            if isMonospaced(text, content) {
                code.append(raw)
                continue
            }
            flushCode(into: &lines)
            var inline = inlineMarkdown(text, range: content)
            let lists = style?.textLists ?? []

            if let list = lists.last {
                let depth = lists.count - 1
                let indent = String(repeating: "  ", count: depth)
                // Strip the marker text the importer rendered, e.g. "•\t" or "1.\t".
                inline = stripRenderedMarker(inline)
                let format = list.markerFormat.rawValue.lowercased()
                if format.contains("decimal") || format.contains("roman") || format.contains("alpha") {
                    let n = (orderedCounters[depth] ?? list.startingItemNumber - 1) + 1
                    orderedCounters[depth] = n
                    lines.append("\(indent)\(n). \(inline)")
                } else if let checked = checklistState(raw, list: list) {
                    lines.append("\(indent)- [\(checked ? "x" : " ")] \(stripCheckGlyph(inline))")
                } else {
                    lines.append("\(indent)- \(inline)")
                }
                continue
            }
            orderedCounters.removeAll()

            // Headings: a paragraph set wholly in a larger size.
            let size = maxFontSize(text, content)
            let level: Int = size >= bodySize * 1.6 ? 1 : size >= bodySize * 1.3 ? 2 : (size >= bodySize * 1.1 && isWholly(.paneBold, text, content)) ? 3 : 0
            if level > 0 {
                lines.append(String(repeating: "#", count: level) + " " + plainHeading(inline))
                continue
            }

            if let bullet = leadingBullet(raw) {
                lines.append("- " + String(inline.dropFirst(bullet)).trimmingCharacters(in: .whitespaces))
                continue
            }
            lines.append(inline)
        }

        flushCode(into: &lines)
        // Collapse runs of blank lines and trim.
        var out: [String] = []
        for l in lines where !(l.isEmpty && (out.last?.isEmpty ?? true)) { out.append(l) }
        while out.last?.isEmpty == true { out.removeLast() }
        return out.joined(separator: "\n")
    }

    // MARK: Inline

    static func inlineMarkdown(_ text: NSAttributedString, range: NSRange) -> String {
        var result = ""
        text.enumerateAttributes(in: range) { attrs, r, _ in
            var s = escape((text.string as NSString).substring(with: r))
            if s.trimmingCharacters(in: .whitespaces).isEmpty { result += s; return }
            let font = attrs[.font] as? PFont
            let traits = font?.fontDescriptor.symbolicTraits ?? []
            // Keep surrounding spaces outside the markers so markdown parses.
            let lead = String(s.prefix { $0 == " " }), trail = String(s.reversed().prefix { $0 == " " })
            s = String(s.dropFirst(lead.count).dropLast(trail.count))
            if traits.contains(.paneMonoSpace) { s = "`" + (text.string as NSString).substring(with: r).trimmingCharacters(in: .whitespaces) + "`" }
            else {
                if traits.contains(.paneBold) { s = "**\(s)**" }
                if traits.contains(.paneItalic) { s = "*\(s)*" }
                if let strike = attrs[.strikethroughStyle] as? Int, strike != 0 { s = "~~\(s)~~" }
            }
            if let link = attrs[.link] {
                let url = (link as? URL)?.absoluteString ?? (link as? String) ?? ""
                if !url.isEmpty { s = "[\(s)](\(url))" }
            }
            result += lead + s + trail
        }
        return result
    }

    static func escape(_ s: String) -> String {
        var out = ""
        for c in s {
            if "*_`[]\\".contains(c) { out.append("\\") }
            out.append(c)
        }
        return out
    }

    // MARK: Helpers

    private static func trimmedParagraph(_ para: NSRange, ns: NSString) -> NSRange {
        var r = para
        while r.length > 0, let u = Unicode.Scalar(ns.character(at: NSMaxRange(r) - 1)), CharacterSet.newlines.contains(u) { r.length -= 1 }
        return r
    }

    private static func dominantFontSize(_ text: NSAttributedString) -> CGFloat {
        var counts: [CGFloat: Int] = [:]
        text.enumerateAttribute(.font, in: NSRange(location: 0, length: text.length)) { v, r, _ in
            if let f = v as? PFont { counts[f.pointSize.rounded(), default: 0] += r.length }
        }
        return counts.max { $0.value < $1.value }?.key ?? 13
    }

    /// Share of visible characters set in a monospaced face.
    private static func monospacedShare(_ text: NSAttributedString) -> Double {
        var mono = 0, total = 0
        text.enumerateAttribute(.font, in: NSRange(location: 0, length: text.length)) { v, r, _ in
            let visible = (text.string as NSString).substring(with: r).filter { !$0.isWhitespace && !$0.isNewline }.count
            total += visible
            if (v as? PFont)?.fontDescriptor.symbolicTraits.contains(.paneMonoSpace) == true { mono += visible }
        }
        return total == 0 ? 0 : Double(mono) / Double(total)
    }

    private static func maxFontSize(_ text: NSAttributedString, _ r: NSRange) -> CGFloat {
        var m: CGFloat = 0
        text.enumerateAttribute(.font, in: r) { v, _, _ in if let f = v as? PFont { m = max(m, f.pointSize) } }
        return m
    }

    private static func isWholly(_ trait: PFontDescriptor.SymbolicTraits, _ text: NSAttributedString, _ r: NSRange) -> Bool {
        var all = true
        text.enumerateAttribute(.font, in: r) { v, sub, stop in
            let blank = (text.string as NSString).substring(with: sub).trimmingCharacters(in: .whitespaces).isEmpty
            if !blank, (v as? PFont)?.fontDescriptor.symbolicTraits.contains(trait) != true { all = false; stop.pointee = true }
        }
        return all
    }

    private static func isMonospaced(_ text: NSAttributedString, _ r: NSRange) -> Bool {
        isWholly(.paneMonoSpace, text, r)
    }

    private static func plainHeading(_ s: String) -> String {
        s.replacingOccurrences(of: "**", with: "")
    }

    private static func stripRenderedMarker(_ s: String) -> String {
        if let r = s.range(of: #"^\s*([•◦▪︎▫︎·\-–—*]|\\?\*|\d+[.)]?|[a-zA-Z][.)]|[ivxlcIVXLC]+[.)]?)\t"#, options: .regularExpression) {
            return String(s[r.upperBound...])
        }
        return s
    }

    private static let checkGlyphs = CharacterSet(charactersIn: "☐☑☒✓✔︎◯○●⃝")

    private static func checklistState(_ raw: String, list: NSTextList) -> Bool? {
        let body = raw.drop { $0 == "\t" || $0 == " " }
        guard let first = body.unicodeScalars.first else { return nil }
        if "☑☒✓✔".unicodeScalars.contains(first) { return true }
        if "☐○◯".unicodeScalars.contains(first) { return false }
        return nil
    }

    private static func stripCheckGlyph(_ s: String) -> String {
        String(s.drop { $0 == " " || $0 == "\t" || String($0).unicodeScalars.allSatisfy { checkGlyphs.contains($0) } })
    }

    private static func leadingBullet(_ raw: String) -> Int? {
        guard let r = raw.range(of: #"^\s*[•◦▪·]\s+"#, options: .regularExpression) else { return nil }
        return raw.distance(from: raw.startIndex, to: r.upperBound)
    }

    #if os(macOS)
    /// Reads consecutive table-cell paragraphs into a GFM table.
    private static func table(starting para: NSRange, block: NSTextTableBlock, in text: NSAttributedString) -> ([String], Int) {
        let ns = text.string as NSString
        let tableRef = block.table
        var cells: [[String]] = []
        var index = para.location
        while index < ns.length {
            let p = ns.paragraphRange(for: NSRange(location: index, length: 0))
            let content = trimmedParagraph(p, ns: ns)
            let at = content.length > 0 ? content.location : p.location
            guard let style = text.attribute(.paragraphStyle, at: at, effectiveRange: nil) as? NSParagraphStyle,
                  let b = style.textBlocks.first as? NSTextTableBlock, b.table === tableRef else { break }
            while cells.count <= b.startingRow { cells.append([]) }
            while cells[b.startingRow].count <= b.startingColumn { cells[b.startingRow].append("") }
            let cellText = inlineMarkdown(text, range: content).replacingOccurrences(of: "|", with: "\\|")
            let existing = cells[b.startingRow][b.startingColumn]
            cells[b.startingRow][b.startingColumn] = existing.isEmpty ? cellText : existing + "<br>" + cellText
            index = NSMaxRange(p)
        }
        let cols = max(cells.map(\.count).max() ?? 1, 1)
        var lines: [String] = []
        for (i, row) in cells.enumerated() {
            let padded = row + Array(repeating: "", count: cols - row.count)
            lines.append("| " + padded.map { $0.isEmpty ? " " : $0 }.joined(separator: " | ") + " |")
            if i == 0 { lines.append("|" + Array(repeating: " --- ", count: cols).joined(separator: "|") + "|") }
        }
        return (lines, index)
    }
    #endif
}
