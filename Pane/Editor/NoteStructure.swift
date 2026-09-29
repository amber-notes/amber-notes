import Foundation

/// A note's code blocks, tables and embeds, found in one pass over its lines.
/// The editor computes it once per version of the text and shares it between
/// styling, caret handling and the live views, instead of each scanning again.
struct NoteStructure {
    /// Fenced code blocks, fence lines included.
    var code: [NSRange] = []
    /// Tables outside code, in order (`index` is the position in this list).
    var grids: [GridTable] = []
    /// Embed lines outside code, in order.
    var embeds: [LineEmbed] = []
    /// Fence markers seen; when this changes, everything restyles.
    var fences = 0
    /// A fence sits inside a list item or quote, where Markdown's container rules
    /// decide where the code ends: such notes always restyle in full.
    var hasNestedFence = false

    init() {}

    init(_ text: String) {
        let ns = text as NSString
        let len = ns.length
        var inCode = false
        var opening = Fence(char: 0, count: 0, bare: true)
        var codeStart = 0
        var rows: [NSRange] = []
        var rowStart = -1
        var prevLine: NSRange?
        var commentBefore: NSRange?
        var code: [NSRange] = [], grids: [GridTable] = [], embeds: [LineEmbed] = [], fences = 0, nested = false

        func firstNonBlank(_ r: NSRange) -> Int? {
            var i = r.location
            while i < NSMaxRange(r) {
                let c = ns.character(at: i)
                if c != 0x20 && c != 0x09 { return i }
                i += 1
            }
            return nil
        }

        func isDelimiter(_ r: NSRange) -> Bool {
            let t = ns.substring(with: r).trimmingCharacters(in: .whitespaces)
            return t.contains("-") && t.allSatisfy { "|-: \t".contains($0) }
        }

        func flushTable() {
            defer { rows = []; rowStart = -1; commentBefore = nil }
            // Like GridTable.find: a table starts at a row followed by a delimiter row.
            while rows.count >= 2, !isDelimiter(rows[1]) { rows.removeFirst(); commentBefore = nil }
            guard rows.count >= 2 else { return }
            let body = rows.map { ns.substring(with: $0) }
            let start = commentBefore?.location ?? rows[0].location
            let range = NSRange(location: start, length: NSMaxRange(rows[rows.count - 1]) - start)
            var g = GridTable.from(lines: body, range: range, index: grids.count)
            if let c = commentBefore {
                let above = ns.substring(with: c).trimmingCharacters(in: .whitespaces)
                g.types = TypedTable.parse(comment: above, table: body.map { $0.trimmingCharacters(in: .whitespaces) })?.columns.map(\.type)
            }
            // Too big for a live grid: it stays styled markdown (see GridTable.maxLiveCells).
            if g.isLive { grids.append(g) }
        }

        ns.enumerateSubstrings(in: NSRange(location: 0, length: len), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in
            let at = firstNonBlank(r)
            let c = at.map { ns.character(at: $0) } ?? 0
            // Fences: three backticks or tildes, at the start of the line or after
            // list and quote markers (a code block inside a list item or quote).
            if let f = Self.fence(ns, line: r) {
                fences += 1
                if let at, let start = Self.fenceStart(ns, line: r), start != at { nested = true }
                if !inCode {
                    flushTable()
                    codeStart = r.location
                    opening = f
                    inCode = true
                    prevLine = r
                    return
                }
                // Only a bare fence of the same kind, at least as long, closes the block.
                if f.char == opening.char, f.count >= opening.count, f.bare {
                    code.append(NSRange(location: codeStart, length: NSMaxRange(r) - codeStart))
                    inCode = false
                }
                prevLine = r
                return
            }
            if inCode { prevLine = r; return }
            if c == 0x7C { // |
                if rows.isEmpty {
                    rowStart = r.location
                    // A typed table's comment sits on the line right above.
                    if let p = prevLine, let pa = firstNonBlank(p), ns.character(at: pa) == 0x3C,
                       case let t = ns.substring(with: p).trimmingCharacters(in: .whitespaces),
                       t.hasPrefix("<!--"), t.hasSuffix("-->"), t.contains(TypedTable.marker) { commentBefore = p }
                }
                rows.append(r)
            } else {
                flushTable()
                if let e = LineEmbed.match(ns, line: r, index: embeds.count) { embeds.append(e) }
            }
            prevLine = r
        }
        flushTable()
        if inCode { code.append(NSRange(location: codeStart, length: len - codeStart)) }
        self.code = code
        self.grids = grids
        self.embeds = embeds
        self.fences = fences
        self.hasNestedFence = nested
    }

    struct Fence {
        var char: unichar
        var count: Int
        /// Nothing but spaces after the fence (so it can close a block).
        var bare: Bool
    }

    /// The code fence on this line, if any: its character, length, and whether it stands alone.
    static func fence(_ ns: NSString, line r: NSRange) -> Fence? {
        guard let i = fenceStart(ns, line: r) else { return nil }
        let end = NSMaxRange(r)
        let c = ns.character(at: i)
        var j = i
        while j < end, ns.character(at: j) == c { j += 1 }
        var k = j
        var bare = true
        while k < end {
            let x = ns.character(at: k)
            if x != 0x20 && x != 0x09 { bare = false; break }
            k += 1
        }
        // A backtick fence's info string can't contain a backtick.
        if c == 0x60, !bare, ns.substring(with: NSRange(location: j, length: end - j)).contains("`") { return nil }
        return Fence(char: c, count: j - i, bare: bare)
    }

    /// Where a code fence starts on this line, looking past list and quote markers.
    static func fenceStart(_ ns: NSString, line r: NSRange) -> Int? {
        var i = r.location
        let end = NSMaxRange(r)
        func ch(_ k: Int) -> unichar { k < end ? ns.character(at: k) : 0 }
        var progressed = true
        while progressed {
            progressed = false
            while ch(i) == 0x20 || ch(i) == 0x09 { i += 1 }
            if ch(i) == 0x3E { i += 1; progressed = true; continue } // >
            if (ch(i) == 0x2D || ch(i) == 0x2A || ch(i) == 0x2B), ch(i + 1) == 0x20 { i += 2; progressed = true; continue } // - * +
            var d = i
            while ch(d) >= 0x30 && ch(d) <= 0x39 && d - i < 9 { d += 1 }
            if d > i, (ch(d) == 0x2E || ch(d) == 0x29), ch(d + 1) == 0x20 { i = d + 2; progressed = true; continue } // 1. 1)
        }
        let c = ch(i)
        guard c == 0x60 || c == 0x7E, ch(i + 1) == c, ch(i + 2) == c else { return nil }
        return i
    }

    /// Tables and embeds as blocks the caret goes around.
    var blocks: [EditorBlock] {
        var out = grids.map { EditorBlock(range: $0.range, grid: $0.index) }
        for e in embeds { out.append(EditorBlock(range: e.range, grid: nil)) }
        return out.sorted { $0.range.location < $1.range.location }
    }
}
