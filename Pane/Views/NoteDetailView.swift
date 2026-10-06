import QuickLook
import SwiftData
import SwiftUI
import TipKit
import UniformTypeIdentifiers

struct NoteDetailView: View {
    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var importing = false
    @State private var saver = DebouncedSave()
    @State private var shareLinks = ShareLinkStore()
    @State private var showHistory = HistoryLaunch.open
    /// "ChatGPT changed 5 lines · Undo", while an AI's edit that just landed is on show.
    @State private var receipt: AIEdit.Receipt?
    @State private var undoFailed: String?
    /// For Undo of a page an AI made: the page before it (nil: none).
    @State private var undoPage: NotePageStore.Page?
    /// Lock Note: setting the password up, asking for it, or confirming.
    @State private var lockSheet: LockSheet?
    @State private var confirmLock = false
    @State private var lockProblem: String?
    /// Note pages (prototype): Page or Text, when the note has a page.
    @State private var mode: NoteMode = .page
    /// The text before edits made on the page, tinted once Text shows again.
    @State private var pageTint: String?
    /// The page as last shown, to tell an AI's new page from one already seen.
    @State private var shownPage: NotePageStore.Page?
    @Bindable var note: Note
    let controller: EditorController
    var autofocus = false
    let onNewNote: () -> Void
    /// Opens another note; `edit` puts the keyboard in it.
    var onOpenNote: (UUID, Bool) -> Void = { _, _ in }

    var body: some View {
        chrome(editor)
            .quickLookPreview(previewBinding)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true, onCompletion: attach)
            .onAppear(perform: wireController)
            .onDisappear { saver.flush() }
            .shareLinkChrome(shareLinks, note: note)
            .focusedSceneValue(\.showHistoryAction, { if !note.isLocked { showHistory = true } })
            .sheet(item: $lockSheet) { step in
                switch step {
                case .setUp: NotesPasswordSetupSheet { lockNote() }
                case .password: NotesPasswordPrompt(message: "Enter your notes password to lock this note.") { confirmLock = true }
                }
            }
            .confirmationDialog(lockTitle, isPresented: $confirmLock, titleVisibility: .visible) {
                Button("Lock Note") { lockNote() }
                    .accessibilityIdentifier("lock.confirm")
            } message: {
                Text("Its earlier versions are removed from version history, so no readable copy is kept, and if it has a share link, the link stops working.")
            }
            .alert("Can't lock this note", isPresented: Binding(get: { lockProblem != nil }, set: { if !$0 { lockProblem = nil } })) {
                Button("OK") {}
            } message: { Text(lockProblem ?? "") }
            .sheet(isPresented: $showHistory) {
                if let history = NoteHistory.shared { VersionHistorySheet(note: note, history: history) }
            }
            #if os(iOS)
            .safeAreaInset(edge: .bottom, spacing: 0) { phoneTips }
            #endif
            .overlay(alignment: .bottom) { aiReceipt }
            .overlay(alignment: .bottom) { undoProblem }
            .onChange(of: note.aiEditedAt) { _, _ in showAIEdit() }
            .onChange(of: NotePageStore.shared[note.id]) { _, now in pageArrived(now) }
            .onChange(of: mode) { _, now in if now == .text { tintPageEdits() } }
            // Captures: `-lockCapture setup` or `confirm` (see Capture).
            .onReceive(NotificationCenter.default.publisher(for: Capture.lockCapture)) { n in
                switch n.object as? String {
                case "setup": lockSheet = .setUp
                case "confirm": confirmLock = true
                default: break
                }
            }
            // Captures: the "landed" moment is over.
            .onReceive(NotificationCenter.default.publisher(for: Capture.clearAIMarks)) { _ in
                withAnimation(.easeIn(duration: 0.2)) { receipt = nil }
                controller.clearTint()
            }
            .task(id: note.id) {
                receipt = nil
                shownPage = NotePageStore.shared[note.id]
                pageTint = nil
                mode = .page
                showAIEdit()
                #if os(macOS)
                PaneTips.menuBarShown = MenuBarSettings.allowed && UserDefaults.standard.object(forKey: MenuBarSettings.key) as? Bool ?? true
                #endif
                PaneTips.noteOpened(note.body)
                ShareAsk.noteUsed()
            }
            .onChange(of: showHistory) { _, open in if open { FeatureUse.mark(.versionHistory) } }
            // "See your note's history" from an email opened this note to show its history.
            .onChange(of: AppPlaceCenter.shared.historyFor, initial: true) { _, id in
                guard id == note.id else { return }
                AppPlaceCenter.shared.historyFor = nil
                if !note.isLocked { showHistory = true }
            }
    }

    #if os(iOS)
    /// On iPhone the note's tips sit just above the toolbar: a popover from a toolbar button
    /// never appears there. TipKit shows at most one of them, and only when it's due. The note
    /// keeps room below its last line so it can scroll clear of the tip.
    private var phoneTips: some View {
        VStack(spacing: 8) {
            CompactTip(tip: VersionHistoryTip()) { a in if a.id == "open" { showHistory = true } }
            CompactTip(tip: ShareLinkTip())
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .onGeometryChange(for: CGFloat.self, of: \.size.height) { controller.bottomReserve = $0 }
    }
    #endif

    @ViewBuilder
    private var undoProblem: some View {
        if let undoFailed {
            Text(undoFailed)
                .font(.system(size: AIReceipt.text, weight: .semibold))
                .padding(.horizontal, 14)
                .frame(height: AIReceipt.height)
                .background(.regularMaterial, in: .capsule)
                #if os(macOS)
                .padding(.bottom, 20)
                #else
                .padding(.bottom, 64)
                #endif
                .transition(.opacity)
                .accessibilityAddTraits(.isStaticText)
        }
    }

    @ViewBuilder
    private var aiReceipt: some View {
        if let receipt {
            AIReceipt(receipt: receipt) { undo(receipt) }
            #if os(macOS)
            .padding(.bottom, 20)
            #else
            .padding(.bottom, 64)
            #endif
            .transition(AIReceipt.transition(reduceMotion: reduceMotion))
        }
    }

    /// An AI's edit you haven't seen: tint what it changed and say who did it. Opening the note
    /// counts as seeing it; the tint and the receipt then go on their own.
    private func showAIEdit() {
        guard let r = AIEdit.markSeen(note) else { return }
        try? context.save()
        let slow = ChangeTint.slowMotion
        Task { @MainActor in
            // Let the editor take the new text first.
            try? await Task.sleep(for: .seconds(0.15 * slow))
            guard note.id == r.noteID else { return }
            controller.tintChanges(from: r.previous)
            withAnimation(.spring(duration: 0.45 * slow, bounce: 0.25)) { receipt = r }
            PaneTips.aiEditLanded()
            try? await Task.sleep(for: .seconds(5.5 * slow))
            while ChangeTint.holdForCapture, receipt == r { try? await Task.sleep(for: .seconds(0.1)) }
            guard receipt == r else { return }
            withAnimation(.easeIn(duration: 0.2 * slow)) { receipt = nil }
        }
    }

    private func undo(_ r: AIEdit.Receipt) {
        withAnimation(.smooth(duration: 0.25)) { receipt = nil }
        if r.kind == .pageMade {
            // The note's text never changed: the page goes back to what it was.
            shownPage = undoPage
            NotePageStore.shared[note.id] = undoPage
            if undoPage == nil { mode = .text }
            return
        }
        if r.kind == .pageEdit { pageTint = nil }
        // The editor takes the old text as an outside change, which also clears the tint.
        let note = self.note
        Task { @MainActor in
            do {
                try await AIEdit.undo(r, on: note)
            } catch {
                // Couldn't reach the server: say so where the receipt was.
                withAnimation(.smooth(duration: 0.25)) { undoFailed = (error as? LocalizedError)?.errorDescription ?? "Couldn't undo. Try again." }
                try? await Task.sleep(for: .seconds(4))
                withAnimation(.smooth(duration: 0.25)) { undoFailed = nil }
            }
        }
    }

    private var vault: NoteVault { .shared }

    /// The editor, or for a locked note that isn't open, the lock.
    @ViewBuilder
    private var editor: some View {
        if let text = vault.text(of: note) {
            // Both stay alive, so switching is instant and the editor can tint what the page changed.
            ZStack {
                MarkdownEditor(initialText: text, header: DateBucket.header(note.updatedAt), controller: controller, autofocus: autofocus, onChange: save)
                    .onAppear { if note.isLocked { vault.touch() } }
                    .opacity(showingPage ? 0 : 1)
                    .allowsHitTesting(!showingPage)
                    .accessibilityHidden(showingPage)
                if let page = notePage {
                    NotePageView(html: page.html, text: text, onUpdate: applyPageEdit)
                        .id(note.id)
                        .opacity(showingPage ? 1 : 0)
                        .allowsHitTesting(showingPage)
                        .accessibilityHidden(!showingPage)
                }
            }
        } else {
            LockedNoteView(note: note)
        }
    }

    /// A locked note that isn't open: nothing on screen to edit. The page has no caret either.
    private var hidden: Bool { vault.text(of: note) == nil || showingPage }

    // MARK: Note pages (prototype)

    enum NoteMode: String { case page, text }

    /// The note's page, unless the note is locked (a locked note never shows one).
    private var notePage: NotePageStore.Page? { note.isLocked ? nil : NotePageStore.shared[note.id] }
    private var showingPage: Bool { notePage != nil && mode == .page }

    /// An edit the page asked for, applied to the markdown as an edit of yours: it syncs, keeps a
    /// version, and the receipt offers Undo. The page re-renders from the new text.
    private func applyPageEdit(_ op: NotePage.Op) throws {
        let before = note.body
        let after = try NotePage.apply(op, to: before)
        guard after != before else { return }
        note.body = after
        note.touch()
        try? context.save()
        if pageTint == nil { pageTint = before }
        let r = AIEdit.Receipt(noteID: note.id, by: AIGlyph.page, at: .now, previous: before, after: after,
                               lines: ChangeTint.changedLines(from: before, to: after).count, kind: .pageEdit)
        withAnimation(.spring(duration: 0.45, bounce: 0.25)) { receipt = r }
        Task { @MainActor in
            // Longer than an AI's: you may switch to Text to see the change before you undo it.
            try? await Task.sleep(for: .seconds(10 * ChangeTint.slowMotion))
            while ChangeTint.holdForCapture, receipt == r { try? await Task.sleep(for: .seconds(0.1)) }
            if receipt == r { withAnimation(.easeIn(duration: 0.2)) { receipt = nil } }
        }
    }

    /// Back in Text: what the page changed is tinted, as an AI's edit is.
    private func tintPageEdits() {
        guard let before = pageTint else { return }
        pageTint = nil
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.15 * ChangeTint.slowMotion))
            controller.tintChanges(from: before)
        }
    }

    /// A page an AI made or changed while the note is open: show it, say who, offer Undo.
    private func pageArrived(_ now: NotePageStore.Page?) {
        let before = shownPage
        shownPage = now
        guard let now, now != before, now.by != AIGlyph.page else { return }
        withAnimation(.smooth(duration: 0.3)) { mode = .page }
        let r = AIEdit.Receipt(noteID: note.id, by: now.by, at: now.at, previous: note.body, lines: 0, kind: .pageMade)
        undoPage = before
        withAnimation(.spring(duration: 0.45, bounce: 0.25)) { receipt = r }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(5.5 * ChangeTint.slowMotion))
            while ChangeTint.holdForCapture, receipt == r { try? await Task.sleep(for: .seconds(0.1)) }
            if receipt == r { withAnimation(.easeIn(duration: 0.2)) { receipt = nil } }
        }
    }

    /// Page / Text, shown only when the note has a page.
    private var modePicker: some View {
        Picker("View", selection: $mode.animation(.smooth(duration: 0.25))) {
            Text("Page").tag(NoteMode.page)
            Text("Text").tag(NoteMode.text)
        }
        .pickerStyle(.segmented)
        .fixedSize()
        .accessibilityIdentifier("note.mode")
    }

    enum LockSheet: String, Identifiable {
        case setUp, password
        var id: String { rawValue }
    }

    private var lockTitle: String {
        note.title.isEmpty ? "Lock this note?" : "Lock \u{201C}\(note.title)\u{201D}?"
    }

    /// Lock Note: sets the notes password up the first time, asks for it while notes are locked.
    private func startLock() {
        if let why = NoteVault.blocker(for: note) { lockProblem = why.errorDescription; return }
        Task { @MainActor in
            if !vault.isSetUp { await vault.refresh() }
            if !vault.isSetUp { lockSheet = .setUp } else if !vault.isUnlocked { lockSheet = .password } else { confirmLock = true }
        }
    }

    private func lockNote() {
        // Typing not yet in the note goes in first, then it's sealed.
        saver.flush()
        do {
            try vault.lock(note)
            try? context.save()
            shareLinks.forgetLink()
        } catch {
            lockProblem = (error as? LocalizedError)?.errorDescription ?? "Try again."
        }
    }

    private func removeLock() {
        saver.flush()
        try? vault.removeLock(note)
        try? context.save()
    }

    private func chrome(_ content: some View) -> some View {
        content
            .ignoresSafeArea(.container, edges: .bottom)
            .background(Color.notePage.ignoresSafeArea())
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    if let parent = parentNote { parentLink(parent) }
                    if note.trashedAt != nil { trashBanner }
                }
            }
            .navigationTitle("")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(controller.isEditing ? .hidden : .automatic, for: .bottomBar)
            .animation(.snappy(duration: 0.2), value: controller.isEditing)
            #endif
            .toolbar { toolbar }
    }

    /// Every keystroke lands here; the model is written once typing pauses.
    private func save(_ text: String) {
        PaneTips.typed()
        ShareAsk.noteUsed(typing: true)
        let note = self.note
        let vault = self.vault
        saver.schedule(base: vault.text(of: note) ?? note.body) { [saver] in
            // Something else rewrote the note meanwhile (sync, an AI): the editor
            // already shows that version, so this older text must not win.
            guard (vault.text(of: note) ?? note.body) == saver.base else { return }
            write(text, to: note)
        }
    }

    private func write(_ text: String, to note: Note) {
        if note.isLocked {
            // Sealed again as you type; the title in the list follows.
            guard text != vault.text(of: note) else { return }
            let oldTitle = note.title
            try? vault.write(text, to: note)
            if note.title != oldTitle { relabelLinkInParent() }
            return
        }
        guard text != note.body else { return }
        if TipTriggers.isBigDeletion(from: note.body, to: text) { PaneTips.deletedALot() }
        let oldTitle = note.title
        note.body = text
        note.touch()
        if note.title != oldTitle { relabelLinkInParent() }
    }

    private var parentNote: Note? {
        guard let pid = note.parentID, let p = context.note(pid), p.deletedAt == nil else { return nil }
        return p
    }

    /// "← Parent": sub-notes lead back to the note that holds them.
    private func parentLink(_ parent: Note) -> some View {
        HStack {
            Button { onOpenNote(parent.id, false) } label: {
                Label(parent.title, systemImage: "chevron.left")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .accessibilityIdentifier("subnote.parent")
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    /// Keeps the parent's link text in step with this sub-note's title, for readers and AI tools.
    private func relabelLinkInParent() {
        guard let parent = parentNote else { return }
        let id = note.id.uuidString.lowercased()
        let label = note.title.replacingOccurrences(of: "]", with: ")").replacingOccurrences(of: "[", with: "(")
        let pattern = #"\[[^\]]*\]\(pane-note:"# + id + #"\)"#
        let updated = parent.body.replacingOccurrences(of: pattern, with: "[\(label)](pane-note:\(id))", options: .regularExpression)
        if updated != parent.body {
            parent.body = updated
            parent.dirty = true
            SyncSignal.changed()
        }
    }

    /// A new sub-note, linked where the caret is, opened for writing.
    private func createSubNote() {
        let child = context.createSubNote(of: note)
        controller.insertLines(["[New sub-note](pane-note:\(child.id.uuidString.lowercased()))"])
        onOpenNote(child.id, true)
    }

    private func attach(_ result: Result<[URL], Error>) {
        if case .success(let urls) = result { controller.insertFiles(context.addAttachments(urls)) }
    }

    private var previewBinding: Binding<URL?> {
        Binding(get: { controller.previewURL }, set: { controller.previewURL = $0 })
    }

    /// Gives the editor what it needs from this screen: files, downloads, the picker.
    private func wireController() {
        let context = self.context
        let sync = self.sync
        controller.resolveAttachment = { id in context.attachment(id) }
        controller.resolveNote = { id in context.note(id).map { ($0.title, $0.preview) } }
        controller.openNote = { id in onOpenNote(id, false) }
        // A locked note's files and sub-notes would stay readable: it can't take them.
        controller.newSubNote = { if !note.isLocked { createSubNote() } }
        controller.download = { a in await sync?.download(a) ?? false }
        controller.attach = { importing = true }
        controller.addFiles = { urls in note.isLocked ? [] : context.addAttachments(urls) }
        controller.addData = { data, name, type in
            guard !note.isLocked, let a = try? FileStore.importData(data, filename: name, type: type) else { return nil }
            context.insert(a)
            try? context.save()
            SyncSignal.changed()
            return a
        }
    }

    private var trashBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "trash").foregroundStyle(.secondary)
            Text("This note is in Recently Deleted.")
                .font(.callout)
            Spacer()
            Button("Recover") { withAnimation(.snappy) { context.restore(note) } }
                .buttonStyle(.glassProminent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .padding(12)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if notePage != nil {
            ToolbarItem(placement: .principal) { modePicker }
        }
        #if os(iOS)
        ToolbarItem(placement: .bottomBar) {
            Button("Checklist", systemImage: "checklist", action: controller.checklist).disabled(hidden)
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Table", systemImage: "tablecells", action: controller.insertTable).disabled(hidden)
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Attach", systemImage: "paperclip") { importing = true }.disabled(note.isLocked || showingPage)
        }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        ToolbarItem(placement: .bottomBar) {
            Button("New Note", systemImage: "square.and.pencil", action: onNewNote)
        }
        ToolbarItem(placement: .primaryAction) { moreMenu }
        #else
        // Like Notes: compose first (just right of the divider), the writing tools together, then share and more.
        ToolbarItem {
            Button(action: onNewNote) {
                // The pencil pokes out top-right; ToolbarGlyph re-centres its ink.
                Label { Text("New Note") } icon: { ToolbarGlyph.image("square.and.pencil", shift: ToolbarGlyph.composeShift) }
            }
                .help("New Note (⌘N)")
                // The menu bar's quick capture is the other way to start a note.
                .paneTip(MenuBarTip(), arrowEdge: .top)
                .accessibilityIdentifier("list.newNote")
        }
        ToolbarSpacer(.flexible)
        ToolbarItemGroup {
            formatMenu.disabled(hidden)
            Button("Checklist", systemImage: "checklist", action: controller.checklist)
                .help("Checklist (⇧⌘L)")
                .disabled(hidden)
            Button("Table", systemImage: "tablecells", action: controller.insertTable)
                .help("Table (⌥⌘T)")
                .disabled(hidden)
            Button("Attach", systemImage: "paperclip") { importing = true }
                .help("Attach File (⇧⌘A)")
                .disabled(note.isLocked)
        }
        ToolbarSpacer(.fixed)
        ToolbarItemGroup {
            shareMenu
            moreMenu
        }
        #endif
    }

    private var formatMenu: some View {
        Menu {
            Section {
                Button("Title") { controller.heading(1) }
                Button("Heading") { controller.heading(2) }
                Button("Subheading") { controller.heading(3) }
                Button("Body") { controller.heading(0) }
            }
            Section {
                Button("Bold", systemImage: "bold", action: controller.bold)
                Button("Italic", systemImage: "italic", action: controller.italic)
                Button("Underline", systemImage: "underline", action: controller.underline)
                Button("Strikethrough", systemImage: "strikethrough", action: controller.strikethrough)
                Button("Monostyled", systemImage: "chevron.left.forwardslash.chevron.right", action: controller.code)
            }
            Section {
                Button("Bulleted List", systemImage: "list.bullet", action: controller.bulletList)
                Button("Dashed List", systemImage: "list.dash", action: controller.dashedList)
                Button("Numbered List", systemImage: "list.number", action: controller.numberedList)
                Button("Block Quote", systemImage: "text.quote", action: controller.blockQuote)
            }
            Section {
                Button("Sub-note", systemImage: "doc.badge.plus") { controller.newSubNote() }.disabled(note.isLocked)
                Button("Link", systemImage: "link", action: controller.insertLink)
            }
        } label: {
            Label("Format", systemImage: "textformat")
        }
        #if os(macOS)
        .tint(.primary)
        #endif
        .accessibilityIdentifier("editor.format")
    }

    /// Everything about sharing in one place, like Notes: the public link, and sending a copy.
    @ViewBuilder
    private var shareItems: some View {
        ShareLinkMenuSection(store: shareLinks, note: note)
        Section {
            ShareLink(item: note.body, preview: SharePreview(note.title)) {
                Label("Send a Copy…", systemImage: "square.and.arrow.up")
            }
        }
    }

    private var shareMenu: some View {
        Menu { shareItems } label: {
            Label("Share", systemImage: "square.and.arrow.up")
        }
        // A locked note can't be shared, and its text isn't here to send.
        .disabled(note.isLocked)
        #if os(macOS)
        .tint(.primary)
        #endif
        .help("Share")
        .paneTip(ShareLinkTip(), arrowEdge: .top)
        .accessibilityIdentifier("editor.share")
    }

    private var moreMenu: some View {
        Menu {
            Button(note.isPinned ? "Unpin Note" : "Pin Note", systemImage: note.isPinned ? "pin.slash" : "pin") {
                withAnimation(.snappy) { context.togglePin(note) }
            }
            Menu("Move to", systemImage: "folder") {
                ForEach(context.allFolders()) { f in
                    Button(f.name) { context.move(note, to: f) }.disabled(note.folder?.id == f.id)
                }
            }
            if !note.isLocked {
                #if os(iOS)
                Menu("Share", systemImage: "square.and.arrow.up") { shareItems }
                Button("Show Version History", systemImage: "clock.arrow.circlepath") { showHistory = true }
                #else
                Button("Show Version History…", systemImage: "clock.arrow.circlepath") { showHistory = true }
                #endif
            }
            if notePage != nil {
                Button("Remove Page", systemImage: "square.grid.2x2") {
                    // The note's text stays as it is: the page was only a view of it.
                    NotePageStore.shared[note.id] = nil
                    shownPage = nil
                    mode = .text
                }
                .accessibilityIdentifier("editor.removePage")
            }
            Divider()
            if note.isLocked {
                if vault.isUnlocked {
                    Button("Lock Now", systemImage: "lock") { vault.lockNow() }
                        .accessibilityIdentifier("editor.lockNow")
                    Button("Remove Lock", systemImage: "lock.open", action: removeLock)
                        .accessibilityIdentifier("editor.removeLock")
                }
            } else if note.trashedAt == nil {
                Button("Lock Note", systemImage: "lock", action: startLock)
                    .accessibilityIdentifier("editor.lock")
            }
            Divider()
            Button("Delete Note", systemImage: "trash", role: .destructive) {
                withAnimation(.snappy) { context.trash(note) }
            }
        } label: {
            Label("More", systemImage: "ellipsis")
        }
        #if os(macOS)
        .tint(.primary)
        #endif
        #if os(macOS)
        .paneTip(VersionHistoryTip(), arrowEdge: .top) { action in
            if action.id == "open" { showHistory = true }
        }
        #endif
        .accessibilityIdentifier("editor.more")
    }
}
