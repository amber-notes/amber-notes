import Foundation

/// The smallest single replacement that turns one text into another, so text arriving
/// from another device lands as an edit (the caret, selection and scroll stay put)
/// instead of a whole new document.
enum TextDiff {
    struct Edit: Equatable {
        /// The range in the old text that changes (UTF-16).
        var range: NSRange
        var replacement: String
    }

    /// The common prefix and suffix stay; only what's between them is replaced.
    static func edit(from old: String, to new: String) -> Edit? {
        guard old != new else { return nil }
        let a = Array(old.utf16), b = Array(new.utf16)
        var start = 0
        while start < a.count, start < b.count, a[start] == b[start] { start += 1 }
        var endA = a.count, endB = b.count
        while endA > start, endB > start, a[endA - 1] == b[endB - 1] { endA -= 1; endB -= 1 }
        // Never split a surrogate pair: widen the range to whole characters.
        func trail(_ x: [UInt16], _ i: Int) -> Bool { i < x.count && UTF16.isTrailSurrogate(x[i]) }
        while start > 0, trail(a, start) || trail(b, start) { start -= 1 }
        while trail(a, endA) || trail(b, endB) { endA += 1; endB += 1 }
        let replacement = String(decoding: b[start..<endB], as: UTF16.self)
        return Edit(range: NSRange(location: start, length: endA - start), replacement: replacement)
    }

    /// Two edits of `base` put together: `mine` with the change from `base` to `theirs` on top.
    /// Nil when both touched the same lines (a word typed on a line the other side rewrote
    /// counts), so the caller keeps one side whole instead of guessing.
    static func merge(base: String, mine: String, theirs: String) -> String? {
        guard let t = edit(from: base, to: theirs) else { return mine }
        guard let m = edit(from: base, to: mine) else { return theirs }
        let b = base as NSString
        // At the very end of the text, the lines are the last line (lineRange gives nothing there).
        let end = t.range.location == b.length && b.length > 0 && b.character(at: b.length - 1) != 10
        let lines = b.lineRange(for: end ? NSRange(location: b.length - 1, length: 1) : t.range)
        guard NSMaxRange(m.range) <= lines.location || (m.range.location >= NSMaxRange(lines) && !end) else { return nil }
        let delta = (m.replacement as NSString).length - m.range.length
        let at = NSRange(location: m.range.location <= t.range.location ? t.range.location + delta : t.range.location, length: t.range.length)
        let s = mine as NSString
        guard NSMaxRange(at) <= s.length, s.substring(with: at) == b.substring(with: t.range) else { return nil }
        return s.replacingCharacters(in: at, with: t.replacement)
    }

    /// Where a selection ends up after `edit`: before the change it stays, after it it
    /// shifts by the change in length, and inside the replaced text it moves to the end
    /// of what arrived.
    static func map(_ selection: NSRange, through edit: Edit) -> NSRange {
        let delta = (edit.replacement as NSString).length - edit.range.length
        func point(_ p: Int) -> Int {
            if p <= edit.range.location { return p }
            if p >= NSMaxRange(edit.range) { return p + delta }
            return edit.range.location + (edit.replacement as NSString).length
        }
        let start = point(selection.location)
        let end = point(NSMaxRange(selection))
        return NSRange(location: start, length: max(0, end - start))
    }
}
