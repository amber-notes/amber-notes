import Foundation

/// Large notes for performance tests, generated so nothing personal is involved.
enum PerfFixtures {
    /// A long, realistic note: headings, paragraphs, lists, checklists, links, code and tables.
    static func longNote(lines: Int = 5000) -> String {
        var out = ["Long note"]
        var i = 0
        while out.count < lines {
            switch i % 12 {
            case 0: out.append("## Section \(i / 12)")
            case 1: out.append("A paragraph with **bold**, *italic*, `code` and a [link](https://example.com/\(i)) in it, long enough to wrap on a narrow window.")
            case 2: out.append("- Bullet item \(i)")
            case 3: out.append("  - Nested item \(i)")
            case 4: out.append("- [ ] Open task \(i)")
            case 5: out.append("- [x] Done task \(i)")
            case 6: out.append("1. Numbered \(i)")
            case 7: out.append("> A quote \(i)")
            case 8: out.append("")
            case 9: out.append("Plain line \(i) ~~struck~~ <u>underlined</u>")
            case 10: out.append("")
            default: out.append("Another line of ordinary text for line \(i).")
            }
            i += 1
        }
        return out.joined(separator: "\n")
    }

    /// A note with tables and many image/link embeds.
    static func blockyNote(tables: Int = 10, embeds: Int = 20) -> String {
        var out = ["Blocks", ""]
        for t in 0..<tables {
            out.append("Table \(t)")
            out.append("| Name | Value | Note |")
            out.append("| --- | --- | --- |")
            for r in 0..<6 { out.append("| Row \(r) | \(r * t) | something \(r) |") }
            out.append("")
            for e in 0..<(embeds / tables) {
                out.append("https://example.com/\(t)/\(e)")
                out.append("")
            }
        }
        return out.joined(separator: "\n")
    }
}
