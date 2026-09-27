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
        guard let list = ListPrefix(line: line), selection.location >= lineRange.location + list.length else { return nil }

        let content = (line as NSString).substring(from: list.length)
        if content.trimmingCharacters(in: .whitespaces).isEmpty {
            // Empty item: outdent one level, or leave the list.
            if list.level > 0 {
                let newIndent = String(list.indent.dropFirst(min(2, list.indent.count)))
                let replacement = newIndent + String(line.dropFirst(list.indent.count))
                return TextEdit(range: NSRange(location: lineRange.location, length: (line as NSString).length), replacement: replacement, caret: lineRange.location + (replacement as NSString).length)
            }
            return TextEdit(range: NSRange(location: lineRange.location, length: (line as NSString).length), replacement: "", caret: lineRange.location)
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

    /// Wraps the selection in a markdown delimiter, or unwraps it.
    static func wrap(in text: String, selection: NSRange, with token: String) -> TextEdit {
        let ns = text as NSString
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
