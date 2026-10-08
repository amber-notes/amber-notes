import SwiftData
import SwiftUI
import TipKit
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

    /// Every note, fetched again only when a save adds or deletes one (see LibraryNotes).
    @State private var library = LibraryNotes()
    private var notes: [Note] { library.notes(in: context) }
    /// Files kept in folders on their own, listed with the notes.
    @Query(filter: #Predicate<Attachment> { $0.folderID != nil && $0.deletedAt == nil }) private var folderFiles: [Attachment]
    @State private var search = ""
    /// "Add File": the picker, and a file being renamed.
    @State private var addingFiles = false
    @State private var renamingFile: Attachment?
    /// Export… (Mac) or Save to Files (iPhone) from a file's menu.
    @State private var exportingFile: Attachment?
    @State private var fileNameDraft = ""
    @State private var fileDropTargeted = false
    @State private var collapsed: Set<String> = []
    /// Notes waiting for "Delete Forever" to be confirmed.
    @State private var pendingForever: Set<UUID>?
    @Environment(\.importActions) private var imports
    @Environment(SetupStore.self) private var setup: SetupStore?
    @Environment(Backend.self) private var backend: Backend?
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @State private var connecting = false
    @State private var sharingHowTo = false
    @State private var connectCenter = ConnectCenter.shared
    /// How full the account is: a warning near 2 GB and at it.
    @State private var storage = StorageStore.shared
    /// "What's new" after a major update (WhatsNew.swift), and whether the list has settled.
    @State private var whatsNew = WhatsNewStore.shared
    @State private var settled = false
    #if os(iOS)
    @State private var showSettings = false
    #else
    @Environment(\.openSettings) private var openSettings
    #endif
    /// The Share tip at the top of the list is due (iPhone).
    @State private var listTipDue = false

    /// "Get set up" sits on top of the list for a new account, never in Recently Deleted or a search.
    private var showsSetup: Bool { (setup?.visible ?? false) && scope != .trash && search.isEmpty }

    /// "What's new" takes the setup card's place, never shares the screen with it: it waits until
    /// the setup card has gone, the list has settled and nothing else (a sheet, an ask) is up.
    private var showsWhatsNew: Bool {
        guard whatsNew.card != nil, !showsSetup, scope != .trash, search.isEmpty else { return false }
        if whatsNew.presented { return true }
        #if os(iOS)
        if showSettings { return false }
        #endif
        return settled && !whatsNew.held && !connecting && !sharingHowTo
    }

    /// Every note, last edited first; each date read once.
    private var newestFirst: [Note] {
        notes.map { ($0, $0.updatedAt) }.sorted { $0.1 > $1.1 }.map(\.0)
    }

    private func scoped(from all: [Note]) -> [Note] {
        all.filter { n in
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

    private var filtered: [Note] {
        let all = newestFirst
        return filtered(from: scoped(from: all), all: all)
    }

    private var scopedFiles: [Attachment] {
        folderFiles.filter { f in
            switch scope {
            case .all: return f.trashedAt == nil
            case .trash: return f.trashedAt != nil
            case .folder(let id): return f.trashedAt == nil && f.folderID == id
            }
        }
    }

    /// Files by name, as notes are found by their text.
    private func filteredFiles(from scoped: [Attachment]) -> [Attachment] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return scoped }
        let base = scope == .trash ? scoped : folderFiles.filter { $0.trashedAt == nil }
        return base.filter { $0.filename.localizedStandardContains(q) }
    }

    /// What the list shows, in its order: notes and files together, by date.
    private var orderedItems: [ListItem] {
        DateBucket.sections(filtered.map(ListItem.note) + filteredFiles(from: scopedFiles).map(ListItem.file)).flatMap(\.1)
    }

    /// "12 notes, 3 files", or just the notes when the folder has no files.
    private func countText(notes: Int, files: Int, capitalized: Bool) -> String {
        let n = notes == 1 ? "1 \(capitalized ? "Note" : "note")" : "\(notes) \(capitalized ? "Notes" : "notes")"
        guard files > 0 else { return n }
        let f = files == 1 ? "1 \(capitalized ? "File" : "file")" : "\(files) \(capitalized ? "Files" : "files")"
        return notes == 0 ? f : n + ", " + f
    }

    /// `all` is every note, newest first: sorted once and shared with `scoped`.
    private func filtered(from scoped: [Note], all: [Note]) -> [Note] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return scoped }
        let base = scope == .trash ? scoped : all.filter { $0.deletedAt == nil && $0.trashedAt == nil }
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
        #if DEBUG
        RenderProbe.count("NoteListView")
        #endif
        // Worked out once per update and handed down: the list asks many times.
        let all = newestFirst
        let scopedNotes = scoped(from: all)
        let visible = filtered(from: scopedNotes, all: all)
        let files = scopedFiles
        let visibleFiles = filteredFiles(from: files)
        let folders = context.allFolders().sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        return list(scopedNotes, visible, files, visibleFiles, folders)
            #if os(iOS)
            .task { await watchListTip() }
            #endif
    }

    private func list(_ scopedNotes: [Note], _ visible: [Note], _ scopedFiles: [Attachment], _ visibleFiles: [Attachment], _ folders: [Folder]) -> some View {
        List(selection: $selection) {
            // An ask to connect an AI whose sheet was closed without an answer: always a way back.
            if scope != .trash, search.isEmpty, let ask = connectCenter.waiting().first {
                #if os(iOS)
                Section {
                    ConnectWaitingRow(ask: ask).selectionDisabled()
                }
                .listRowBackground(Color(Palette.row))
                #else
                ConnectWaitingRow(ask: ask)
                    .listRowInsets(EdgeInsets(top: 6, leading: 10, bottom: 10, trailing: 10))
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
                #endif
            }
            if scope != .trash, search.isEmpty, let usage = storage.usage, usage.level != .fine {
                #if os(iOS)
                Section { StorageWarningRow(usage: usage, open: openStorage).selectionDisabled() }
                    .listRowBackground(Color(Palette.row))
                #else
                StorageWarningRow(usage: usage, open: openStorage)
                    .listRowInsets(EdgeInsets(top: 6, leading: 10, bottom: 10, trailing: 10))
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
                #endif
            }
            if showsSetup, let setup, let progress = setup.progress {
                #if os(iOS)
                // Its own grouped section, so it has the list's insets, radius and ground.
                Section {
                    setupCard(setup, progress)
                        .padding(.vertical, 4)
                        .selectionDisabled()
                }
                .listRowBackground(Color(Palette.row))
                #else
                setupCard(setup, progress)
                    .listRowInsets(EdgeInsets(top: 6, leading: 10, bottom: 10, trailing: 10))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
                #endif
            }
            if showsWhatsNew, let release = whatsNew.card {
                #if os(iOS)
                Section {
                    whatsNewCard(release)
                        .padding(.vertical, 4)
                        .selectionDisabled()
                }
                .listRowBackground(Color(Palette.row))
                #else
                whatsNewCard(release)
                    .listRowInsets(EdgeInsets(top: 6, leading: 10, bottom: 10, trailing: 10))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    .selectionDisabled()
                #endif
            }
            #if os(iOS)
            if listTipDue && !showsSetup && !showsWhatsNew && scope != .trash && search.isEmpty {
                listTip
            }
            #endif
            if scope == .trash && !(scopedNotes.isEmpty && scopedFiles.isEmpty) && search.isEmpty {
                Text(scopedFiles.isEmpty ? "Notes are deleted forever after 30 days." : "Notes and files are deleted forever after 30 days.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
            }
            // Without files the notes go straight in: wrapping each one as a list item, and sorting
            // them again as items, was about a third of each save with 5,000 notes.
            if visibleFiles.isEmpty {
                ForEach(DateBucket.sections(visible), id: \.0) { section in
                    dateSection(section) { noteRow($0) }
                }
            } else {
                ForEach(DateBucket.sections(visible.map(ListItem.note) + visibleFiles.map(ListItem.file)), id: \.0) { section in
                    dateSection(section) { item in
                        switch item {
                        case .note(let note):
                            noteRow(note)
                        case .file(let file):
                            FileListRow(file: file, query: search, showFolder: scope == .all || !search.isEmpty, remove: { remove([file.id]) })
                                .tag(file.id)
                                .hoverRow(file.filename)
                                #if os(iOS)
                                .listRowBackground(Color(Palette.row))
                                #endif
                        }
                    }
                }
            }
            #if os(iOS)
            // The count, quietly at the end of the list, as in Notes.
            if !(visible.isEmpty && visibleFiles.isEmpty) && search.isEmpty {
                Section {} footer: {
                    Text(countText(notes: scopedNotes.count, files: scopedFiles.count, capitalized: true))
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
        // Offline: a quiet line over the bottom bar (the Mac says it in the sidebar).
        .safeAreaInset(edge: .bottom, spacing: 0) { OfflineLine(sync: sync).animation(.easeOut(duration: 0.25), value: sync?.reach) }
        #endif
        // Less warmth than the sidebar, more than the note.
        .scrollContentBackground(.hidden)
        .background(Color(Palette.listGround).ignoresSafeArea())
        .overlay {
            // The setup card is the empty state for a new account.
            if visible.isEmpty && visibleFiles.isEmpty && !showsSetup { emptyState }
        }
        .sheet(isPresented: $connecting, onDismiss: { Task { await setup?.refresh(force: true) } }) {
            if let client = backend?.client { ConnectAISheet(client: client) }
        }
        #if os(iOS)
        .sheet(isPresented: $sharingHowTo) { ShareHowToSheet() }
        .sheet(isPresented: $showSettings) {
            if let backend { SettingsView(backend: backend, sync: sync) }
        }
        #endif
        .onChange(of: AppPlaceCenter.shared.pending, initial: true) { _, place in openConnectAI(place) }
        // Captures: `-uitest -openSettings` shows Settings over the list.
        .task {
            guard ProcessInfo.processInfo.arguments.contains("-uitest"), ProcessInfo.processInfo.arguments.contains("-openSettings") else { return }
            try? await Task.sleep(for: .seconds(1))
            #if os(iOS)
            showSettings = true
            #else
            openSettings()
            #endif
        }
        .task {
            // How full the account is, now and every few minutes.
            while !Task.isCancelled {
                await storage.refresh(backend?.client)
                try? await Task.sleep(for: .seconds(300))
            }
        }
        .task {
            // A moment after the list first shows, so the card never lands mid-transition.
            try? await Task.sleep(for: .seconds(1))
            withAnimation(.snappy(duration: 0.3)) { settled = true }
        }
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
            if let first = made.first { selection = [first] }
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
        .fileImporter(isPresented: $addingFiles, allowedContentTypes: FileKinds.contentTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            let made = context.addFiles(urls, to: context.folderForFiles(scope))
            if let first = made.first { selection = [first.id] }
        }
        .fileExport(exportingFile, isPresented: Binding(get: { exportingFile != nil }, set: { if !$0 { exportingFile = nil } }))
        .alert("Rename File", isPresented: Binding(get: { renamingFile != nil }, set: { if !$0 { renamingFile = nil } })) {
            TextField("Name", text: $fileNameDraft)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let f = renamingFile { context.rename(f, to: fileNameDraft) } }
        } message: {
            Text("The ending (.\(((renamingFile?.filename ?? "") as NSString).pathExtension)) stays.")
        }
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
        // Dev: what each click did, for the file rows that sometimes don't select (Beta builds only).
        .onAppear { RowClickLog.start() }
        .onChange(of: selection) { old, new in RowClickLog.selection(old, new) }
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
                .disabled(scopedNotes.isEmpty && scopedFiles.isEmpty && !editMode.isEditing)
                .accessibilityIdentifier("list.select")
            }
            if !editMode.isEditing && scope != .trash {
                // Files kept in the folder on their own: PDFs to read, photos, spreadsheets.
                ToolbarItem(placement: .primaryAction) {
                    Button("Add File", systemImage: "doc.badge.plus") { addingFiles = true }
                        .accessibilityIdentifier("list.addFile")
                }
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
                    Text(title).font(.system(size: 14, weight: .bold)).foregroundStyle(Color.ink).lineLimit(1)
                    Text(countText(notes: scopedNotes.count, files: scopedFiles.count, capitalized: false))
                        .font(.system(size: 11))
                        .foregroundStyle(Color.muted)
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
                    Button("Add Files…", systemImage: "doc.badge.plus") { addingFiles = true }
                        .disabled(scope == .trash)
                        .accessibilityIdentifier("list.addFile")
                    Divider()
                    Button("Import from Apple Notes…", systemImage: "square.and.arrow.down") { imports?.appleNotes() }
                    ForEach(ImportKind.allCases) { kind in
                        Button(kind.menuTitle, systemImage: kind.symbol) { imports?.from(kind) }
                    }
                    Button("Import Spreadsheet as Table…", systemImage: "tablecells") { imports?.spreadsheet() }
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

    /// One date's notes (and files), collapsible, under its heading.
    private func dateSection<Item: Identifiable, Row: View>(_ section: (String, [Item]), @ViewBuilder row: @escaping (Item) -> Row) -> some View {
        Section(isExpanded: Binding(
            get: { !collapsed.contains(section.0) },
            set: { open in withAnimation(.snappy(duration: 0.22)) { if open { collapsed.remove(section.0) } else { collapsed.insert(section.0) } } }
        )) {
            ForEach(section.1) { row($0) }
        } header: {
            // One step lighter than the display type: bold, in the warm ink.
            #if os(iOS)
            // The system's prominent header: large and bold, as in Notes.
            Text(section.0)
                .foregroundStyle(Color.ink)
            #else
            Text(section.0)
                .font(.title3.weight(.bold))
                .foregroundStyle(Color.ink)
                .textCase(nil)
            #endif
        }
        #if os(iOS)
        .headerProminence(.increased)
        #endif
    }

    private func noteRow(_ note: Note) -> some View {
        // Its own equatable view: when one note changes, the others' rows (and their
        // drag and swipe setup) are left alone instead of rebuilt.
        ListRow(note: note, query: search, showFolder: scope == .all || !search.isEmpty,
                dragWith: dragOthers(for: note), selectedCount: selection.count,
                togglePin: { withAnimation(.snappy) { context.togglePin(note) } },
                remove: { remove(note) })
            .equatable()
            .tag(note.id)
            // Outside the equatable row, so the list sees its background.
            .hoverRow(note.title)
            #if os(iOS)
            .listRowBackground(Color(Palette.row))
            #endif
    }

    #if os(iOS)
    /// "Did you know" for what isn't a button here, as a row at the top of the list.
    private var listTip: some View {
        // One grouped card, like the Get set up card: the tip is the row, on the row's own surface.
        Section { CompactTip(tip: ShareExtensionTip(), card: false).selectionDisabled() }
            .listRowBackground(Color(Palette.row))
    }
    #endif

    #if os(iOS)
    /// Follows whether the list's tip is due, and records it as shown when it is.
    private func watchListTip() async {
        let tip = ShareExtensionTip()
        for await due in tip.shouldDisplayUpdates {
            listTipDue = due
            if due { TipLog.shown(tip.id) }
        }
    }
    #endif

    private func setupCard(_ setup: SetupStore, _ progress: SetupProgress) -> some View {
        #if os(macOS)
        let onImport: (() -> Void)? = { imports?.appleNotes() }
        let onShareHowTo: (() -> Void)? = nil
        #else
        let onImport: (() -> Void)? = nil
        let onShareHowTo: (() -> Void)? = { sharingHowTo = true }
        #endif
        return SetupCard(
            progress: progress,
            celebrating: setup.showingCelebration,
            onImport: onImport,
            onImportFrom: { kind in imports?.from(kind) },
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

    /// ambernotes.app/open/connect-ai from an email: Settings, at AI (Connect an AI).
    private func openConnectAI(_ place: AppPlace?) {
        guard place == .connectAI else { return }
        AppPlaceCenter.shared.pending = nil
        SettingsRoute.shared.open(.ai)
        #if os(iOS)
        showSettings = true
        #else
        openSettings()
        #endif
    }

    /// The storage warning opens Settings at Storage: what takes the room.
    private func openStorage() {
        SettingsRoute.shared.open(.storage)
        #if os(iOS)
        showSettings = true
        #else
        openSettings()
        #endif
    }

    private func whatsNewCard(_ release: WhatsNew.Release) -> some View {
        WhatsNewCard(release: release, secondary: whatsNew.secondary, onDismiss: dismissWhatsNew) {
            SettingsRoute.shared.open(.ai)
            #if os(iOS)
            showSettings = true
            #else
            openSettings()
            #endif
            dismissWhatsNew()
        }
        .onAppear { whatsNew.shown(progress: setup?.progress) }
    }

    /// Exits are quieter than the entrance: a short fade as the row goes.
    private func dismissWhatsNew() {
        withAnimation(.easeOut(duration: 0.18)) { whatsNew.dismiss() }
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
            ContentUnavailableView("No Deleted Notes", systemImage: "trash", description: Text("Notes and files you delete stay here for 30 days."))
        } else {
            ContentUnavailableView {
                Label { Text("No Notes") } icon: { AppMark(size: 56) }
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
        let files = ids.compactMap { context.attachment($0) }.filter { $0.folderID != nil && $0.deletedAt == nil }
        if !files.isEmpty {
            if notes.isEmpty && files.count == 1, let file = files.first {
                menu(for: file, folders: folders)
            } else {
                mixedMenu(ids: ids, notes: notes, files: files, folders: folders)
            }
        } else if notes.count == 1, let note = notes.first {
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
            // A locked note's text isn't here to send or copy.
            if !note.isLocked {
                ShareLink(item: note.body, preview: SharePreview(note.title))
                Button("Duplicate", systemImage: "plus.square.on.square") {
                    let copy = context.createNote(in: note.folder.map { .folder($0.id) } ?? .all, body: note.body)
                    selection = [copy.id]
                }
            }
            Divider()
            deleteButton(note)
        }
    }

    @ViewBuilder
    private func menu(for file: Attachment, folders: [Folder]) -> some View {
        if file.trashedAt != nil {
            Button("Recover", systemImage: "arrow.uturn.backward") { withAnimation(.snappy) { context.restore(file) } }
            Button("Delete Forever…", systemImage: "trash", role: .destructive) { remove([file.id]) }
        } else {
            Button("Rename…", systemImage: "pencil") {
                fileNameDraft = FolderFileName.stem(file.filename)
                renamingFile = file
            }
            Menu("Move to", systemImage: "folder") {
                ForEach(folders) { f in
                    Button(f.name) { withAnimation(.snappy) { context.move(file, to: f) } }
                        .disabled(file.folderID == f.id)
                }
            }
            if FileStore.exists(file) {
                ShareLink(item: FileStore.url(for: file.id, filename: file.filename))
                Button(FileOut.exportTitle, systemImage: FileOut.exportSymbol) { exportingFile = file }
            }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) { remove([file.id]) }
        }
    }

    /// Several items, files among them.
    @ViewBuilder
    private func mixedMenu(ids: Set<UUID>, notes: [Note], files: [Attachment], folders: [Folder]) -> some View {
        let count = notes.count + files.count
        if notes.allSatisfy({ $0.trashedAt != nil }) && files.allSatisfy({ $0.trashedAt != nil }) {
            Button("Recover \(count) Items", systemImage: "arrow.uturn.backward") {
                withAnimation(.snappy) {
                    notes.forEach(context.restore)
                    files.forEach(context.restore)
                }
            }
            Button("Delete \(count) Items Forever…", systemImage: "trash", role: .destructive) { remove(ids) }
        } else {
            Menu("Move \(count) Items to", systemImage: "folder") {
                ForEach(folders) { f in
                    Button(f.name) { withAnimation(.snappy) { move(ids, to: f) } }
                }
            }
            Divider()
            Button("Delete \(count) Items", systemImage: "trash", role: .destructive) { remove(ids) }
        }
    }

    /// Moves notes and files together.
    private func move(_ ids: Set<UUID>, to folder: Folder) {
        context.move(ids.compactMap { context.note($0) }, to: folder)
        for f in ids.compactMap({ context.attachment($0) }) where f.folderID != nil { context.move(f, to: folder) }
    }

    /// Dragging a selected note carries the whole selection; any other note goes alone (nil).
    private func dragOthers(for note: Note) -> [UUID]? {
        guard selection.count > 1, selection.contains(note.id) else { return nil }
        return selection.filter { $0 != note.id }.sorted { $0.uuidString < $1.uuidString }
    }

    private func moveSelection(to folder: Folder) {
        withAnimation(.snappy) { move(selection, to: folder) }
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
            || ids.compactMap { context.attachment($0) }.contains { $0.trashedAt != nil }
        if forever { pendingForever = ids } else { performRemove(ids) }
    }

    private var foreverTitle: String {
        let notes = (pendingForever ?? []).compactMap { context.note($0) }
        let files = (pendingForever ?? []).compactMap { context.attachment($0) }
        if files.isEmpty {
            return notes.count == 1 ? "Delete \u{201C}\(notes[0].title)\u{201D} forever?" : "Delete \(notes.count) notes forever?"
        }
        if notes.isEmpty && files.count == 1 { return "Delete \u{201C}\(files[0].filename)\u{201D} forever?" }
        return "Delete \(notes.count + files.count) items forever?"
    }

    private func performRemove(_ ids: Set<UUID>) {
        let ordered = orderedItems
        let notes = ids.compactMap { context.note($0) }
        let files = ids.compactMap { context.attachment($0) }.filter { $0.folderID != nil }
        let touchedSelection = !selection.isDisjoint(with: ids)
        let firstIndex = ordered.firstIndex { ids.contains($0.id) }
        withAnimation(.snappy(duration: 0.25)) {
            context.remove(notes)
            context.remove(files: files)
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

/// Every note in the library, for the list. A query of every note fetched and wrapped all of them
/// again after any change at all: each save while you type, and again when sync marks the note
/// sent (with 2,000 notes about half of each save's time). Here they're fetched when the list
/// first shows and again only when a save adds or deletes notes. Everything else the list shows
/// (dates, folders, trash, pins) it reads from the notes themselves, so those changes still update
/// it, through observation.
@MainActor @Observable
final class LibraryNotes {
    /// Goes up with each new fetch; reading it is what updates the list.
    private var generation = 0
    @ObservationIgnored private var all: [Note] = []
    @ObservationIgnored private weak var context: ModelContext?
    @ObservationIgnored private var observer: NSObjectProtocol?

    func notes(in context: ModelContext) -> [Note] {
        if self.context !== context { start(context) }
        _ = generation
        return all
    }

    private func start(_ context: ModelContext) {
        self.context = context
        all = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = NotificationCenter.default.addObserver(forName: ModelContext.didSave, object: context, queue: nil) { [weak self] n in
            let keys = [ModelContext.NotificationKey.insertedIdentifiers, .deletedIdentifiers].map(\.rawValue)
            let changed = keys.contains { !((n.userInfo?[$0] as? [PersistentIdentifier]) ?? []).isEmpty }
            guard changed else { return }
            MainActor.assumeIsolated { self?.refetch() }
        }
    }

    private func refetch() {
        guard let context else { return }
        all = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        generation += 1
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
    /// The app mark's size: about the title's cap height.
    static let markSize: CGFloat = 13
    /// A file's thumbnail on the trailing side, about the two lines' height.
    static let thumbnail: CGFloat = 32
    #else
    static let markSize: CGFloat = 16
    static let thumbnail: CGFloat = 42
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
    @Environment(SyncEngine.self) private var sync: SyncEngine?

    var body: some View {
        let title = note.title
        // Shared by link, by this account (the share's tag verified): a small link, like Notes.
        let shared = sync?.liveShares[note.id] != nil && !note.isLocked && note.trashedAt == nil
        // At the accessibility text sizes the row stacks and wraps instead of truncating.
        let large = typeSize.isAccessibilitySize
        let detail = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(spacing: 8))
        let ai = AIEdit.isUnseen(note) ? note.aiEditor : nil
        let app = NoteAppMark.has(note)
        return VStack(alignment: .leading, spacing: RowMetrics.spacing) {
            HStack(spacing: 5) {
                Text(title)
                    .font(RowMetrics.title)
                    .foregroundStyle(Color.ink)
                    .lineLimit(large ? 3 : 1)
                if app {
                    AppMarkView(size: RowMetrics.markSize)
                        .accessibilityIdentifier("note.app")
                }
            }
            // An AI changed this note and you haven't opened it since, like Mail's unread dot.
            .overlay(alignment: .leading) {
                if ai != nil {
                    Circle().fill(.tint).frame(width: 8, height: 8)
                        .offset(x: RowMetrics.dotOffset)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            detail {
                HStack(spacing: 4) {
                    if shared {
                        Image(systemName: "link")
                            .imageScale(.small)
                            .foregroundStyle(Color.muted)
                            .accessibilityHidden(true)
                            .accessibilityIdentifier("note.shared")
                    }
                    Text(DateBucket.rowDate(note.updatedAt))
                        .monospacedDigit()
                        .foregroundStyle(Color.ink.opacity(0.85))
                }
                if note.isLocked {
                    // Like Notes: the title and a lock, nothing of the text.
                    Label("Locked", systemImage: "lock.fill")
                        .labelStyle(LockedRowLabel())
                        .foregroundStyle(Color.muted)
                        .lineLimit(1)
                } else if let ai {
                    HStack(spacing: 4) {
                        AIGlyph(ai: ai, size: 11)
                        Text(AIEdit.wroteIt(note) ? "Written by \(ai)" : "Edited by \(ai)")
                    }
                    .foregroundStyle(Color.amberInk)
                    .lineLimit(1)
                } else {
                    Text(snippet)
                        .foregroundStyle(Color.muted)
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
                .foregroundStyle(Color.muted)
            }
        }
        .padding(.vertical, RowMetrics.vertical)
        .padding(.leading, RowMetrics.leading)
        .accessibilityElement(children: .combine)
        .accessibilityValue([note.isPinned ? "Pinned" : nil, app ? "App" : nil, shared ? "Shared" : nil, note.isLocked ? "Locked" : nil, ai.map { "Edited by \($0)" }].compactMap { $0 }.joined(separator: ", "))
        .accessibilityIdentifier("note.\(title)")
    }

    /// The lock sits close to its word, like the list's other small glyphs.
    private struct LockedRowLabel: LabelStyle {
        func makeBody(configuration: Configuration) -> some View {
            HStack(spacing: 4) {
                configuration.icon.imageScale(.small)
                configuration.title
            }
        }
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
