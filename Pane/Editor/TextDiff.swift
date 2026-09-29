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
