import Foundation
import SwiftData

/// A folder of notes. Folders nest, like Apple Notes.
@Model
final class Folder {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    var updatedAt: Date
    var sortIndex: Double
    var parent: Folder?
    @Relationship(deleteRule: .cascade, inverse: \Folder.parent) var children: [Folder] = []
    @Relationship(deleteRule: .nullify, inverse: \Note.folder) var notes: [Note] = []
    /// Soft delete, so sync can carry the deletion to other devices.
    var deletedAt: Date?
    /// Changed here and not yet pushed.
    var dirty: Bool = true
    /// The server's version when we last synced; 0 = never uploaded.
    var serverVersion: Int64 = 0

    init(name: String, parent: Folder? = nil, sortIndex: Double = 0) {
        id = UUID()
        self.name = name
        createdAt = .now
        updatedAt = .now
        self.sortIndex = sortIndex
        self.parent = parent
    }

    var liveChildren: [Folder] {
        children.filter { $0.deletedAt == nil }.sorted { $0.sortIndex < $1.sortIndex }
    }

    var liveNotes: [Note] { notes.filter { $0.trashedAt == nil && $0.deletedAt == nil } }

    /// Marks a local change for sync.
    @MainActor func touch() {
        updatedAt = .now
        dirty = true
        SyncSignal.changed()
    }
}

/// A note. The body is the whole markdown source; the title is its first line.
@Model
final class Note {
    @Attribute(.unique) var id: UUID
    var body: String
    var createdAt: Date
    var updatedAt: Date
    var isPinned: Bool
    var folder: Folder?
    /// Set for a sub-note: the note that links to it.
    var parentID: UUID?
    /// Moved to Recently Deleted. Purged after 30 days.
    var trashedAt: Date?
    /// Gone for good; kept only as a tombstone for sync.
    var deletedAt: Date?
    /// Changed here and not yet pushed.
    var dirty: Bool = true
    /// The server's version when we last synced; 0 = never uploaded.
    var serverVersion: Int64 = 0
    init(body: String = "", folder: Folder? = nil) {
        id = UUID()
        self.body = body
        createdAt = .now
        updatedAt = .now
        isPinned = false
        self.folder = folder
    }

    /// Marks a local change for sync.
    @MainActor func touch() {
        updatedAt = .now
        dirty = true
        SyncSignal.changed()
    }

    var title: String { NoteText.summary(of: self).title }
    var preview: String { NoteText.summary(of: self).preview }
}

/// Lets model changes nudge the sync engine without depending on it.
@MainActor
enum SyncSignal {
    static var onChange: (() -> Void)?
    static func changed() { onChange?() }
}

/// Plain-text helpers shared by the list, search and the AI tools.
enum NoteText {
    private struct Summary { var stamp: Date; var length: Int; var title: String; var preview: String }
    nonisolated(unsafe) private static var summaries: [UUID: Summary] = [:]

    /// A note's title and preview, worked out again only when the note changes:
    /// the list shows them for every note on every update.
    static func summary(of note: Note) -> (title: String, preview: String) {
        let body = note.body
        let length = body.utf16.count
        if let s = summaries[note.id], s.stamp == note.updatedAt, s.length == length { return (s.title, s.preview) }
        let lines = firstLines(of: body, count: 2)
        let title = lines.first ?? "New Note"
        let preview = lines.count > 1 ? lines[1] : "No additional text"
        summaries[note.id] = Summary(stamp: note.updatedAt, length: length, title: title, preview: preview)
        return (title, preview)
    }

    static func title(of body: String) -> String {
        firstLines(of: body, count: 1).first ?? "New Note"
    }

    static func preview(of body: String) -> String {
        let lines = firstLines(of: body, count: 2)
        return lines.count > 1 ? lines[1] : "No additional text"
    }

    /// The first `count` lines that still say something once markup is stripped.
    /// Reads only as far as it needs: the list asks for every note on every update.
    static func firstLines(of body: String, count: Int) -> [String] {
        var out: [String] = []
        var rest = body[...]
        while out.count < count, !rest.isEmpty {
            // Found by byte, not by character: walking grapheme clusters (emoji families,
            // zalgo) across a huge line is slow.
            let end = rest.utf8.firstIndex(of: UInt8(ascii: "\n")) ?? rest.endIndex
            // A title is at most 300 characters (as on the server), so a megabyte-long first
            // line costs no more than a short one.
            // Capped by scalar, not character: one "character" can carry thousands of combining marks.
            let line = Substring(rest[..<end].unicodeScalars.prefix(2000))
            rest = end < rest.endIndex ? rest[rest.index(after: end)...] : rest[rest.endIndex...]
            guard !line.allSatisfy({ $0 == " " || $0 == "\t" }) else { continue }
            let cleaned = stripMarkup(String(line))
            if !cleaned.isEmpty { out.append(String(String(cleaned.unicodeScalars.prefix(600)).prefix(300))) }
        }
        return out
    }

    /// Removes the markdown syntax that should not show in a one-line summary.
    static func stripMarkup(_ line: String) -> String {
        // Tags such as <u>, <details> and <summary> never show in a summary.
        var s = line.replacingOccurrences(of: #"</?[a-zA-Z][^>]*>"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        for prefix in ["###### ", "##### ", "#### ", "### ", "## ", "# ", "> ", "- [ ] ", "- [x] ", "- [X] ", "- ", "* ", "+ "] where s.hasPrefix(prefix) {
            s.removeFirst(prefix.count)
            break
        }
        if let r = s.range(of: #"^\d+[.)] "#, options: .regularExpression) { s.removeSubrange(r) }
        if s.hasPrefix("```") || s.allSatisfy({ "-*_|:= ".contains($0) }) { return "" }
        s = s.replacingOccurrences(of: #"\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        for token in ["**", "__", "~~", "`"] { s = s.replacingOccurrences(of: token, with: "") }
        s = s.replacingOccurrences(of: #"(?<![\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])"#, with: "$1", options: .regularExpression)
        if s.hasPrefix("|") { s = s.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: "  ") }
        return s.trimmingCharacters(in: .whitespaces)
    }
}
