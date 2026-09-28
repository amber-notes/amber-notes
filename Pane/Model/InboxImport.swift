import Foundation
import SwiftData

@MainActor
extension ModelContext {
    /// Files everything shared into Amber Notes as notes. Returns the new notes.
    @discardableResult
    func drainInbox() -> [Note] {
        var made: [Note] = []
        for (item, dir) in Inbox.pending() {
            let files = item.files.compactMap { try? FileStore.importFile(at: dir.appending(path: $0)) }
            files.forEach(insert)
            var body = item.markdown.trimmingCharacters(in: .whitespacesAndNewlines)
            if body.isEmpty, let f = files.first { body = (f.filename as NSString).deletingPathExtension }
            if !files.isEmpty { body += "\n\n" + files.map(\.markdown).joined(separator: "\n") }
            let note = createNote(in: .all, body: body + "\n")
            note.createdAt = item.createdAt
            made.append(note)
            Inbox.remove(dir)
        }
        if !made.isEmpty { try? save() }
        return made
    }
}
