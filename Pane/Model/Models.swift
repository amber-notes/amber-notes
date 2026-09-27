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
    /// Moved to Recently Deleted. Purged after 30 days.
    var trashedAt: Date?
    /// Gone for good; kept only as a tombstone for sync.
    var deletedAt: Date?

    init(body: String = "", folder: Folder? = nil) {
        id = UUID()
        self.body = body
        createdAt = .now
        updatedAt = .now
        isPinned = false
        self.folder = folder
    }

    var title: String { NoteText.title(of: body) }
    var preview: String { NoteText.preview(of: body) }
}

/// Plain-text helpers shared by the list, search and the AI tools.
enum NoteText {
    static func title(of body: String) -> String {
        for line in body.split(separator: "\n", omittingEmptySubsequences: true) {
            let cleaned = stripMarkup(String(line))
            if !cleaned.isEmpty { return cleaned }
        }
        return "New Note"
    }

    static func preview(of body: String) -> String {
        var seenTitle = false
        for line in body.split(separator: "\n", omittingEmptySubsequences: true) {
            let cleaned = stripMarkup(String(line))
            if cleaned.isEmpty { continue }
            if !seenTitle { seenTitle = true; continue }
            return cleaned
        }
        return "No additional text"
    }

    /// Removes the markdown syntax that should not show in a one-line summary.
    static func stripMarkup(_ line: String) -> String {
        var s = line.trimmingCharacters(in: .whitespaces)
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
