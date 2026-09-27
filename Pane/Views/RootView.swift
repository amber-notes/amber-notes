import SwiftData
import SwiftUI

/// Three columns, like Apple Notes: folders, notes, the note.
struct RootView: View {
    @Environment(\.modelContext) private var context
    @State private var scope: Scope? = .all
    @State private var selectedNote: UUID?
    @State private var visibility: NavigationSplitViewVisibility = .all
    @State private var editor = EditorController()
    @State private var justCreated: UUID?
    @AppStorage("lastScope") private var lastScopeData: Data = Data()

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            SidebarView(scope: $scope, onNewNote: newNote)
                .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
        } content: {
            NoteListView(scope: scope ?? .all, selection: $selectedNote, onNewNote: newNote)
                .navigationSplitViewColumnWidth(min: 260, ideal: 310, max: 420)
        } detail: {
            if let id = selectedNote, let note = context.note(id), note.deletedAt == nil {
                NoteDetailView(note: note, controller: editor, autofocus: justCreated == id, onNewNote: newNote)
                    .id(id)
            } else {
                EmptyDetailView()
            }
        }
        .environment(editor)
        .onAppear(perform: restoreScope)
        .onChange(of: scope) { _, new in
            if let new, let data = try? JSONEncoder().encode(new) { lastScopeData = data }
        }
        .onChange(of: selectedNote) { old, _ in discardIfEmpty(old) }
        .focusedSceneValue(\.newNoteAction, newNote)
    }

    private func newNote() {
        let target: Scope = scope == .trash ? .all : (scope ?? .all)
        if scope == .trash { scope = .all }
        // Reuse an untouched empty note instead of stacking blanks.
        if let id = selectedNote, let n = context.note(id), n.body.isEmpty, n.trashedAt == nil {
            editor.focus()
            return
        }
        let note = context.createNote(in: target)
        justCreated = note.id
        withAnimation(.snappy(duration: 0.25)) { selectedNote = note.id }
    }

    /// Leaving a blank note deletes it, like Apple Notes.
    private func discardIfEmpty(_ id: UUID?) {
        guard let id, id != selectedNote, let n = context.note(id), n.deletedAt == nil,
              n.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        context.purge(n)
    }

    private func restoreScope() {
        if let s = try? JSONDecoder().decode(Scope.self, from: lastScopeData) {
            if case .folder(let id) = s, context.folder(id) == nil { return }
            scope = s
        }
    }
}

struct EmptyDetailView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "note.text")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.tertiary)
            Text("No note selected")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: Focused actions for menus and shortcuts

private struct NewNoteActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    var newNoteAction: (() -> Void)? {
        get { self[NewNoteActionKey.self] }
        set { self[NewNoteActionKey.self] = newValue }
    }
}

#if os(macOS)
struct PaneCommands: Commands {
    @FocusedValue(\.newNoteAction) private var newNote

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Note") { newNote?() }
                .keyboardShortcut("n")
                .disabled(newNote == nil)
        }
    }
}
#endif
