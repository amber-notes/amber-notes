import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct NoteListView: View {
    @Environment(\.modelContext) private var context
    let scope: Scope
    /// Several notes can be selected (⌘-click, ⇧-click, ⌘A on the Mac; Select on iPhone).
    @Binding var selection: Set<UUID>
    let onNewNote: () -> Void
    #if os(iOS)
    @State private var editMode: EditMode = .inactive
    #endif

    @Query(sort: \Note.updatedAt, order: .reverse) private var notes: [Note]
    @State private var search = ""
    @State private var fileDropTargeted = false
    @State private var collapsed: Set<String> = []
    /// Notes waiting for "Delete Forever" to be confirmed.
    @State private var pendingForever: Set<UUID>?
    @FocusedValue(\.importAction) private var importNotes
    @FocusedValue(\.importSheetAction) private var importSheet
    @Environment(SetupStore.self) private var setup: SetupStore?
    @Environment(Backend.self) private var backend: Backend?
    @State private var connecting = false
    @State private var sharingHowTo = false

    /// "Get set up" sits on top of the list for a new account, never in Recently Deleted or a search.
    private var showsSetup: Bool { (setup?.visible ?? false) && scope != .trash && search.isEmpty }

    private var scoped: [Note] {
        notes.filter { n in
            guard n.deletedAt == nil else { return false }
            // Sub-notes live inside their parent, not in the list. (Few notes have a
            // parent, so looking each one up is cheaper than indexing every note.)
            if n.parentID != nil, context.isNested(n) { return false }
            switch scope {
            case .all: return n.trashedAt == nil
            case .trash: return n.trashedAt != nil
            case .folder(let id): return n.trashedAt == nil && n.folder?.id == id
            }
        }
    }

    private var filtered: [Note] { filtered(from: scoped) }

    private func filtered(from scoped: [Note]) -> [Note] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return scoped }
        let base = scope == .trash ? scoped : notes.filter { $0.deletedAt == nil && $0.trashedAt == nil }
        return base.filter { $0.body.localizedStandardContains(q) }
    }

    private var title: String {
        switch scope {
        case .all: "All Notes"
        case .trash: "Recently Deleted"
        case .folder(let id): context.folder(id)?.name ?? "Notes"
        }
    }

    var body: some View {
        // Worked out once per update and handed down: the list asks many times.
        let scopedNotes = scoped
        let visible = filtered(from: scopedNotes)
        let folders = context.allFolders().sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        return list(scopedNotes, visible, folders)
    }

    private func list(_ scopedNotes: [Note], _ visible: [Note], _ folders: [Folder]) -> some View {
        List(selection: $selection) {
            if showsSetup, let setup, let progress = setup.progress {
                #if os(iOS)
                // Its own grouped section, so it has the list's insets, radius and ground.
                Section {
                    setupCard(setup, progress)
                        .padding(.vertical, 4)
                        .selectionDisabled()
                }
                #else
                setupCard(setup, progress)
                    .listRowInsets(EdgeInsets(top: 6, leading: 10, bottom: 10, trailing: 10))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
                #endif
            }
            if scope == .trash && !scopedNotes.isEmpty && search.isEmpty {
                Text("Notes are deleted forever after 30 days.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
            }
            ForEach(DateBucket.sections(visible), id: \.0) { section in
                Section(isExpanded: Binding(
                    get: { !collapsed.contains(section.0) },
                    set: { open in withAnimation(.snappy(duration: 0.22)) { if open { collapsed.remove(section.0) } else { collapsed.insert(section.0) } } }
                )) {
                    ForEach(section.1) { note in
                        // Its own equatable view: when one note changes, the others' rows (and their
                        // drag and swipe setup) are left alone instead of rebuilt.
                        ListRow(note: note, query: search, showFolder: scope == .all || !search.isEmpty,
                                dragWith: dragOthers(for: note), selectedCount: selection.count,
                                togglePin: { withAnimation(.snappy) { context.togglePin(note) } },
                                remove: { remove(note) })
                            .equatable()
                            .tag(note.id)
                    }
                } header: {
                    #if os(iOS)
                    // The system's prominent header: large, bold and in the label colour, as in Notes.
                    Text(section.0)
                    #else
                    Text(section.0)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.primary)
                        .textCase(nil)
                    #endif
                }
                #if os(iOS)
                .headerProminence(.increased)
                #endif
            }
            #if os(iOS)
            // The count, quietly at the end of the list, as in Notes.
            if !visible.isEmpty && search.isEmpty {
                Section {} footer: {
                    Text(scopedNotes.count == 1 ? "1 Note" : "\(scopedNotes.count) Notes")
                        .font(.footnote)
                        .monospacedDigit()
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("list.count")
                }
            }
            #endif
        }
        // Right-click acts on the whole selection when the row is part of it, like Notes.
        .contextMenu(forSelectionType: UUID.self) { ids in
            menu(for: ids, folders: folders)
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        .environment(\.editMode, $editMode)
        #endif
        .overlay {
            // The setup card is the empty state for a new account.
            if visible.isEmpty && !showsSetup { emptyState }
        }
        .sheet(isPresented: $connecting, onDismiss: { Task { await setup?.refresh(force: true) } }) {
            if let client = backend?.client { ConnectAISheet(client: client) }
        }
        #if os(iOS)
        .sheet(isPresented: $sharingHowTo) { ShareHowToSheet() }
        #endif
        .onChange(of: setup?.progress?.needsToDoNote ?? false) { _, needs in
            if needs { ensureToDoNote() }
        }
        .overlay {
            if fileDropTargeted {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(0.7), style: StrokeStyle(lineWidth: 2, dash: [7, 5]))
                    .padding(8)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            let made = context.importFiles(urls, into: scope == .trash ? .all : scope)
            if let first = made.first { selection = [first.id] }
            return !made.isEmpty
        } isTargeted: { t in
            withAnimation(.easeOut(duration: 0.15)) { fileDropTargeted = t }
        }
        #if os(iOS)
        // iOS 26 Notes and Mail: a full search field in the bottom bar, beside compose.
        .searchable(text: $search, prompt: "Search")
        .searchToolbarBehavior(.automatic)
        #else
        .searchable(text: $search, placement: .toolbar, prompt: "Search")
        #endif
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        // No count subtitle: on iOS 26 a subtitle makes the large title open collapsed when the list is pushed again.
        #endif
        #if os(macOS)
        .navigationSubtitle("")
        #endif
        .confirmationDialog(foreverTitle, isPresented: Binding(get: { pendingForever != nil }, set: { if !$0 { pendingForever = nil } }), titleVisibility: .visible) {
            Button("Delete Forever", role: .destructive) {
                if let ids = pendingForever { performRemove(ids) }
                pendingForever = nil
            }
        } message: {
            Text("You can't undo this.")
        }
        #if os(macOS)
        // The Delete key (and Edit › Delete) on the focused list removes every selected note.
        .onDeleteCommand { if !selection.isEmpty { remove(selection) } }
        #endif
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .primaryAction) {
                Button(editMode.isEditing ? "Done" : "Select") {
                    withAnimation(.snappy(duration: 0.25)) {
                        editMode = editMode.isEditing ? .inactive : .active
                        if !editMode.isEditing { selection = [] }
                    }
                }
                .fontWeight(editMode.isEditing ? .semibold : .regular)
                .disabled(scopedNotes.isEmpty && !editMode.isEditing)
                .accessibilityIdentifier("list.select")
            }
            if editMode.isEditing {
                ToolbarItem(placement: .bottomBar) {
                    Menu("Move") {
                        ForEach(folders) { f in
                            Button(f.name) { moveSelection(to: f) }
                        }
                    }
                    .disabled(selection.isEmpty || scope == .trash)
                    .accessibilityIdentifier("list.moveSelected")
                }
                ToolbarSpacer(.flexible, placement: .bottomBar)
                ToolbarItem(placement: .bottomBar) {
                    Button(selection.isEmpty ? "Delete" : "Delete (\(selection.count))", role: .destructive) {
                        remove(selection)
                        withAnimation(.snappy(duration: 0.25)) { editMode = .inactive }
                    }
                    .disabled(selection.isEmpty)
                    .accessibilityIdentifier("list.deleteSelected")
                }
            } else {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
                // iPad moves search to the top of the column; compose then belongs at the trailing edge.
                if UIDevice.current.userInterfaceIdiom == .pad {
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                } else {
                    ToolbarSpacer(.fixed, placement: .bottomBar)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("New Note", systemImage: "square.and.pencil", action: onNewNote)
                        .accessibilityIdentifier("list.newNote")
                }
            }
            #else
            // Like Notes: the folder's name and count, then a "⋯" menu for the list.
            ToolbarItem(placement: .navigation) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.system(size: 14, weight: .bold)).lineLimit(1)
                    Text(scopedNotes.count == 1 ? "1 note" : "\(scopedNotes.count) notes")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .padding(.horizontal, 6)
                .fixedSize()
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarSpacer(.flexible)
            ToolbarItem {
                Menu {
                    Button("New Folder", systemImage: "folder.badge.plus") { NotificationCenter.default.post(name: .paneNewFolder, object: nil) }
                    Divider()
                    Button("Import from Apple Notes…", systemImage: "square.and.arrow.down") { importNotes?() }
                    Button("Import Spreadsheet as Table…", systemImage: "tablecells") { importSheet?() }
                    Divider()
                    SettingsLink { Label("Settings…", systemImage: "gearshape") }
                } label: {
                    Label("More", systemImage: "ellipsis")
                }
                .menuIndicator(.hidden)
                .tint(.primary)
                .accessibilityIdentifier("list.more")
            }
            #endif
        }
    }

    private func setupCard(_ setup: SetupStore, _ progress: SetupProgress) -> some View {
        #if os(macOS)
        let onImport: (() -> Void)? = { importNotes?() }
        let onShareHowTo: (() -> Void)? = nil
        #else
        let onImport: (() -> Void)? = nil
        let onShareHowTo: (() -> Void)? = { sharingHowTo = true }
        #endif
        return SetupCard(
            progress: progress,
            celebrating: setup.showingCelebration,
            onImport: onImport,
            onStartFresh: { Task { await setup.mark("imported") } },
            onConnect: { connecting = true },
            onShareHowTo: onShareHowTo,
            onHide: { Task { await setup.mark("dismissed") } }
        )
        .task(id: progress.current) {
            // While a step waits on something that happens elsewhere (an AI connecting, an AI
            // editing), look again every few seconds. Syncs and returning to the app also refresh.
            while !Task.isCancelled, progress.current == .connect || progress.current == .tryIt {
                try? await Task.sleep(for: .seconds(8))
                await setup.refresh()
            }
        }
    }

    /// Step 3's prompt adds to "To-do": make sure there is one.
    private func ensureToDoNote() {
        let exists = notes.contains { $0.deletedAt == nil && $0.trashedAt == nil && $0.title.caseInsensitiveCompare("To-do") == .orderedSame }
        guard !exists else { return }
        let home = context.allFolders().first { $0.name == "Notes" && $0.parent == nil }
        _ = context.createNote(in: home.map { .folder($0.id) } ?? .all, body: "To-do\n\n")
        try? context.save()
        SyncSignal.changed()
    }

    @ViewBuilder
    private var emptyState: some View {
        if !search.isEmpty {
            ContentUnavailableView.search(text: search)
        } else if scope == .trash {
            ContentUnavailableView("No Deleted Notes", systemImage: "trash", description: Text("Notes you delete stay here for 30 days."))
        } else {
            ContentUnavailableView {
                Label("No Notes", systemImage: "note.text")
            } actions: {
                Button("New Note", action: onNewNote)
                    .buttonStyle(.glass)
            }
        }
    }

    @ViewBuilder
    private func deleteButton(_ note: Note) -> some View {
        Button(note.trashedAt == nil ? "Delete" : "Delete Forever…", systemImage: "trash", role: .destructive) { remove(note) }
    }

    @ViewBuilder
    private func menu(for ids: Set<UUID>, folders: [Folder]) -> some View {
        let notes = ids.compactMap { context.note($0) }
        if notes.count == 1, let note = notes.first {
            menu(for: note, folders: folders)
        } else if notes.count > 1 {
            if notes.allSatisfy({ $0.trashedAt != nil }) {
                Button("Recover \(notes.count) Notes", systemImage: "arrow.uturn.backward") {
                    withAnimation(.snappy) { notes.forEach(context.restore) }
                }
                Button("Delete \(notes.count) Notes Forever…", systemImage: "trash", role: .destructive) { remove(ids) }
            } else {
                Menu("Move \(notes.count) Notes to", systemImage: "folder") {
                    ForEach(folders) { f in
                        Button(f.name) { withAnimation(.snappy) { context.move(notes, to: f) } }
                    }
                }
                Divider()
                Button("Delete \(notes.count) Notes", systemImage: "trash", role: .destructive) { remove(ids) }
            }
        }
    }

    @ViewBuilder
    private func menu(for note: Note, folders: [Folder]) -> some View {
        if note.trashedAt != nil {
            Button("Recover", systemImage: "arrow.uturn.backward") { withAnimation(.snappy) { context.restore(note) } }
            deleteButton(note)
        } else {
            Button(note.isPinned ? "Unpin Note" : "Pin Note", systemImage: note.isPinned ? "pin.slash" : "pin") {
                withAnimation(.snappy) { context.togglePin(note) }
            }
            Menu("Move to", systemImage: "folder") {
                ForEach(folders) { f in
                    Button(f.name) { withAnimation(.snappy) { context.move(note, to: f) } }
                        .disabled(note.folder?.id == f.id)
                }
            }
            ShareLink(item: note.body, preview: SharePreview(note.title))
            Button("Duplicate", systemImage: "plus.square.on.square") {
                let copy = context.createNote(in: note.folder.map { .folder($0.id) } ?? .all, body: note.body)
                selection = [copy.id]
            }
            Divider()
            deleteButton(note)
        }
    }

    /// Dragging a selected note carries the whole selection; any other note goes alone (nil).
    private func dragOthers(for note: Note) -> [UUID]? {
        guard selection.count > 1, selection.contains(note.id) else { return nil }
        return selection.filter { $0 != note.id }.sorted { $0.uuidString < $1.uuidString }
    }

    private func moveSelection(to folder: Folder) {
        let notes = selection.compactMap { context.note($0) }
        withAnimation(.snappy) { context.move(notes, to: folder) }
        #if os(iOS)
        withAnimation(.snappy(duration: 0.25)) { editMode = .inactive }
        #endif
        selection = []
    }

    private func remove(_ note: Note) { remove([note.id]) }

    /// Deletes the notes and, if the open note was among them, selects its neighbour like Notes.
    /// Deleting from Recently Deleted can't be undone, so it asks first; anything else goes
    /// to Recently Deleted straight away, which is its own undo.
    private func remove(_ ids: Set<UUID>) {
        let forever = ids.compactMap { context.note($0) }.contains { $0.trashedAt != nil }
        if forever { pendingForever = ids } else { performRemove(ids) }
    }

    private var foreverTitle: String {
        let notes = (pendingForever ?? []).compactMap { context.note($0) }
        return notes.count == 1 ? "Delete \u{201C}\(notes[0].title)\u{201D} forever?" : "Delete \(notes.count) notes forever?"
    }

    private func performRemove(_ ids: Set<UUID>) {
        let ordered = filtered
        let notes = ids.compactMap { context.note($0) }
        let touchedSelection = !selection.isDisjoint(with: ids)
        let firstIndex = ordered.firstIndex { ids.contains($0.id) }
        withAnimation(.snappy(duration: 0.25)) {
            context.remove(notes)
            if touchedSelection {
                let rest = ordered.filter { !ids.contains($0.id) }
                if let i = firstIndex, !rest.isEmpty {
                    selection = [rest[min(i, rest.count - 1)].id]
                } else {
                    selection = []
                }
            }
        }
    }
}

/// Row type and spacing, matched to Apple Notes on each platform.
enum RowMetrics {
    #if os(macOS)
    static let title = Font.system(size: 13, weight: .bold)
    static let detail = Font.system(size: 13)
    static let spacing: CGFloat = 3
    static let vertical: CGFloat = 5
    static let leading: CGFloat = 12
    static let dotOffset: CGFloat = -12
    #else
    static let title = Font.headline
    static let detail = Font.subheadline
    static let spacing: CGFloat = 3
    static let vertical: CGFloat = 1
    static let leading: CGFloat = 0
    static let dotOffset: CGFloat = -12
    #endif
}

/// A note in the list with its drag and swipe actions. Equal inputs mean an unchanged row:
/// its note's own changes still reach NoteRow, which observes the note.
private struct ListRow: View, @MainActor Equatable {
    let note: Note
    let query: String
    let showFolder: Bool
    /// The rest of the selection, when this row is part of a multi-selection.
    let dragWith: [UUID]?
    let selectedCount: Int
    let togglePin: () -> Void
    let remove: () -> Void

    static func == (a: ListRow, b: ListRow) -> Bool {
        a.note.id == b.note.id && a.query == b.query && a.showFolder == b.showFolder
            && a.dragWith == b.dragWith && (a.dragWith == nil || a.selectedCount == b.selectedCount)
    }

    var body: some View {
        NoteRow(note: note, query: query, showFolder: showFolder)
            .draggable(PaneDragItem(kind: .note, id: note.id, others: dragWith)) {
                Label(dragWith != nil ? "\(selectedCount) Notes" : note.title, systemImage: dragWith != nil ? "doc.on.doc" : "note.text")
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .glassEffect(.regular, in: .capsule)
            }
            .swipeActions(edge: .leading) {
                if note.trashedAt == nil {
                    Button(note.isPinned ? "Unpin" : "Pin", systemImage: note.isPinned ? "pin.slash" : "pin", action: togglePin)
                        .tint(.orange)
                }
            }
            .swipeActions(edge: .trailing) {
                Button(note.trashedAt == nil ? "Delete" : "Delete Forever…", systemImage: "trash", role: .destructive, action: remove)
            }
    }
}

struct NoteRow: View {
    let note: Note
    var query: String = ""
    var showFolder = false

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let title = note.title
        // At the accessibility text sizes the row stacks and wraps instead of truncating.
        let large = typeSize.isAccessibilitySize
        let detail = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(spacing: 8))
        let ai = AIEdit.isUnseen(note) ? note.aiEditor : nil
        return VStack(alignment: .leading, spacing: RowMetrics.spacing) {
            Text(title)
                .font(RowMetrics.title)
                .lineLimit(large ? 3 : 1)
                // An AI changed this note and you haven't opened it since, like Mail's unread dot.
                .overlay(alignment: .leading) {
                    if ai != nil {
                        Circle().fill(.tint).frame(width: 8, height: 8)
                            .offset(x: RowMetrics.dotOffset)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            detail {
                Text(DateBucket.rowDate(note.updatedAt))
                    .monospacedDigit()
                    .foregroundStyle(.primary.opacity(0.85))
                if let ai {
                    HStack(spacing: 4) {
                        AIGlyph(ai: ai, size: 11)
                        Text(AIEdit.wroteIt(note) ? "Written by \(ai)" : "Edited by \(ai)")
                    }
                    .foregroundStyle(Color.amberInk)
                    .lineLimit(1)
                } else {
                    Text(snippet)
                        .foregroundStyle(.secondary)
                        .lineLimit(large ? 2 : 1)
                }
            }
            .font(RowMetrics.detail)
            if showFolder, let f = note.folder {
                HStack(spacing: 5) {
                    Image(systemName: "folder")
                    Text(f.name)
                }
                .font(RowMetrics.detail)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, RowMetrics.vertical)
        .padding(.leading, RowMetrics.leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue([note.isPinned ? "Pinned" : nil, ai.map { "Edited by \($0)" }].compactMap { $0 }.joined(separator: ", "))
        .accessibilityIdentifier("note.\(title)")
    }

    /// With a search, show the matching line instead of the preview.
    private var snippet: String {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return note.preview }
        for line in note.body.split(separator: "\n") where line.localizedStandardContains(q) {
            let clean = NoteText.stripMarkup(String(line))
            if !clean.isEmpty, clean != note.title { return clean }
        }
        return note.preview
    }
}
