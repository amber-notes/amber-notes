import Foundation

/// An AI's edit arriving on a note, and whether you've seen it yet.
///
/// The server names the AI that last changed a note (`ai_editor`, `ai_edited_at`). When a newer
/// AI edit arrives, this device keeps the text from before it, so the open note can tint what
/// changed and offer Undo, and the list can mark the note until you open it.
@MainActor
enum AIEdit {
    /// Call after a server row was applied to `note`. `previousBody` and `previousEditAt` are what
    /// the note held before (nil for a note this device didn't have). `quiet`: the first sync of a
    /// library, where old AI edits are history, not news.
    static func arrived(_ note: Note, previousBody: String?, previousEditAt: Date?, quiet: Bool) {
        guard let at = note.aiEditedAt, note.aiEditor != nil, at > (previousEditAt ?? .distantPast) else { return }
        if quiet || previousBody == note.body {
            note.aiSeenAt = at
            return
        }
        // Several edits before you look: compare against the text before the first of them.
        if note.aiPrevious == nil { note.aiPrevious = previousBody ?? "" }
    }

    /// An AI changed the note and you haven't opened it since.
    static func isUnseen(_ note: Note) -> Bool {
        guard note.aiEditor != nil, let at = note.aiEditedAt else { return false }
        return note.aiSeenAt.map { $0 < at } ?? true
    }

    /// You've opened it: the list marker goes. Returns what the receipt and tint need, once.
    static func markSeen(_ note: Note) -> Receipt? {
        guard isUnseen(note), let by = note.aiEditor, let at = note.aiEditedAt else { return nil }
        let previous = note.aiPrevious
        note.aiSeenAt = at
        note.aiPrevious = nil
        guard let previous, previous != note.body else { return nil }
        return Receipt(noteID: note.id, by: by, at: at, previous: previous,
                       lines: ChangeTint.changedLines(from: previous, to: note.body).count)
    }

    /// Puts the note back the way it was before the AI's edit; it syncs up like any edit of yours.
    static func undo(_ receipt: Receipt, on note: Note) {
        guard note.id == receipt.noteID else { return }
        note.body = receipt.previous
        note.touch()
    }

    struct Receipt: Equatable {
        var noteID: UUID
        var by: String
        var at: Date
        /// The note before the edit, for Undo.
        var previous: String
        /// How many lines it added or changed.
        var lines: Int

        var summary: String {
            lines == 0 ? "Updated by \(by)" : "\(by) changed \(lines == 1 ? "1 line" : "\(lines) lines")"
        }
    }
}
