import AppIntents
import SwiftData

/// Shortcuts and Siri: read a note, and add to one. Locked notes stay out of reach.
struct NoteEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Note"
    static let defaultQuery = NoteQuery()
    var id: UUID
    var title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

    init(_ n: Note) { id = n.id; title = n.title }
}

struct NoteQuery: EntityStringQuery {
    @MainActor private func live() -> [Note] {
        guard let c = PaneApp.sharedContainer else { return [] }
        let all = (try? c.mainContext.fetch(FetchDescriptor<Note>(sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]))) ?? []
        return all.filter { $0.deletedAt == nil && $0.trashedAt == nil }
    }

    @MainActor func entities(for identifiers: [UUID]) async throws -> [NoteEntity] {
        live().filter { identifiers.contains($0.id) }.map(NoteEntity.init)
    }

    @MainActor func entities(matching string: String) async throws -> [NoteEntity] {
        live().filter { $0.title.localizedCaseInsensitiveContains(string) }.prefix(30).map(NoteEntity.init)
    }

    @MainActor func suggestedEntities() async throws -> [NoteEntity] {
        live().prefix(20).map(NoteEntity.init)
    }
}

enum NoteIntentError: Error, CustomLocalizedStringResourceConvertible {
    case gone, locked
    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .gone: "That note isn't in Pinto Notes any more."
        case .locked: "That note is locked. Open it in Pinto Notes."
        }
    }
}

struct ReadNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Read Note"
    static let description = IntentDescription("Gets a note's text, as markdown.")
    @Parameter(title: "Note") var note: NoteEntity

    @MainActor func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let n = try NoteIntents.find(note.id) else { throw NoteIntentError.gone }
        guard !n.isLocked else { throw NoteIntentError.locked }
        return .result(value: n.body)
    }
}

struct AppendToNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to Note"
    static let description = IntentDescription("Adds text to the end of a note, as a new line.")
    @Parameter(title: "Note") var note: NoteEntity
    @Parameter(title: "Text", inputOptions: String.IntentInputOptions(multiline: true)) var text: String

    static var parameterSummary: some ParameterSummary { Summary("Add \(\.$text) to \(\.$note)") }

    @MainActor func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let n = try NoteIntents.find(note.id) else { throw NoteIntentError.gone }
        guard !n.isLocked else { throw NoteIntentError.locked }
        n.body = NoteIntents.appending(text, to: n.body)
        n.touch()
        try? n.modelContext?.save()
        return .result(value: n.body)
    }
}

@MainActor
enum NoteIntents {
    static func find(_ id: UUID) throws -> Note? {
        guard let c = PaneApp.sharedContainer else { return nil }
        let n = try c.mainContext.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.id == id })).first
        return n?.deletedAt == nil ? n : nil
    }

    /// The text on its own line at the end, the note's last newline kept.
    nonisolated static func appending(_ text: String, to body: String) -> String {
        let add = text.trimmingCharacters(in: .newlines)
        guard !add.isEmpty else { return body }
        if body.isEmpty { return add + "\n" }
        return (body.hasSuffix("\n") ? body : body + "\n") + add + "\n"
    }
}

struct AmberShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AppendToNoteIntent(), phrases: ["Add to a note in \(.applicationName)"], shortTitle: "Add to Note", systemImageName: "text.append")
        AppShortcut(intent: ReadNoteIntent(), phrases: ["Read a note in \(.applicationName)"], shortTitle: "Read Note", systemImageName: "doc.text")
    }
}
