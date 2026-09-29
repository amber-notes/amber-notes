import Foundation
import Observation

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

/// What this device knows about AI edits, per note: the AI and time the server reported, the
/// edit you've seen, and the text from before one you haven't (for the tint and Undo).
///
/// Kept beside the library in its own file, not in the SwiftData model, so builds with and
/// without it open the same store.
@MainActor
@Observable
final class AIEditStore {
    struct Entry: Codable, Equatable {
        var editor: String?
        var editedAt: Date?
        var seenAt: Date?
        var previous: String?
    }

    static let shared = AIEditStore(file: PaneApp.isUnitTestHost || ProcessInfo.processInfo.arguments.contains("-uitest") ? nil : defaultFile)

    private(set) var entries: [UUID: Entry] = [:]
    @ObservationIgnored private let file: URL?
    @ObservationIgnored private var saving: Task<Void, Never>?

    /// `file` nil keeps everything in memory (tests, captures).
    init(file: URL?) {
        self.file = file
        if let file, let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([UUID: Entry].self, from: data) {
            entries = saved
        }
    }

    static var defaultFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "Pane/ai-edits.json")
    }

    subscript(id: UUID) -> Entry {
        get { entries[id] ?? Entry() }
        set {
            guard entries[id] != newValue else { return }
            entries[id] = newValue == Entry() ? nil : newValue
            save()
        }
    }

    /// Another account signed in, or this one was deleted.
    func forgetAll() {
        entries = [:]
        saving?.cancel()
        if let file { try? FileManager.default.removeItem(at: file) }
    }

    /// Written a moment after the last change, off the main thread.
    private func save() {
        guard let file else { return }
        saving?.cancel()
        let snapshot = entries
        saving = Task.detached(priority: .utility) {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, let data = try? JSONEncoder().encode(snapshot) else { return }
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }
}

extension Note {
    /// The connected AI that last changed this note, and when (from the server).
    @MainActor var aiEditor: String? {
        get { AIEditStore.shared[id].editor }
        set { AIEditStore.shared[id].editor = newValue }
    }
    @MainActor var aiEditedAt: Date? {
        get { AIEditStore.shared[id].editedAt }
        set { AIEditStore.shared[id].editedAt = newValue }
    }
    /// This device only: the AI edit you've already seen.
    @MainActor var aiSeenAt: Date? {
        get { AIEditStore.shared[id].seenAt }
        set { AIEditStore.shared[id].seenAt = newValue }
    }
    /// This device only: the text from before an AI edit you haven't seen yet.
    @MainActor var aiPrevious: String? {
        get { AIEditStore.shared[id].previous }
        set { AIEditStore.shared[id].previous = newValue }
    }
}
