import Foundation
import Observation
import UniformTypeIdentifiers

/// Lets toolbars and menus drive whichever editor is on screen.
@MainActor
@Observable
final class EditorController {
    /// Set by the platform text view while it is on screen.
    @ObservationIgnored weak var target: (any EditorTarget)?
    var isEditing = false
    /// A typed-table row waiting to be added or edited.
    var tableRequest: TableRowRequest?
    /// The file being shown in Quick Look.
    var previewURL: URL?
    /// Files being fetched from the server.
    var downloading: Set<UUID> = []
    /// Looks up a file by id (set by the note screen, which has the model context).
    @ObservationIgnored var resolveAttachment: (UUID) -> Attachment? = { _ in nil }
    /// Copies files into Pane (set by the note screen, which has the model context).
    @ObservationIgnored var addFiles: ([URL]) -> [Attachment] = { _ in [] }
    @ObservationIgnored var addData: (Data, String, UTType) -> Attachment? = { _, _, _ in nil }
    /// Opens the file picker (set by the note screen).
    @ObservationIgnored var attach: () -> Void = {}
    /// Fetches a file that isn't on this device yet.
    @ObservationIgnored var download: @MainActor (Attachment) async -> Bool = { _ in false }

    func openAttachment(_ id: UUID) {
        guard let a = resolveAttachment(id) else { return }
        let url = FileStore.url(for: a.id, filename: a.filename)
        if FileStore.exists(a) { previewURL = url; return }
        downloading.insert(id)
        Task {
            let ok = await download(a)
            downloading.remove(id)
            if ok { previewURL = url }
        }
    }

    /// Inserts embed lines for files at the caret, each on its own line.
    func insertFiles(_ files: [Attachment]) {
        guard !files.isEmpty else { return }
        insertLines(files.map(\.markdown))
    }

    /// Inserts whole lines (embeds, links) at the caret, each on its own line.
    func insertLines(_ lines: [String]) {
        guard !lines.isEmpty else { return }
        perform { text, sel in
            let ns = text as NSString
            let line = ns.lineRange(for: NSRange(location: min(sel.location, ns.length), length: 0))
            let lineText = ns.substring(with: line).trimmingCharacters(in: .whitespacesAndNewlines)
            let block = lines.joined(separator: "\n")
            if lineText.isEmpty {
                let body = block + "\n"
                return TextEdit(range: NSRange(location: line.location, length: line.length), replacement: body + (NSMaxRange(line) < ns.length && !ns.substring(with: line).hasSuffix("\n") ? "\n" : ""), caret: line.location + (body as NSString).length)
            }
            let at = NSMaxRange(line)
            let lead = ns.substring(with: line).hasSuffix("\n") ? "" : "\n"
            let body = lead + block + "\n"
            return TextEdit(range: NSRange(location: at, length: 0), replacement: body, caret: at + (body as NSString).length)
        }
    }

    func perform(_ make: (String, NSRange) -> TextEdit?) {
        guard let t = target else { return }
        if let edit = make(t.currentText, t.currentSelection) { t.apply(edit) }
    }

    func bold() { perform { ListEditing.wrap(in: $0, selection: $1, with: "**") } }
    func italic() { perform { ListEditing.wrap(in: $0, selection: $1, with: "*") } }
    func underline() { perform { ListEditing.underline(in: $0, selection: $1) } }
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

    /// Inserts an empty 2×2 table and puts the keyboard in its first cell.
    func insertTable() {
        target?.insertGrid()
    }

    func insertLink() {
        perform { text, sel in
            let selected = (text as NSString).substring(with: sel)
            let body = "[\(selected.isEmpty ? "link" : selected)](https://)"
            return TextEdit(range: sel, replacement: body, caret: sel.location + (body as NSString).length - 1)
        }
    }

    func focus() { target?.focusEditor() }

    /// A sub-note's current title and first line (set by the note screen).
    @ObservationIgnored var resolveNote: (UUID) -> (title: String, preview: String)? = { _ in nil }
    /// Opens a note by id (set by the note screen).
    @ObservationIgnored var openNote: (UUID) -> Void = { _ in }
    /// Creates a sub-note linked from here (set by the note screen).
    @ObservationIgnored var newSubNote: () -> Void = {}
}

struct TableRowRequest: Identifiable {
    let id = UUID()
    var tableIndex: Int
    /// nil for a new row.
    var rowIndex: Int?
    var columns: [TypedTable.Column]
    var values: [String]
}

extension EditorController {
    /// Writes a row back into the table's markdown (nil values deletes the row).
    func saveRow(_ r: TableRowRequest, values: [String]?) {
        perform { text, _ in
            let all = TypedTable.find(in: text)
            guard r.tableIndex < all.count else { return nil }
            var t = all[r.tableIndex]
            if let values {
                if let i = r.rowIndex, i < t.rows.count { t.rows[i] = values } else { t.rows.append(values) }
                // Keep dated rows in order.
                if let col = t.columns.firstIndex(where: { $0.type == .date }) {
                    t.rows.sort { $0[col] < $1[col] }
                }
            } else if let i = r.rowIndex, i < t.rows.count {
                t.rows.remove(at: i)
            }
            return TextEdit(range: t.range, replacement: t.markdown, caret: -1)
        }
    }
}


@MainActor
protocol EditorTarget: AnyObject {
    var currentText: String { get }
    var currentSelection: NSRange { get }
    func apply(_ edit: TextEdit)
    func focusEditor()
    func insertGrid()
}
