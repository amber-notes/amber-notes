import SwiftData
import SwiftUI

enum SidebarStyle {
    /// Notes on the Mac draws folder icons in the text colour; iOS tints them.
    #if os(macOS)
    static let icon = HierarchicalShapeStyle.primary
    #else
    static let icon = TintShapeStyle.tint
    #endif
}

extension Notification.Name {
    /// Asks the sidebar to start a new folder (from the list's "⋯" menu).
    static let paneNewFolder = Notification.Name("pane.newFolder")
}

struct SidebarView: View {
    @Environment(\.modelContext) private var context
    @Binding var scope: Scope?
    let onNewNote: () -> Void

    @Query(filter: #Predicate<Folder> { $0.deletedAt == nil }, sort: \Folder.sortIndex) private var folders: [Folder]
    @Query private var notes: [Note]

    @State private var renaming: Folder?
    @State private var newFolderParent: Folder??
    @State private var nameDraft = ""
    @State private var dropTarget: UUID?
    @State private var showSettings = false
    @FocusedValue(\.importSheetAction) private var importSheet
    @Environment(Backend.self) private var backend: Backend?
    @Environment(SyncEngine.self) private var sync: SyncEngine?

    private var live: [Note] { notes.filter { $0.trashedAt == nil && $0.deletedAt == nil } }
    private var trashed: [Note] { notes.filter { $0.trashedAt != nil && $0.deletedAt == nil } }
    private var roots: [Folder] { folders.filter { $0.parent == nil || $0.parent?.deletedAt != nil } }

    var body: some View {
        List(selection: $scope) {
            Section {
                row("All Notes", icon: "tray.full", count: live.count)
                    .tag(Scope.all)
                    .accessibilityIdentifier("sidebar.all")
                ForEach(roots) { folder in
                    FolderTree(folder: folder, dropTarget: $dropTarget, rename: startRename, newSub: startNewFolder, delete: deleteFolder)
                }
                // Last in the same list, like Notes.
                row("Recently Deleted", icon: "trash", count: trashed.count)
                    .tag(Scope.trash)
                    .accessibilityIdentifier("sidebar.trash")
            } header: {
                Text("Folders")
            }
        }
        .listStyle(.sidebar)
        // Right-click anywhere in the sidebar; a folder's own menu comes from its row.
        .contextMenu(forSelectionType: Scope.self) { items in
            if items.isEmpty || items.contains(.all) || items.contains(.trash) {
                Button("New Folder", systemImage: "folder.badge.plus") { startNewFolder(nil) }
            }
        }
        .dropDestination(for: PaneDragItem.self) { items, _ in
            // Dropping a folder on empty sidebar space moves it to the top level.
            var moved = false
            for item in items where item.kind == .folder {
                if let f = context.folder(item.id) { context.move(f, into: nil); moved = true }
            }
            return moved
        }
        .navigationTitle("Amber Notes")
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .bottomBar) {
                Menu {
                    Button("New Folder", systemImage: "folder.badge.plus") { startNewFolder(nil) }
                    Button("Import Spreadsheet as Table", systemImage: "tablecells.badge.ellipsis") { importSheet?() }
                } label: {
                    Label("New Folder", systemImage: "folder.badge.plus")
                } primaryAction: { startNewFolder(nil) }
                .accessibilityIdentifier("sidebar.newFolder")
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItem(placement: .bottomBar) {
                Button("New Note", systemImage: "square.and.pencil", action: onNewNote)
            }
            if let backend, backend.client != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button("Settings", systemImage: "gearshape") { showSettings = true }
                        .accessibilityIdentifier("sidebar.settings")
                }
            }
            #endif
        }
        #if os(macOS)
        // Like Notes: New Folder lives at the foot of the sidebar.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Button { startNewFolder(nil) } label: {
                    Label("New Folder", systemImage: "plus.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("sidebar.newFolder")
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .onReceive(NotificationCenter.default.publisher(for: .paneNewFolder)) { _ in startNewFolder(nil) }
        #endif
        .sheet(isPresented: $showSettings) {
            if let backend { SettingsView(backend: backend, sync: sync) }
        }
        .alert(renaming == nil ? "New Folder" : "Rename Folder", isPresented: Binding(
            get: { renaming != nil || newFolderParent != nil },
            set: { if !$0 { renaming = nil; newFolderParent = nil } }
        )) {
            TextField("Name", text: $nameDraft)
                .accessibilityIdentifier("folder.name")
            Button("Cancel", role: .cancel) {}
            Button(renaming == nil ? "Create" : "Save", action: commitName)
                .keyboardShortcut(.defaultAction)
        } message: {
            if renaming == nil { Text("Give the folder a name.") }
        }
    }

    private func row(_ title: String, icon: String, count: Int) -> some View {
        Label {
            HStack {
                Text(title)
                Spacer()
                Text(count, format: .number)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: icon).foregroundStyle(SidebarStyle.icon)
        }
    }

    private func startRename(_ f: Folder) { nameDraft = f.name; renaming = f }
    private func startNewFolder(_ parent: Folder?) { nameDraft = ""; newFolderParent = .some(parent) }

    private func commitName() {
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        defer { renaming = nil; newFolderParent = nil }
        guard !name.isEmpty else { return }
        if let f = renaming {
            f.name = name
            f.touch()
            try? context.save()
        } else if let parent = newFolderParent {
            let f = context.createFolder(named: name, parent: parent)
            scope = .folder(f.id)
        }
    }

    private func deleteFolder(_ f: Folder) {
        if scope == .folder(f.id) { scope = .all }
        withAnimation(.snappy) { context.delete(f) }
    }
}

/// A folder row with its sub-folders; accepts dropped notes and folders.
private struct FolderTree: View {
    @Environment(\.modelContext) private var context
    let folder: Folder
    @Binding var dropTarget: UUID?
    let rename: (Folder) -> Void
    let newSub: (Folder) -> Void
    let delete: (Folder) -> Void
    @State private var expanded = true

    var body: some View {
        if folder.liveChildren.isEmpty {
            label
        } else {
            DisclosureGroup(isExpanded: $expanded) {
                ForEach(folder.liveChildren) { child in
                    FolderTree(folder: child, dropTarget: $dropTarget, rename: rename, newSub: newSub, delete: delete)
                }
            } label: { label }
        }
    }

    private var label: some View {
        Label {
            HStack {
                Text(folder.name)
                Spacer()
                Text(folder.liveNotes.count, format: .number)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: dropTarget == folder.id ? "folder.fill" : "folder")
                .foregroundStyle(SidebarStyle.icon)
                .contentTransition(.symbolEffect(.replace))
        }
        .tag(Scope.folder(folder.id))
        .accessibilityIdentifier("folder.\(folder.name)")
        .draggable(PaneDragItem(kind: .folder, id: folder.id)) {
            Label(folder.name, systemImage: "folder").padding(8).glassEffect(.regular, in: .capsule)
        }
        .dropDestination(for: PaneDragItem.self) { items, _ in
            var moved = false
            for item in items {
                switch item.kind {
                case .note:
                    if let n = context.note(item.id) { context.move(n, to: folder); moved = true }
                case .folder:
                    if item.id != folder.id, let f = context.folder(item.id) { context.move(f, into: folder); moved = true }
                }
            }
            if moved { expanded = true }
            return moved
        } isTargeted: { over in
            withAnimation(.snappy(duration: 0.18)) { dropTarget = over ? folder.id : (dropTarget == folder.id ? nil : dropTarget) }
        }
        .contextMenu {
            Button("New Folder Inside", systemImage: "folder.badge.plus") { newSub(folder) }
            Button("Rename", systemImage: "pencil") { rename(folder) }
            if folder.parent != nil {
                Button("Move to Top Level", systemImage: "arrow.up.to.line") { context.move(folder, into: nil) }
            }
            Divider()
            Button("Delete Folder", systemImage: "trash", role: .destructive) { delete(folder) }
        }
    }
}
