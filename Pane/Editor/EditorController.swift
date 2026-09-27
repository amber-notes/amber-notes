import Foundation
import Observation

/// Lets toolbars and menus drive whichever editor is on screen.
@MainActor
@Observable
final class EditorController {
    /// Set by the platform text view while it is on screen.
    @ObservationIgnored weak var target: (any EditorTarget)?
    var isEditing = false
    /// A card waiting to be created or edited in the card sheet.
    var cardRequest: CardEditRequest?

    func perform(_ make: (String, NSRange) -> TextEdit?) {
        guard let t = target else { return }
        if let edit = make(t.currentText, t.currentSelection) { t.apply(edit) }
    }

    func bold() { perform { ListEditing.wrap(in: $0, selection: $1, with: "**") } }
    func italic() { perform { ListEditing.wrap(in: $0, selection: $1, with: "*") } }
    func strikethrough() { perform { ListEditing.wrap(in: $0, selection: $1, with: "~~") } }
    func code() { perform { ListEditing.wrap(in: $0, selection: $1, with: "`") } }
    func checklist() { perform { ListEditing.toggleChecklist(in: $0, selection: $1) } }
    func heading(_ level: Int) { perform { ListEditing.heading(in: $0, selection: $1, level: level) } }

    func bulletList() {
        perform { text, sel in
            let ns = text as NSString
            let line = ns.lineRange(for: NSRange(location: sel.location, length: 0))
            let s = ns.substring(with: line)
            if let list = ListPrefix(line: s) {
                return TextEdit(range: NSRange(location: line.location, length: list.length), replacement: list.indent, caret: max(line.location, sel.location - list.length))
            }
            return TextEdit(range: NSRange(location: line.location, length: 0), replacement: "- ", caret: sel.location + 2)
        }
    }

    func insertTable() {
        perform { text, sel in
            let ns = text as NSString
            let line = ns.lineRange(for: NSRange(location: sel.location, length: 0))
            let atEmpty = ns.substring(with: line).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let lead = atEmpty || sel.location == 0 ? "" : "\n\n"
            let table = "| Column | Column |\n| --- | --- |\n|  |  |\n"
            let insertAt = atEmpty ? line.location : NSMaxRange(line)
            let body = lead + table
            // Caret lands in the first header cell.
            return TextEdit(range: NSRange(location: insertAt, length: 0), replacement: body, caret: insertAt + (lead as NSString).length + 2)
        }
    }

    func insertLink() {
        perform { text, sel in
            let selected = (text as NSString).substring(with: sel)
            let body = "[\(selected.isEmpty ? "link" : selected)](https://)"
            return TextEdit(range: sel, replacement: body, caret: sel.location + (body as NSString).length - 1)
        }
    }

    func focus() { target?.focusEditor() }

    func newCard() { cardRequest = CardEditRequest(index: nil, title: "", content: "") }

    func saveCard(_ request: CardEditRequest, title: String, content: String) {
        target?.saveCard(index: request.index, markdown: CardBlocks.markdown(title: title, content: content))
    }
}

struct CardEditRequest: Identifiable {
    let id = UUID()
    /// nil for a new card.
    var index: Int?
    var title: String
    var content: String
}

@MainActor
protocol EditorTarget: AnyObject {
    var currentText: String { get }
    var currentSelection: NSRange { get }
    func apply(_ edit: TextEdit)
    func focusEditor()
    func saveCard(index: Int?, markdown: String)
}
