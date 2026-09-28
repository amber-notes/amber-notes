import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct NoteListView: View {
    @Environment(\.modelContext) private var context
    let scope: Scope
    @Binding var selection: UUID?
    let onNewNote: () -> Void

    @Query(sort: \Note.updatedAt, order: .reverse) private var notes: [Note]
    @State private var search = ""
    @State private var fileDropTargeted = false
    @State private var collapsed: Set<String> = []
    @FocusedValue(\.importAction) private var importNotes
    @FocusedValue(\.importSheetAction) private var importSheet

    private var scoped: [Note] {
        notes.filter { n in
            guard n.deletedAt == nil else { return false }
            switch scope {
            case .all: return n.trashedAt == nil
            case .trash: return n.trashedAt != nil
            case .folder(let id): return n.trashedAt == nil && n.folder?.id == id
            }
        }
    }

    private var filtered: [Note] {
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
        List(selection: $selection) {
            if scope == .trash && !scoped.isEmpty && search.isEmpty {
                Text("Notes are deleted forever after 30 days.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
            }
            ForEach(DateBucket.sections(filtered), id: \.0) { section in
                Section(isExpanded: Binding(
                    get: { !collapsed.contains(section.0) },
                    set: { open in withAnimation(.snappy(duration: 0.22)) { if open { collapsed.remove(section.0) } else { collapsed.insert(section.0) } } }
                )) {
                    ForEach(section.1) { note in
                        NoteRow(note: note, query: search, showFolder: scope == .all || !search.isEmpty)
                            .tag(note.id)
                            .draggable(PaneDragItem(kind: .note, id: note.id)) {
                                Label(note.title, systemImage: "note.text")
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .glassEffect(.regular, in: .capsule)
                            }
                            .swipeActions(edge: .leading) {
                                if note.trashedAt == nil {
                                    Button(note.isPinned ? "Unpin" : "Pin", systemImage: note.isPinned ? "pin.slash" : "pin") {
                                        withAnimation(.snappy) { context.togglePin(note) }
                                    }
                                    .tint(.orange)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                deleteButton(note)
                            }
                            .contextMenu { menu(for: note) }
                    }
                } header: {
                    Text(section.0)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.primary)
                        .textCase(nil)
                }
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #endif
        .overlay {
            if filtered.isEmpty { emptyState }
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
            if let first = made.first { selection = first.id }
            return !made.isEmpty
        } isTargeted: { t in
            withAnimation(.easeOut(duration: 0.15)) { fileDropTargeted = t }
        }
        #if os(iOS)
        .searchable(text: $search, placement: .toolbar, prompt: "Search")
        .searchToolbarBehavior(.minimize)
        #else
        .searchable(text: $search, placement: .toolbar, prompt: "Search")
        #endif
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.large)
        #endif
        #if os(macOS)
        .navigationSubtitle("")
        #endif
        .onKeyPress(.delete) {
            guard let id = selection, let n = context.note(id) else { return .ignored }
            remove(n); return .handled
        }
        .toolbar {
            #if os(iOS)
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Text(scoped.count == 1 ? "1 Note" : "\(scoped.count) Notes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .fixedSize()
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button("New Note", systemImage: "square.and.pencil", action: onNewNote)
                    .accessibilityIdentifier("list.newNote")
            }
            #else
            // Like Notes: the folder's name and count, then a "⋯" menu for the list.
            ToolbarItem(placement: .navigation) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.system(size: 14, weight: .bold)).lineLimit(1)
                    Text(scoped.count == 1 ? "1 note" : "\(scoped.count) notes")
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
                Button("Create a note", action: onNewNote)
                    .buttonStyle(.glass)
            }
        }
    }

    @ViewBuilder
    private func deleteButton(_ note: Note) -> some View {
        Button(note.trashedAt == nil ? "Delete" : "Delete Forever", systemImage: "trash", role: .destructive) { remove(note) }
    }

    @ViewBuilder
    private func menu(for note: Note) -> some View {
        if note.trashedAt != nil {
            Button("Recover", systemImage: "arrow.uturn.backward") { withAnimation(.snappy) { context.restore(note) } }
            deleteButton(note)
        } else {
            Button(note.isPinned ? "Unpin Note" : "Pin Note", systemImage: note.isPinned ? "pin.slash" : "pin") {
                withAnimation(.snappy) { context.togglePin(note) }
            }
            Menu("Move to", systemImage: "folder") {
                ForEach(context.allFolders().sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { f in
                    Button(f.name) { withAnimation(.snappy) { context.move(note, to: f) } }
                        .disabled(note.folder?.id == f.id)
                }
            }
            ShareLink(item: note.body, preview: SharePreview(note.title))
            Button("Duplicate", systemImage: "plus.square.on.square") {
                let copy = context.createNote(in: note.folder.map { .folder($0.id) } ?? .all, body: note.body)
                selection = copy.id
            }
            Divider()
            deleteButton(note)
        }
    }

    private func remove(_ note: Note) {
        let wasSelected = selection == note.id
        let ordered = filtered
        withAnimation(.snappy(duration: 0.25)) {
            if note.trashedAt == nil { context.trash(note) } else { context.purge(note) }
            if wasSelected {
                // Select the neighbour, as Apple Notes does.
                if let i = ordered.firstIndex(where: { $0.id == note.id }) {
                    let rest = ordered.filter { $0.id != note.id }
                    selection = rest.isEmpty ? nil : rest[min(i, rest.count - 1)].id
                } else { selection = nil }
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
    #else
    static let title = Font.headline
    static let detail = Font.subheadline
    static let spacing: CGFloat = 3
    static let vertical: CGFloat = 1
    static let leading: CGFloat = 0
    #endif
}

struct NoteRow: View {
    let note: Note
    var query: String = ""
    var showFolder = false

    var body: some View {
        VStack(alignment: .leading, spacing: RowMetrics.spacing) {
            Text(note.title)
                .font(RowMetrics.title)
                .lineLimit(1)
            HStack(spacing: 8) {
                Text(DateBucket.rowDate(note.updatedAt))
                    .monospacedDigit()
                    .foregroundStyle(.primary.opacity(0.85))
                Text(snippet)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
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
        .accessibilityIdentifier("note.\(note.title)")
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
