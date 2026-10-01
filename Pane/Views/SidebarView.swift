import SwiftData
import SwiftUI

#if os(macOS)
/// The account at the foot of the sidebar: your photo and name. Clicking it opens Settings,
/// which starts with your account. Signing out lives there, last, behind a confirmation, so
/// a slip of the mouse here can never sign you out.
struct AccountButton: View {
    let email: String
    let backend: Backend
    @State private var profile = ProfileStore.shared
    @State private var hovering = false
    @Environment(\.openSettings) private var openSettings

    private var name: String { profile.name ?? email }

    var body: some View {
        Button { openSettings() } label: {
            HStack(spacing: 8) {
                AvatarView(photo: profile.photo, name: name, size: 22)
                Text(name)
                    .font(.system(size: 12, weight: profile.name == nil ? .regular : .medium))
                    .foregroundStyle(profile.name == nil ? .secondary : .primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: 34)
            .background(hovering ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 8))
            .contentShape(.rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
        .help("Account Settings")
        .accessibilityLabel("Account, \(name). Opens Settings")
        .accessibilityIdentifier("sidebar.account")
        .task(id: backend.state) { await profile.bind(backend) }
    }
}
#endif

#if os(macOS)
/// The app's name and mark at the top of the sidebar.
struct SidebarHeader: View {
    var body: some View {
        HStack(spacing: 8) {
            AppMark(size: 21)
            // The website's display type: heavy and tight.
            Text("Amber Notes").font(.display(15)).tracking(Palette.tracking(15)).foregroundStyle(Color.ink)
            Spacer(minLength: 0)
        }
        .padding(.leading, 18)
        .padding(.top, 2)
        .padding(.bottom, 14)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
#endif

enum SidebarStyle {
    #if os(macOS)
    static let iconFont = Font.system(size: 17, weight: .regular)
    #else
    static let icon = TintShapeStyle.tint
    static let iconFont = Font.body
    #endif
}

/// A folder icon in the sidebar. Notes on the Mac draws them in the text colour, and in a
/// window that isn't in front they fade with their names; iOS tints them.
struct SidebarIcon: View {
    let name: String
    #if os(macOS)
    @Environment(\.controlActiveState) private var active
    #endif

    var body: some View {
        Image(systemName: name)
            .font(SidebarStyle.iconFont)
            #if os(macOS)
            .foregroundStyle(active == .inactive ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.primary))
            #else
            .foregroundStyle(SidebarStyle.icon)
            #endif
    }
}

extension View {
    /// One element per sidebar row, read as "Travel, 4 notes". Without it VoiceOver reads the
    /// folder symbol's own name ("Move") before the row's.
    func rowAccessibility(_ name: String, count: Int) -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(name)
            .accessibilityValue(count == 1 ? "1 note" : "\(count) notes")
    }
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
    @State private var deletingFolder: Folder?
    @State private var showSettings = false
    @FocusedValue(\.importSheetAction) private var importSheet
    @FocusedValue(\.importFromAction) private var importFrom
    @Environment(Backend.self) private var backend: Backend?
    @Environment(SyncEngine.self) private var sync: SyncEngine?

    private var live: [Note] { notes.filter { $0.trashedAt == nil && $0.deletedAt == nil } }
    private var trashed: [Note] { notes.filter { $0.trashedAt != nil && $0.deletedAt == nil } }
    private var roots: [Folder] { folders.filter { $0.parent == nil || $0.parent?.deletedAt != nil } }

    var body: some View {
        List(selection: $scope) {
            Section {
                // "All Notes" only earns its row once there's more than one folder.
                if folders.count > 1 {
                    row("All Notes", icon: "tray.full", count: live.count)
                        .tag(Scope.all)
                        .accessibilityIdentifier("sidebar.all")
                }
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
            #if os(iOS)
            .listRowBackground(Color(Palette.row))
            #endif
        }
        .listStyle(.sidebar)
        #if os(iOS)
        .scrollContentBackground(.hidden)
        .background(Color(Palette.foldersGround).ignoresSafeArea())
        #else
        // A little of the icon's brown inside the sidebar's glass, which stays vibrant.
        .background(Color(Palette.sidebarWarmth).ignoresSafeArea())
        #endif
        #if os(macOS)
        // The app's name at the top, so it's never mistaken for Notes. (iOS shows it as the large title.)
        .safeAreaInset(edge: .top, spacing: 0) { SidebarHeader() }
        #endif
        .onAppear(perform: settleScope)
        .onChange(of: folders.map(\.id)) { _, _ in settleScope() }
        // Launch restores All Notes after this list first appears.
        .onChange(of: scope) { _, _ in settleScope() }
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
                    ForEach(ImportKind.allCases) { kind in
                        Button(kind.title, systemImage: kind.symbol) { importFrom?(kind) }
                    }
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
                    // Signed in, your photo is the way into Settings (your account comes first there).
                    if case .signedIn(let email) = backend.state {
                        let name = ProfileStore.shared.name ?? backend.displayEmail ?? email
                        Button { showSettings = true } label: {
                            AvatarView(photo: ProfileStore.shared.photo, name: name, size: 30)
                        }
                        .accessibilityLabel("Account, \(name). Opens Settings")
                        .accessibilityIdentifier("sidebar.settings")
                        .task(id: backend.state) { await ProfileStore.shared.bind(backend) }
                    } else {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
                            .accessibilityIdentifier("sidebar.settings")
                    }
                }
            }
            #endif
        }
        #if os(macOS)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let backend, case .signedIn(let email) = backend.state {
                AccountButton(email: backend.displayEmail ?? email, backend: backend)
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .paneNewFolder)) { _ in startNewFolder(nil) }
        #endif
        .sheet(isPresented: $showSettings) {
            if let backend { SettingsView(backend: backend, sync: sync) }
        }
        .confirmationDialog("Delete \u{201C}\(deletingFolder?.name ?? "")\u{201D}?", isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }), titleVisibility: .visible) {
            Button("Delete Folder", role: .destructive) {
                if let f = deletingFolder { performDelete(f) }
                deletingFolder = nil
            }
        } message: {
            Text("Its notes move to Recently Deleted, where you can recover them for 30 days.")
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
            if renaming == nil { Text("Enter a name for this folder.") }
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
            SidebarIcon(name: icon)
        }
        .rowAccessibility(title, count: count)
    }

    /// Keeps the selection on something that exists (see `Scope.settled`).
    private func settleScope() {
        let settled = Scope.settled(scope, liveFolders: folders.map(\.id))
        if settled != scope { scope = settled }
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

    /// Asks first when the folder holds notes, like Notes: they move to Recently Deleted.
    private func deleteFolder(_ f: Folder) {
        if f.liveNotes.isEmpty && f.liveChildren.isEmpty { performDelete(f) } else { deletingFolder = f }
    }

    private func performDelete(_ f: Folder) {
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
            SidebarIcon(name: dropTarget == folder.id ? "folder.fill" : "folder")
                .contentTransition(.symbolEffect(.replace))
        }
        .rowAccessibility(folder.name, count: folder.liveNotes.count)
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
                    // A dragged multi-selection moves together.
                    for id in item.ids {
                        if let n = context.note(id) { context.move(n, to: folder); moved = true }
                    }
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
            Button("Delete Folder…", systemImage: "trash", role: .destructive) { delete(folder) }
        }
    }
}
