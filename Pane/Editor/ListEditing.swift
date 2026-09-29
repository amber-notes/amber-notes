import Foundation

/// A text replacement the editor should perform instead of the default one.
struct TextEdit: Equatable {
    var range: NSRange
    var replacement: String
    /// Caret location after the edit.
    var caret: Int
}

/// Editing rules that make lists and checklists feel like Apple Notes.
/// Pure functions over the markdown source, so they are unit-tested.
enum ListEditing {
    /// Return inside a list item continues the list; on an empty item it ends it.
    static func returnKey(in text: String, selection: NSRange) -> TextEdit? {
        let ns = text as NSString
        guard selection.location <= ns.length else { return nil }
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        if let quote = line.range(of: #"^[ \t]*>[ \t]?"#, options: .regularExpression) {
            let prefixLen = (line[quote] as Substring).utf16.count
            guard selection.location >= lineRange.location + prefixLen else { return nil }
            if line[quote.upperBound...].trimmingCharacters(in: .whitespaces).isEmpty {
                return TextEdit(range: NSRange(location: lineRange.location, length: (line as NSString).length), replacement: "", caret: lineRange.location)
            }
            let insert = "\n> "
            return TextEdit(range: selection, replacement: insert, caret: selection.location + 3)
        }
        guard let list = ListPrefix(line: line), selection.location >= lineRange.location + list.length else { return nil }

        let content = (line as NSString).substring(from: list.length)
        if content.trimmingCharacters(in: .whitespaces).isEmpty {
            // Empty item: outdent one level, or leave the list.
            if list.level > 0 {
                let newIndent = String(list.indent.dropFirst(min(2, list.indent.count)))
                let replacement = newIndent + String(line.dropFirst(list.indent.count))
                return TextEdit(range: NSRange(location: lineRange.location, length: (line as NSString).length), replacement: replacement, caret: lineRange.location + (replacement as NSString).length)
            }
            // Leaving a list keeps a blank line after it, so what follows isn't swallowed by the last item.
            let afterList = lineRange.location > 0 && ListPrefix(line: ns.substring(with: ns.lineRange(for: NSRange(location: lineRange.location - 1, length: 0)))) != nil
            let replacement = afterList ? "\n" : ""
            return TextEdit(range: NSRange(location: lineRange.location, length: (line as NSString).length), replacement: replacement, caret: lineRange.location + (replacement as NSString).length)
        }
        let insert = "\n" + list.continuation
        return TextEdit(range: selection, replacement: insert, caret: selection.location + (insert as NSString).length)
    }

    /// Backspace right after a list marker removes the marker, keeping the text.
    static func backspace(in text: String, selection: NSRange) -> TextEdit? {
        guard selection.length == 0 else { return nil }
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        guard let list = ListPrefix(line: line), selection.location == lineRange.location + list.length else { return nil }
        // Nested items outdent first; top-level items lose the marker.
        if list.level > 0 {
            let drop = min(2, list.indent.count)
            return TextEdit(range: NSRange(location: lineRange.location, length: drop), replacement: "", caret: selection.location - drop)
        }
        return TextEdit(range: NSRange(location: lineRange.location, length: list.length), replacement: "", caret: lineRange.location)
    }

    /// Tab / Shift-Tab on a list item nests or un-nests it.
    static func indent(in text: String, selection: NSRange, outdent: Bool) -> TextEdit? {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange)
        guard let list = ListPrefix(line: line) else { return nil }
        if outdent {
            let drop = min(2, list.indent.count)
            guard drop > 0 else { return nil }
            return TextEdit(range: NSRange(location: lineRange.location, length: drop), replacement: "", caret: max(lineRange.location, selection.location - drop))
        }
        return TextEdit(range: NSRange(location: lineRange.location, length: 0), replacement: "  ", caret: selection.location + 2)
    }

    /// Flips the checkbox on the line starting at `lineStart`.
    static func toggleCheckbox(in text: String, lineStart: Int) -> TextEdit? {
        let ns = text as NSString
        guard lineStart <= ns.length else { return nil }
        let lineRange = ns.lineRange(for: NSRange(location: lineStart, length: 0))
        let line = ns.substring(with: lineRange)
        guard let list = ListPrefix(line: line), let checked = list.checkbox else { return nil }
        let boxAt = (line as NSString).range(of: "[", options: [], range: NSRange(location: (list.indent as NSString).length, length: list.length - (list.indent as NSString).length))
        guard boxAt.location != NSNotFound else { return nil }
        let target = NSRange(location: lineRange.location + boxAt.location + 1, length: 1)
        return TextEdit(range: target, replacement: checked ? " " : "x", caret: -1)
    }

    /// How long a tick stays in place before the item moves, so you see it land.
    static let sortDelay: TimeInterval = 0.6

    /// Like Notes, ticked items sink below the open ones. Rewrites the run of
    /// checklist lines around `location`: open items first, ticked ones after,
    /// each group in its written order. Nil when it's already in that order or
    /// the list is nested (moving a parent would split it from its children).
    /// `caret` follows the text it was in.
    static func sortChecklist(in text: String, around location: Int, caret: Int) -> TextEdit? {
        let ns = text as NSString
        guard location <= ns.length else { return nil }
        var lines: [NSRange] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byLines, .substringNotRequired]) { _, _, r, _ in lines.append(r) }
        guard let here = lines.firstIndex(where: { NSLocationInRange(location, $0) || $0.location == location }) else { return nil }
        func item(_ i: Int) -> ListPrefix? {
            guard let p = ListPrefix(line: ns.substring(with: lines[i])), p.checkbox != nil else { return nil }
            return p
        }
        guard let mine = item(here) else { return nil }
        var lo = here, hi = here
        while lo > 0, let p = item(lo - 1), p.indent == mine.indent { lo -= 1 }
        while hi + 1 < lines.count, let p = item(hi + 1), p.indent == mine.indent { hi += 1 }
        // A nested line right after the run belongs to its last item: leave it alone.
        if hi + 1 < lines.count, let next = ListPrefix(line: ns.substring(with: lines[hi + 1])), next.level > mine.level { return nil }
        let run = Array(lo...hi)
        let order = run.filter { item($0)?.checkbox == false } + run.filter { item($0)?.checkbox == true }
        guard order != run else { return nil }
        // Every line keeps its own text; the last one may lack a newline.
        func body(_ i: Int) -> String { ns.substring(with: lines[i]).trimmingCharacters(in: .newlines) }
        let whole = NSRange(location: lines[lo].location, length: NSMaxRange(lines[hi]) - lines[lo].location)
        let trailing = ns.substring(with: whole).hasSuffix("\n") ? "\n" : ""
        let replacement = order.map(body).joined(separator: "\n") + trailing
        var newCaret = -1
        if let from = run.first(where: { NSLocationInRange(caret, lines[$0]) || (caret == NSMaxRange(lines[$0]) && $0 == hi) }) {
            let offset = min(caret - lines[from].location, (body(from) as NSString).length)
            var at = whole.location
            for i in order {
                if i == from { newCaret = at + offset; break }
                at += (body(i) as NSString).length + 1
            }
        }
        return TextEdit(range: whole, replacement: replacement, caret: newCaret)
    }

    /// The caret never sits inside a list line's hidden marker: it steps over it,
    /// forwards to the text, or back to the previous line when moving left.
    static func caretOutsideMarker(in text: String, selection: NSRange, previous: NSRange?) -> Int? {
        guard selection.length == 0 else { return nil }
        let ns = text as NSString
        guard selection.location <= ns.length else { return nil }
        let line = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        guard let p = ListPrefix(line: ns.substring(with: line)), !p.ordered else { return nil }
        let start = line.location + p.length
        guard selection.location < start else { return nil }
        if let previous, previous.length == 0, previous.location == start, line.location > 0 { return line.location - 1 }
        return start
    }

    /// Turns the caret's line into a checklist item, or back into plain text.
    static func toggleChecklist(in text: String, selection: NSRange) -> TextEdit {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        if let list = ListPrefix(line: line) {
            if list.checkbox != nil {
                return TextEdit(range: NSRange(location: lineRange.location, length: list.length), replacement: list.indent, caret: max(lineRange.location, selection.location - list.length + (list.indent as NSString).length))
            }
            let new = list.indent + "- [ ] "
            return TextEdit(range: NSRange(location: lineRange.location, length: list.length), replacement: new, caret: selection.location - list.length + (new as NSString).length)
        }
        return TextEdit(range: NSRange(location: lineRange.location, length: 0), replacement: "- [ ] ", caret: selection.location + 6)
    }

    /// Wraps the selection in <u>…</u>, or unwraps it.
    static func underline(in text: String, selection: NSRange) -> TextEdit {
        let ns = text as NSString
        var sel = selection
        if sel.length == 0, let w = wordRange(in: ns, at: sel.location) { sel = w }
        let selected = ns.substring(with: sel)
        if sel.location >= 3, NSMaxRange(sel) + 4 <= ns.length,
           ns.substring(with: NSRange(location: sel.location - 3, length: 3)).lowercased() == "<u>",
           ns.substring(with: NSRange(location: NSMaxRange(sel), length: 4)).lowercased() == "</u>" {
            return TextEdit(range: NSRange(location: sel.location - 3, length: sel.length + 7), replacement: selected, caret: sel.location - 3 + sel.length)
        }
        let wrapped = "<u>" + selected + "</u>"
        return TextEdit(range: sel, replacement: wrapped, caret: sel.length == 0 ? sel.location + 3 : sel.location + (wrapped as NSString).length)
    }

    /// Wraps the selection in a markdown delimiter, or unwraps it.
    static func wrap(in text: String, selection: NSRange, with token: String) -> TextEdit {
        let ns = text as NSString
        if selection.length == 0, let word = wordRange(in: ns, at: selection.location) {
            // No selection: act on the word under the caret.
            var e = wrap(in: text, selection: word, with: token)
            e.caret = selection.location + (e.replacement.count > word.length ? (token as NSString).length : -(token as NSString).length)
            return e
        }
        let t = (token as NSString).length
        let selected = ns.substring(with: selection)
        if selected.hasPrefix(token), selected.hasSuffix(token), selection.length >= t * 2 {
            let inner = (selected as NSString).substring(with: NSRange(location: t, length: selection.length - t * 2))
            return TextEdit(range: selection, replacement: inner, caret: selection.location + (inner as NSString).length)
        }
        if selection.location >= t, NSMaxRange(selection) + t <= ns.length,
           ns.substring(with: NSRange(location: selection.location - t, length: t)) == token,
           ns.substring(with: NSRange(location: NSMaxRange(selection), length: t)) == token {
            return TextEdit(range: NSRange(location: selection.location - t, length: selection.length + t * 2), replacement: selected, caret: selection.location - t + selection.length)
        }
        let wrapped = token + selected + token
        let caret = selection.length == 0 ? selection.location + t : selection.location + (wrapped as NSString).length
        return TextEdit(range: selection, replacement: wrapped, caret: caret)
    }

    static func wordRange(in ns: NSString, at location: Int) -> NSRange? {
        let letters = CharacterSet.alphanumerics
        func isWord(_ i: Int) -> Bool {
            guard i >= 0, i < ns.length, let u = Unicode.Scalar(ns.character(at: i)) else { return false }
            return letters.contains(u)
        }
        guard isWord(location) || isWord(location - 1) else { return nil }
        var a = location, b = location
        while isWord(a - 1) { a -= 1 }
        while isWord(b) { b += 1 }
        return NSRange(location: a, length: b - a)
    }

    enum LineStyle { case bulleted, dashed, numbered, quote }

    /// Format → Bulleted List / Dashed List / Numbered List / Block Quote, like Notes: the caret's line
    /// takes that style, switching from another list style; choosing the style it
    /// already has turns it back into body text.
    static func toggleLineStyle(in text: String, selection: NSRange, _ style: LineStyle) -> TextEdit {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        var indent = "", current: LineStyle?, prefixLen = 0
        if let q = line.range(of: #"^[ \t]*>[ \t]?"#, options: .regularExpression) {
            current = .quote
            prefixLen = (line[q] as Substring).utf16.count
        } else if let list = ListPrefix(line: line) {
            indent = list.indent
            current = list.ordered ? .numbered : list.checkbox != nil ? nil : list.marker == "-" ? .dashed : .bulleted
            prefixLen = list.length
        }
        let new: String
        if current == style {
            new = indent
        } else {
            switch style {
            case .bulleted: new = indent + "* "
            case .dashed: new = indent + "- "
            case .numbered: new = indent + "1. "
            case .quote: new = "> "
            }
        }
        let delta = (new as NSString).length - prefixLen
        return TextEdit(range: NSRange(location: lineRange.location, length: prefixLen), replacement: new, caret: max(lineRange.location + (new as NSString).length, selection.location + delta))
    }

    /// Sets the caret line's heading level (0 = body text).
    static func heading(in text: String, selection: NSRange, level: Int) -> TextEdit {
        let ns = text as NSString
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        var existing = 0
        while existing < line.count, line[line.index(line.startIndex, offsetBy: existing)] == "#" { existing += 1 }
        var prefixLen = existing
        if existing > 0, prefixLen < line.count, line[line.index(line.startIndex, offsetBy: prefixLen)] == " " { prefixLen += 1 }
        let newPrefix = level == 0 || level == existing ? "" : String(repeating: "#", count: level) + " "
        let delta = (newPrefix as NSString).length - prefixLen
        return TextEdit(range: NSRange(location: lineRange.location, length: prefixLen), replacement: newPrefix, caret: max(lineRange.location, selection.location + delta))
    }
}

/// A table or embed: one block in the text that the caret goes around.
struct EditorBlock: Equatable {
    /// The block's lines, without the final newline.
    var range: NSRange
    /// The grid's index when the block is a table.
    var grid: Int?

    /// Positions inside the block's hidden markdown, both ends included.
    func contains(_ location: Int) -> Bool { location >= range.location && location <= NSMaxRange(range) }

    static func find(in text: String) -> [EditorBlock] { NoteStructure(text).blocks }
}

/// What to do with a caret that landed where it can't be.
enum CaretFix: Equatable {
    case move(Int)
    /// A table or embed ends the note: add a line after it for the caret.
    case newLineAfter(Int)
    /// A table or embed starts the note: add a line before it.
    case newLineBefore(Int)
    case enterGrid(Int, GridCell)
}

/// A request for a grid to take the keyboard, at a cell.
struct GridFocusRequest: Equatable {
    var grid: Int
    var cell: GridCell
    var token = UUID()
}

/// Fenced code blocks, which never hold tables or embeds.
enum CodeRanges {
    static func find(in text: String) -> [NSRange] {
        let ns = text as NSString
        var out: [NSRange] = []
        var start: Int?
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in
            let t = ns.substring(with: r).trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("```") || t.hasPrefix("~~~") else { return }
            if let s = start { out.append(NSRange(location: s, length: NSMaxRange(r) - s)); start = nil } else { start = r.location }
        }
        return out
    }
}

/// What Delete does next to a block.
enum BlockDelete: Equatable {
    /// Mark the table (it shows selected); a second press removes it.
    case arm(Int)
    case delete(TextEdit)
}
