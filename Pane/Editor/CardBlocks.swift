import Foundation

/// A collapsible card inside a note: a `<details>` block with a `<summary>` title.
///
///     <details>
///     <summary>Recipe</summary>
///
///     - 200 g flour
///
///     </details>
///
/// Stored as plain markdown/HTML so it renders on GitHub and every AI understands it.
struct CardBlock: Equatable {
    /// The whole block, from `<details>` to the end of `</details>`.
    var range: NSRange
    /// The card's contents between the summary and `</details>`, trimmed of blank edge lines.
    var contentRange: NSRange
    var title: String
    var content: String

    /// Stable identity across restyles: the block's position among cards.
    var index: Int

    /// The `<details>` line, the `<summary>` line (the same line in the one-line form),
    /// the title text inside `<summary>`, every line between summary and `</details>`,
    /// and the `</details>` line.
    var openLine = NSRange(location: 0, length: 0)
    var summaryLine = NSRange(location: 0, length: 0)
    var titleRange = NSRange(location: 0, length: 0)
    var bodyLines: [NSRange] = []
    var closeLine = NSRange(location: 0, length: 0)
}

enum CardBlocks {
    private static let open = try! NSRegularExpression(pattern: #"^[ \t]*<details(\s+open)?\s*>[ \t]*(<summary>(.*?)</summary>)?[ \t]*$"#, options: [.caseInsensitive])
    private static let summary = try! NSRegularExpression(pattern: #"^[ \t]*<summary>(.*?)</summary>[ \t]*$"#, options: [.caseInsensitive])
    private static let close = try! NSRegularExpression(pattern: #"^[ \t]*</details>[ \t]*$"#, options: [.caseInsensitive])

    static func find(in text: String) -> [CardBlock] {
        let ns = text as NSString
        var lines: [NSRange] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in lines.append(r) }
        var blocks: [CardBlock] = []
        var i = 0
        func match(_ re: NSRegularExpression, _ r: NSRange) -> NSTextCheckingResult? { re.firstMatch(in: text, range: r) }
        while i < lines.count {
            guard let o = match(open, lines[i]) else { i += 1; continue }
            var title: String?
            var bodyStart = i + 1
            var summaryIdx = i
            var titleRange = NSRange(location: NSNotFound, length: 0)
            if o.range(at: 3).location != NSNotFound {
                title = ns.substring(with: o.range(at: 3))
                titleRange = o.range(at: 3)
            } else if i + 1 < lines.count, let s = match(summary, lines[i + 1]) {
                title = ns.substring(with: s.range(at: 1))
                titleRange = s.range(at: 1)
                bodyStart = i + 2
                summaryIdx = i + 1
            }
            guard let t = title else { i += 1; continue }
            guard let end = (bodyStart..<lines.count).first(where: { match(close, lines[$0]) != nil }) else { break }
            // Trim blank lines around the content.
            var a = bodyStart, b = end - 1
            while a <= b, ns.substring(with: lines[a]).trimmingCharacters(in: .whitespaces).isEmpty { a += 1 }
            while b >= a, ns.substring(with: lines[b]).trimmingCharacters(in: .whitespaces).isEmpty { b -= 1 }
            let content = a <= b ? NSRange(location: lines[a].location, length: NSMaxRange(lines[b]) - lines[a].location) : NSRange(location: lines[end].location, length: 0)
            blocks.append(CardBlock(
                range: NSRange(location: lines[i].location, length: NSMaxRange(lines[end]) - lines[i].location),
                contentRange: content,
                title: decode(t.trimmingCharacters(in: .whitespaces)),
                content: ns.substring(with: content),
                index: blocks.count,
                openLine: lines[i],
                summaryLine: lines[summaryIdx],
                titleRange: titleRange,
                bodyLines: bodyStart < end ? Array(lines[bodyStart..<end]) : [],
                closeLine: lines[end]))
            i = end + 1
        }
        return blocks
    }

    /// A new, empty card: a title line and one empty line to write in.
    static let empty = "<details>\n<summary>Card</summary>\n\n</details>"

    /// The markdown for a card.
    static func markdown(title: String, content: String) -> String {
        let t = encode(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Card" : title.trimmingCharacters(in: .whitespacesAndNewlines))
        let c = content.trimmingCharacters(in: .whitespacesAndNewlines)
        return "<details>\n<summary>\(t)</summary>\n\n\(c)\n\n</details>"
    }

    private static func decode(_ s: String) -> String {
        s.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func encode(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }
}
