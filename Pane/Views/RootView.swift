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
    @State private var showImport = false
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
        .focusedSceneValue(\.editorController, editor)
        .focusedSceneValue(\.importAction, { showImport = true })
        #if os(macOS)
        .sheet(isPresented: $showImport) { AppleNotesImportView() }
        #endif
        .focusedSceneValue(\.deleteNoteAction, deleteAction)
    }

    private var deleteAction: (() -> Void)? {
        guard selectedNote != nil else { return nil }
        return { deleteSelected() }
    }

    private func deleteSelected() {
        guard let id = selectedNote, let n = context.note(id) else { return }
        withAnimation(.snappy(duration: 0.25)) {
            if n.trashedAt == nil { context.trash(n) } else { context.purge(n) }
            selectedNote = nil
        }
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

private struct DeleteNoteActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

private struct ImportActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

private struct EditorControllerKey: FocusedValueKey {
    typealias Value = EditorController
}

extension FocusedValues {
    var newNoteAction: (() -> Void)? {
        get { self[NewNoteActionKey.self] }
        set { self[NewNoteActionKey.self] = newValue }
    }
    var deleteNoteAction: (() -> Void)? {
        get { self[DeleteNoteActionKey.self] }
        set { self[DeleteNoteActionKey.self] = newValue }
    }
    var importAction: (() -> Void)? {
        get { self[ImportActionKey.self] }
        set { self[ImportActionKey.self] = newValue }
    }
    var editorController: EditorController? {
        get { self[EditorControllerKey.self] }
        set { self[EditorControllerKey.self] = newValue }
    }
}

#if os(macOS)
struct PaneCommands: Commands {
    @FocusedValue(\.newNoteAction) private var newNote
    @FocusedValue(\.deleteNoteAction) private var deleteNote
    @FocusedValue(\.editorController) private var editor
    @FocusedValue(\.importAction) private var importNotes

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Note") { newNote?() }
                .keyboardShortcut("n")
                .disabled(newNote == nil)
        }
        CommandGroup(replacing: .importExport) {
            Button("Import from Apple Notes…") { importNotes?() }
                .disabled(importNotes == nil)
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Delete Note") { deleteNote?() }
                .keyboardShortcut(.delete, modifiers: .command)
                .disabled(deleteNote == nil)
        }
        CommandMenu("Format") {
            Button("Title") { editor?.heading(1) }.keyboardShortcut("1", modifiers: [.command, .shift])
            Button("Heading") { editor?.heading(2) }.keyboardShortcut("2", modifiers: [.command, .shift])
            Button("Subheading") { editor?.heading(3) }.keyboardShortcut("3", modifiers: [.command, .shift])
            Button("Body") { editor?.heading(0) }.keyboardShortcut("0", modifiers: [.command, .shift])
            Divider()
            Button("Bold") { editor?.bold() }.keyboardShortcut("b")
            Button("Italic") { editor?.italic() }.keyboardShortcut("i")
            Button("Strikethrough") { editor?.strikethrough() }.keyboardShortcut("x", modifiers: [.command, .shift])
            Button("Code") { editor?.code() }.keyboardShortcut("k", modifiers: [.command, .shift])
            Divider()
            Button("Checklist") { editor?.checklist() }.keyboardShortcut("l", modifiers: [.command, .shift])
            Button("Bulleted List") { editor?.bulletList() }.keyboardShortcut("7", modifiers: [.command, .shift])
            Button("Table") { editor?.insertTable() }.keyboardShortcut("t", modifiers: [.command, .option])
            Button("Card") { editor?.newCard() }.keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Link") { editor?.insertLink() }.keyboardShortcut("k")
        }
    }
}
#endif
