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
    /// For Undo of a change to the app's own data: the data before it.
    @State private var undoData: NotePageData.Doc?
    /// The app asks to reach a host: shown as a question, answered once per host.
    @State private var hostAsk: HostAsk?
    /// The app needs an API key that isn't set up: the card that offers to add it.
    @State private var keyNeeded: NotePageNetwork.KeyNeed?
    @State private var addingKey: APIKeyForm.Draft?
    @State private var showNetLog = false
    @State private var showMakeApp = false
    @State private var showAppSettings = false
    /// "Make this an app", once per note, on notes that look like one.
    @State private var showChip = false

    struct HostAsk: Identifiable {
        let host: String
        let answer: (Bool) -> Void
        var id: String { host }
    }
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
    /// Pages that failed to load here: never fallen back to twice.
    @State private var failedPages: Set<String> = []
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
            .safeAreaInset(edge: .bottom, spacing: 0) { if !showingPage { phoneTips } }
            #endif
            .overlay(alignment: .bottom) { aiReceipt }
            .overlay(alignment: .bottom) { undoProblem }
            .overlay(alignment: .bottom) { keyCard }
            .alert("This app wants to reach \(hostAsk?.host ?? "")", isPresented: Binding(get: { hostAsk != nil }, set: { if !$0, let a = hostAsk { a.answer(false); hostAsk = nil } })) {
                Button("Don't Allow", role: .cancel) { hostAsk?.answer(false); hostAsk = nil }
                Button("Allow") { hostAsk?.answer(true); hostAsk = nil }
            } message: {
                Text("Everything it sends there is listed in More › Network Activity.")
            }
            .sheet(item: $addingKey) { d in APIKeyForm(draft: d) }
            .sheet(isPresented: $showNetLog) { NotePageNetLogView(noteID: note.id) }
            .sheet(isPresented: $showMakeApp) { MakeAppSheet(title: note.title, body_: note.body) }
            .sheet(isPresented: $showAppSettings) { if let p = notePage { AppSettingsSheet(noteID: note.id, html: p.html) } }
            .overlay(alignment: .bottom) {
                if showChip, notePage == nil, receipt == nil {
                    MakeAppChip(open: { showChip = false; showMakeApp = true }, dismiss: { withAnimation(.smooth) { showChip = false } })
                        #if os(macOS)
                        .padding(.bottom, 20)
                        #else
                        .padding(.bottom, 64)
                        #endif
                        .transition(AIReceipt.transition(reduceMotion: reduceMotion))
                }
            }
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
                if shownPage != nil { NotePageTiming.open(note.id) }
                showChip = false
                pageTint = nil
                mode = .page
                showAIEdit()
                #if os(macOS)
                PaneTips.menuBarShown = MenuBarSettings.allowed && UserDefaults.standard.object(forKey: MenuBarSettings.key) as? Bool ?? true
                #endif
                PaneTips.noteOpened(note.body)
                ShareAsk.noteUsed()
                // "Make this an app", once per note, a moment after it opens (last: it waits).
                if shownPage == nil, !note.isLocked, !MakeAnApp.chipShown(note.id), MakeAnApp.looksLikeAnApp(note.body) {
                    MakeAnApp.markChipShown(note.id)
                    try? await Task.sleep(for: .seconds(1.2))
                    if !Task.isCancelled { withAnimation(.spring(duration: 0.45, bounce: 0.25)) { showChip = true } }
                }
            }
            .onChange(of: showHistory) { _, open in if open { FeatureUse.mark(.versionHistory) } }
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
            // Room for two lines: a notice is never squeezed into one.
            Text(undoFailed)
                .font(.system(size: AIReceipt.text, weight: .semibold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(minHeight: AIReceipt.height)
                .background(.regularMaterial, in: .rect(cornerRadius: AIReceipt.height / 2))
                .padding(.horizontal, 24)
                #if os(macOS)
                .padding(.bottom, 20)
                #else
                .padding(.bottom, 64)
                #endif
                .transition(.opacity)
                .accessibilityAddTraits(.isStaticText)
                .accessibilityIdentifier("note.notice")
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
        if r.kind == .pageMade || r.kind == .pageChanged {
            // The note's text never changed: the page goes back to what it was (the new one is kept).
            if undoPage != nil { restorePreviousPage() } else {
                NotePageStore.shared.setHere(note.id, nil)
                shownPage = nil
                mode = .text
            }
            return
        }
        if r.kind == .pageEdit { pageTint = nil }
        if r.kind == .dataEdit {
            // Back to the data before this run of changes; the note's text is untouched.
            if let undoData { NotePageDataStore.shared.set(note.id, undoData) }
            undoData = nil
            return
        }
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
                    NotePageView(noteID: note.id, html: page.html, text: text, onUpdate: applyPageEdit, onFailure: pageFailed, onData: pageData)
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

    /// The app's own data and files (amber.store, amber.files). Data changes are kept next to the
    /// page, never in the note's text, and get a receipt with Undo like any other change.
    private func pageData(_ message: Any) async throws -> [String: Any] {
        let (reply, before) = try await NotePageActions.data(message, note: note, context: context, sync: sync, html: notePage?.html ?? "",
                                                             ask: askHost, needKey: { need in withAnimation(.smooth) { keyNeeded = need } })
        guard let before else { return reply }
        if undoData == nil || receipt?.kind != .dataEdit { undoData = before }
        let r = AIEdit.Receipt(noteID: note.id, by: AIGlyph.page, at: .now, previous: note.body, lines: 0, kind: .dataEdit)
        withAnimation(.spring(duration: 0.45, bounce: 0.25)) { receipt = r }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(6 * ChangeTint.slowMotion))
            while ChangeTint.holdForCapture, receipt == r { try? await Task.sleep(for: .seconds(0.1)) }
            if receipt == r { withAnimation(.easeIn(duration: 0.2)) { receipt = nil }; undoData = nil }
        }
        return reply
    }

    private func askHost(_ host: String) async -> Bool {
        await withCheckedContinuation { c in
            // Answered once, whichever way the alert goes away.
            final class Once { var done = false }
            let once = Once()
            hostAsk = HostAsk(host: host) { ok in
                guard !once.done else { return }
                once.done = true
                c.resume(returning: ok)
            }
        }
    }

    /// "This app needs an OpenWeather API key", with Add Key and how to get one.
    @ViewBuilder
    private var keyCard: some View {
        if let need = keyNeeded, showingPage {
            VStack(alignment: .leading, spacing: 10) {
                Label("This app needs \(need.name.first.map { "AEIOU".contains($0) } == true ? "an" : "a") \(need.name) API key", systemImage: "key.fill")
                    .font(.headline)
                if let help = need.help { Text(help).font(.subheadline).foregroundStyle(.secondary) }
                Text("It's sent only to \(need.hosts.joined(separator: ", ")). The app never sees it.")
                    .font(.footnote).foregroundStyle(.secondary)
                HStack {
                    Button("Not Now") { withAnimation(.smooth) { keyNeeded = nil } }
                    Spacer()
                    Button("Add Key") { addingKey = APIKeyForm.Draft(need); keyNeeded = nil }
                        .buttonStyle(.amberProminent)
                        .accessibilityIdentifier("keycard.add")
                }
            }
            .padding(16)
            .background(.regularMaterial, in: .rect(cornerRadius: 20, style: .continuous))
            .padding(.horizontal, 16)
            #if os(macOS)
            .frame(maxWidth: 460)
            .padding(.bottom, 20)
            #else
            .padding(.bottom, 24)
            #endif
            .transition(.move(edge: .bottom).combined(with: .opacity))
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
        let r = AIEdit.Receipt(noteID: note.id, by: now.by, at: now.at, previous: note.body, lines: 0, kind: before == nil ? .pageMade : .pageChanged)
        undoPage = before
        withAnimation(.spring(duration: 0.45, bounce: 0.25)) { receipt = r }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(5.5 * ChangeTint.slowMotion))
            while ChangeTint.holdForCapture, receipt == r { try? await Task.sleep(for: .seconds(0.1)) }
            if receipt == r { withAnimation(.easeIn(duration: 0.2)) { receipt = nil } }
        }
    }

    /// Where Page / Text lives (prototype, two designs): a toolbar button beside More (the default),
    /// or a choice inside More (`-pageToggle menu`).
    enum PageToggle { case button, menu }
    static let pageToggle: PageToggle = Capture.argument("-pageToggle") == "menu" ? .menu : .button

    /// One button, like the note's other toolbar items: it shows what you'd switch to.
    private var modeButton: some View {
        Button {
            withAnimation(.smooth(duration: 0.25)) { mode = mode == .page ? .text : .page }
        } label: {
            Label(mode == .page ? "Show Text" : "Show App", systemImage: mode == .page ? "text.alignleft" : NoteAppMark.symbol)
        }
        #if os(macOS)
        .tint(.primary)
        .help(mode == .page ? "Show Text" : "Show App")
        #endif
        .accessibilityIdentifier("note.mode")
    }

    /// Page / Text as a choice in More, with the page's other actions.
    @ViewBuilder
    private var pageMenuItems: some View {
        if notePage == nil, !note.isLocked, note.trashedAt == nil {
            Button("Make It an App…", systemImage: NoteAppMark.symbol) { showMakeApp = true }
                .accessibilityIdentifier("editor.makeApp")
        }
        if let page = notePage {
            Section {
                if !NotePageSettings.declared(in: page.html).isEmpty {
                    Button("App Settings…", systemImage: "slider.horizontal.3") { showAppSettings = true }
                        .accessibilityIdentifier("editor.appSettings")
                }
                if Self.pageToggle == .menu {
                    Picker("View as", selection: $mode.animation(.smooth(duration: 0.25))) {
                        Label("App", systemImage: NoteAppMark.symbol).tag(NoteMode.page)
                        Label("Text", systemImage: "text.alignleft").tag(NoteMode.text)
                    }
                    .pickerStyle(.inline)
                    .accessibilityIdentifier("note.modeMenu")
                }
                if NotePageStore.shared.previous(note.id) != nil {
                    Button("Previous App", systemImage: "arrow.uturn.backward") { restorePreviousPage() }
                        .accessibilityIdentifier("editor.previousPage")
                }
                Button("Network Activity", systemImage: "network") { showNetLog = true }
                    .accessibilityIdentifier("editor.netLog")
                Button("Remove App", systemImage: "xmark.square") {
                    // The note's text stays as it is, and the app is kept: Previous App brings it back.
                    NotePageStore.shared.setHere(note.id, nil)
                    shownPage = nil
                    mode = .text
                }
                .accessibilityIdentifier("editor.removePage")
            }
        }
    }

    private func restorePreviousPage() {
        guard let back = NotePageStore.shared.restorePrevious(note.id) else { return }
        shownPage = back
        withAnimation(.smooth(duration: 0.25)) { mode = .page }
    }

    /// The page threw while loading or drew nothing: the one before it comes back, and the note
    /// says so. With no page before it, the note shows its text. The failed page is kept.
    private func pageFailed(_ reasons: [String]) {
        guard let page = notePage else { return }
        let who = page.by == AIGlyph.page ? "The" : "\(page.by)'s"
        failedPages.insert(page.html)
        // The new page's receipt goes: the notice says what happened instead.
        withAnimation(.smooth(duration: 0.2)) { receipt = nil }
        if let before = NotePageStore.shared.previous(note.id), !failedPages.contains(before.html) {
            restorePreviousPage()
            notice("\(who) new version of this app didn't load, so the previous app is back.")
        } else {
            withAnimation(.smooth(duration: 0.25)) { mode = .text }
            notice("This app didn't load. Showing the text.")
        }
    }

    private func notice(_ text: String) {
        withAnimation(.smooth(duration: 0.25)) { undoFailed = text }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(5 * ChangeTint.slowMotion))
            while ChangeTint.holdForCapture, undoFailed == text { try? await Task.sleep(for: .seconds(0.1)) }
            if undoFailed == text { withAnimation(.smooth(duration: 0.25)) { undoFailed = nil } }
        }
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
            // A page shows nothing of the text editor: no writing tools over it.
            .toolbar(controller.isEditing || showingPage ? .hidden : .automatic, for: .bottomBar)
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
        controller.resolveNoteModel = { id in context.note(id) }
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
        if notePage != nil, Self.pageToggle == .button {
            ToolbarItem(placement: .primaryAction) { modeButton }
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
        // A page has no text to format: the writing tools go while it shows.
        if !showingPage {
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
        }
        ToolbarSpacer(.fixed)
        ToolbarItemGroup {
            if notePage != nil, Self.pageToggle == .button { modeButton }
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
            pageMenuItems
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
