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
    /// Dev: an app built outside (scripts/build-app.ts), from a file, into this note.
    @State private var importingApp = false
    @State private var saver = DebouncedSave()
    @State private var shareLinks = ShareLinkStore()
    @State private var showHistory = HistoryLaunch.open
    /// "ChatGPT changed 5 lines · Undo", while an AI's edit that just landed is on show.
    @State private var receipt: AIEdit.Receipt?
    /// The version that didn't open, for Undo on "Reverted to the last working version".
    @State private var revertedFrom: NotePageStore.Page?
    /// A text field in the note's app has focus: no receipt is drawn over it.
    @State private var pageFieldFocused = false
    /// A receipt waiting for the field to let go.
    @State private var heldReceipt: AIEdit.Receipt?
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
    @State private var showAppInfo = false
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
    /// A wiki link was tapped whose note doesn't exist yet: its name, while we offer to make it.
    @State private var missingNote: String?
    /// The title when the note opened; renaming it points wiki links at the new title on leaving.
    @State private var titleAtOpen: String?
    /// Notes that link here.
    @State private var backlinks: [Note] = []
    /// The wiki index's generation when they were last looked for.
    @State private var linksGeneration = -1
    /// Note pages (prototype): Page or Text, when the note has a page.
    @State private var mode: NoteMode = NoteDetailView.startMode
    /// Which side a note with an app opens on (Mac shots photograph both).
    nonisolated(unsafe) static var startMode: NoteMode = .page
    /// The text before edits made on the page, tinted once Text shows again.
    @State private var pageTint: String?
    /// The page as last shown, to tell an AI's new page from one already seen.
    @State private var shownPage: NotePageStore.Page?
    /// Pages that failed to load here: never fallen back to twice.
    @State private var failedPages: Set<String> = []
    /// Collaboration (prototype): the people sheet.
    /// Collaboration and sharing (prototype): the one Share sheet, and Share as Template on its own (demo).
    @State private var showPeople = false
    @State private var showTemplateShare = false
    @Bindable var note: Note
    let controller: EditorController
    var autofocus = false
    let onNewNote: () -> Void
    /// Opens another note; `edit` puts the keyboard in it.
    var onOpenNote: (UUID, Bool) -> Void = { _, _ in }

    var body: some View {
        chrome(editor)
            .quickLookPreview(previewBinding)
            .fileImporter(isPresented: $importing, allowedContentTypes: FileKinds.contentTypes, allowsMultipleSelection: true, onCompletion: attach)
            #if DEBUG || QA
            .background {
                Color.clear.fileImporter(isPresented: $importingApp, allowedContentTypes: [.json, .html, .plainText]) { result in
                    guard case .success(let url) = result else { return }
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    guard let text = try? String(contentsOf: url, encoding: .utf8), NotePageProject.parse(text) != nil else { return }
                    NotePageStore.shared.setHere(note.id, .init(html: text, by: "File", at: .now))
                    pageArrived(NotePageStore.shared.live(note.id))
                }
            }
            #endif
            .onAppear(perform: wireController)
            .onDisappear {
                saver.flush()
                followRename()
            }
            .confirmationDialog(missingNote.map { "Create \u{201C}\($0)\u{201D}?" } ?? "", isPresented: Binding(get: { missingNote != nil }, set: { if !$0 { missingNote = nil } }), titleVisibility: .visible) {
                Button("Create Note") { if let name = missingNote { createLinkedNote(name) } }
                    .accessibilityIdentifier("wiki.create")
            } message: {
                Text("No note has this title yet.")
            }
            // Captures: yes to making the note a link named.
            .onReceive(NotificationCenter.default.publisher(for: Capture.wikiCreate)) { _ in
                if let name = missingNote {
                    missingNote = nil
                    createLinkedNote(name)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: ModelContext.didSave, object: context)) { saved in
                WikiDirectory.take(saved)
                refreshLinks(after: saved)
            }
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
                Text("Everything it sends there is listed in App Info › Internet.")
            }
            .sheet(item: $addingKey) { d in APIKeyForm(draft: d) }
            .sheet(isPresented: $showNetLog) { NotePageNetLogView(noteID: note.id) }
            .sheet(isPresented: $showMakeApp) { MakeAppSheet(title: note.title, body_: note.body) }
            .sheet(item: firstOpenSheet) { m in
                if FirstOpen.variant == .ac {
                    FirstOpenRichSheet(moment: m) { startFirstOpen(m) }
                } else {
                    FirstOpenSheet(moment: m) { startFirstOpen(m) }
                }
            }
            #if os(iOS)
            .fullScreenCover(item: firstOpenWelcome) { m in FirstOpenWelcome(moment: m) { startFirstOpen(m) } }
            #else
            .sheet(item: firstOpenWelcome) { m in FirstOpenWelcome(moment: m) { startFirstOpen(m) } }
            #endif
            // Later templates: just a line.
            .task(id: firstOpen?.note) {
                guard let m = firstOpen, !m.full else { return }
                try? await Task.sleep(for: .seconds(0.6))
                notice("Added to your notes")
                FirstOpen.shared.start(m)
            }
            .sheet(isPresented: $showAppInfo) {
                if let p = notePage {
                    AppInfoSheet(noteID: note.id, html: p.html,
                                     hasPrevious: NotePageStore.shared.previous(note.id) != nil,
                                     previous: { restorePreviousPage() },
                                     remove: {
                                         // The note's text stays as it is, and the app is kept: Previous App brings it back.
                                         NotePageStore.shared.setHere(note.id, nil)
                                         shownPage = nil
                                         mode = .text
                                     })
                }
            }
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
            .onChange(of: NotePageStore.shared[note.id]) { _, _ in pageArrived(NotePageStore.shared.live(note.id)) }
            // An AI's new version failed its checks on the server and waits there as a draft: the
            // working one keeps running; say so once.
            .onChange(of: NotePageStore.shared.drafts[note.id]) { _, draft in
                guard let draft, showingPage else { return }
                showPageReceipt(AIEdit.Receipt(noteID: note.id, by: draft.by, at: .now, previous: note.body, lines: 0, kind: .heldBack))
            }
            .onChange(of: mode) { _, now in if now == .text { tintPageEdits() } }
            // An AI (or MCP tool) changed the app's data while it's open: the app already shows it;
            // say who, and offer Undo back to before.
            .onChange(of: NotePageDataStore.shared.arrivals[note.id]) { _, a in
                guard let a, showingPage else { return }
                undoData = NotePageData.decode(a.before)
                showPageReceipt(AIEdit.Receipt(noteID: note.id, by: a.by, at: a.at, previous: note.body, lines: 0, kind: .dataEdit))
            }
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
                titleAtOpen = note.body.isEmpty || note.isLocked ? nil : note.title
                refreshLinks()
                receipt = nil
                shownPage = NotePageStore.shared[note.id]
                // A note with an app is the app: what its text held goes into the app's data once.
                if shownPage != nil { NotePageActions.importIfNeeded(note) }
                if shownPage != nil { NotePageTiming.open(note.id) }
                showChip = false
                pageTint = nil
                mode = Self.startMode
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
            .modifier(CollabWiring(note: note, controller: controller, showPeople: $showPeople))
            .sheet(isPresented: $showPeople) { if let store = CollabStore.shared { ShareSheet(note: note, store: store) } }
            .sheet(isPresented: $showTemplateShare) { if let store = CollabStore.shared { TemplateShareSheet(note: note, store: store) } }
            .onReceive(NotificationCenter.default.publisher(for: CollabDemo.closeShare)) { _ in showPeople = false }
            .onReceive(NotificationCenter.default.publisher(for: CollabDemo.showShare)) { n in
                guard n.object as? String == "template" else { showPeople = true; return }
                showPeople = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { showTemplateShare = true }
            }
            // "See your note's history" from an email opened this note to show its history.
            .onChange(of: AppPlaceCenter.shared.historyFor, initial: true) { _, id in
                guard id == note.id else { return }
                AppPlaceCenter.shared.historyFor = nil
                if !note.isLocked { showHistory = true }
            }
    }

    /// Collaboration (prototype): the open shared note's session, when there is one.
    private var collab: CollabSession? { CollabStore.shared?.session(for: note.id) }

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
                // Solid, never see-through.
                .background(Color(PColor.panePanel), in: .rect(cornerRadius: AIReceipt.height / 2))
                .overlay(RoundedRectangle(cornerRadius: AIReceipt.height / 2).strokeBorder(Color.line, lineWidth: 1))
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
            #if os(iOS)
            // Over a note's app it sits in the navigation bar instead (see toolbar): an app's own
            // tab bar, sheets and the keyboard live at the bottom, its title at the top.
            let inBar = showingPage
            #else
            let inBar = false
            #endif
            if !inBar {
                AIReceipt(receipt: receipt) { undo(receipt) }
                #if os(macOS)
                .padding(.bottom, 20)
                #else
                .padding(.bottom, 64)
                #endif
                .transition(AIReceipt.transition(reduceMotion: reduceMotion))
            }
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
        if r.kind == .reverted {
            if let page = revertedFrom { NotePageStore.shared.force(note.id, page); shownPage = page }
            revertedFrom = nil
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
                // A shared note's editor takes merged text from its session (CollabWiring), not from
                // the note's mirrored body, which can lag a keystroke behind and undo it.
                MarkdownEditor(initialText: text, header: DateBucket.header(note.updatedAt), controller: controller, autofocus: autofocus,
                               followsInitialText: collab == nil, onChange: save)
                    .onAppear { if note.isLocked { vault.touch() } }
                    .opacity(showingPage ? 0 : 1)
                    .allowsHitTesting(!showingPage)
                    .accessibilityHidden(showingPage)
                if let page = notePage {
                    NotePageView(noteID: note.id, html: page.html, text: text, onUpdate: applyPageEdit, onFailure: pageFailed, onData: pageData,
                                 files: { [context] id in NotePageActions.file(id, note: note, context: context) },
                                 onFocus: { focused in
                                     pageFieldFocused = focused
                                     // Typing in the app: a receipt steps out of the way (Undo stays in Edit and ⌘Z).
                                     if focused, receipt != nil { withAnimation(.easeIn(duration: 0.15)) { receipt = nil } }
                                     if !focused, let held = heldReceipt {
                                         heldReceipt = nil
                                         if held.at.timeIntervalSinceNow > -3 { showPageReceipt(held) }
                                     }
                                 },
                                 insetBottom: pageInsetBottom)
                        .id(note.id)
                        .opacity(showingPage ? 1 : 0)
                        .allowsHitTesting(showingPage)
                        .accessibilityHidden(!showingPage)
                        // B: the first-open card inside the app, at its top, until Start.
                        .safeAreaInset(edge: .top, spacing: 0) {
                            if showingPage, let m = firstOpen, m.full, m.isApp, FirstOpen.variant == .b {
                                FirstOpenCard(moment: m) { startFirstOpen(m) }
                                    .transition(.move(edge: .top).combined(with: .opacity))
                            }
                        }
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
    /// The version that runs: the newest that passed its checks and opens here (NotePageStore.live).
    private var notePage: NotePageStore.Page? { note.isLocked ? nil : NotePageStore.shared.live(note.id) }
    private var showingPage: Bool { notePage != nil && mode == .page }

    /// A template just added from the website, opening for the first time.
    private var firstOpen: FirstOpen.Moment? { FirstOpen.shared.pending[note.id] }

    private func startFirstOpen(_ m: FirstOpen.Moment) {
        withAnimation(.smooth(duration: 0.3)) { FirstOpen.shared.start(m) }
    }

    /// A: a sheet over the app (and, for a note template, its lighter version, whatever the design).
    private var firstOpenSheet: Binding<FirstOpen.Moment?> {
        Binding(get: {
            guard let m = firstOpen, m.full else { return nil }
            return !m.isApp || FirstOpen.variant == .a || FirstOpen.variant == .ac ? m : nil
        }, set: { if $0 == nil, let m = firstOpen { FirstOpen.shared.start(m) } })
    }

    /// C: a short welcome before the app.
    private var firstOpenWelcome: Binding<FirstOpen.Moment?> {
        Binding(get: {
            guard let m = firstOpen, m.full, m.isApp, FirstOpen.variant == .c else { return nil }
            return m
        }, set: { if $0 == nil, let m = firstOpen { FirstOpen.shared.start(m) } })
    }

    /// What of the app's bottom edge Amber covers: on the Mac the receipt (its height, its margin and
    /// a gap); on iPhone nothing (the receipt goes in the navigation bar, and the App side has no
    /// bottom toolbar).
    private var pageInsetBottom: CGFloat {
        #if os(macOS)
        receipt != nil && showingPage ? AIReceipt.height + 20 + 8 : 0
        #else
        0
        #endif
    }

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
        showPageReceipt(r)
    }

    /// Never over a field you're typing in, or under a sheet. A change made while a field has
    /// focus (a button pressed as the field lets go) shows once the focus has gone, if that's soon.
    private func showPageReceipt(_ r: AIEdit.Receipt) {
        guard !showAppInfo else { return }
        guard !pageFieldFocused else { heldReceipt = r; return }
        heldReceipt = nil
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
    /// The app's own data, files, the device and the network. Data changes are the app's own
    /// state (a ticked set, a rating): kept quietly, versioned on the server, without a receipt;
    /// receipts are for changes to the note's text.
    private func pageData(_ message: Any) async throws -> [String: Any] {
        let (reply, before) = try await NotePageActions.data(message, note: note, context: context, sync: sync, html: notePage?.html ?? "",
                                                             ask: askHost, needKey: { need in withAnimation(.smooth) { keyNeeded = need } })
        // A change you made gets a receipt; the app saving on its own is quiet (Undo still reaches it
        // through version history).
        if let before, (message as? [String: Any])?["_user"] as? Bool == true { dataChanged(before: before) }
        return reply
    }

    /// The app's data is the app's content now: a change gets "Changed · Undo" like any edit. A run
    /// of changes (typing, a game, a batch) is one receipt, and Undo goes back to before the run.
    private func dataChanged(before: NotePageData.Doc) {
        if let r = receipt ?? heldReceipt, r.kind == .dataEdit, r.at.timeIntervalSinceNow > -10, undoData != nil {
            // Same run: the Undo point stays where the run began.
        } else {
            undoData = before
        }
        let r = AIEdit.Receipt(noteID: note.id, by: AIGlyph.page, at: .now, previous: note.body, lines: 0, kind: .dataEdit)
        showPageReceipt(r)
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
        if now != nil { NotePageActions.importIfNeeded(note) }
        guard let now, now != before, now.by != AIGlyph.page, now.by != FirstOpen.templateWriter else { return }
        withAnimation(.smooth(duration: 0.3)) { mode = .page }
        let r = AIEdit.Receipt(noteID: note.id, by: now.by, at: now.at, previous: note.body, lines: 0, kind: before == nil ? .pageMade : .pageChanged)
        undoPage = before
        guard !pageFieldFocused else { return }
        withAnimation(.spring(duration: 0.45, bounce: 0.25)) { receipt = r }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(5.5 * ChangeTint.slowMotion))
            while ChangeTint.holdForCapture, receipt == r { try? await Task.sleep(for: .seconds(0.1)) }
            if receipt == r { withAnimation(.easeIn(duration: 0.2)) { receipt = nil } }
        }
    }

    /// The app's items in More: Make It an App, or App Info.
    @ViewBuilder
    private var pageMenuItems: some View {
        if notePage == nil, !note.isLocked, note.trashedAt == nil {
            Button("Make It an App…", systemImage: NoteAppMark.symbol) { showMakeApp = true }
                .accessibilityIdentifier("editor.makeApp")
        }
        if notePage != nil {
            // Everything about the app in one place: its settings, the internet, Previous App, Remove App.
            Button("App Info…", systemImage: "info.circle") { showAppInfo = true }
                .accessibilityIdentifier("editor.appInfo")
        }
        #if DEBUG || QA
        if !note.isLocked, note.trashedAt == nil {
            // An app built outside the AI tools (scripts/build-app.ts output, or one HTML file).
            Button("Dev: Import App File…", systemImage: "square.and.arrow.down") { importingApp = true }
                .accessibilityIdentifier("editor.devImportApp")
        }
        #endif
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
        failedPages.insert(page.html)
        let store = NotePageStore.shared
        store.markBroken(note.id, page)
        // The new page's receipt goes: the revert says what happened instead.
        withAnimation(.smooth(duration: 0.2)) { receipt = nil }
        sync?.reportLoadFailure(note: note.id, message: reasons.first ?? "It didn't open.")
        if let good = store.live(note.id), good != page {
            // The last working version runs, with the app's data as it is now. Undo runs the broken
            // one again, if you want to see it.
            shownPage = good
            revertedFrom = page
            showPageReceipt(AIEdit.Receipt(noteID: note.id, by: page.by, at: .now, previous: note.body, lines: 0, kind: .reverted))
        } else {
            withAnimation(.smooth(duration: 0.25)) { mode = .text }
            notice("This app didn't open, and there's no earlier version that works.")
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
        // A shared note's text lives in its document; the note follows it (CollabStore).
        if let collab {
            collab.local(text, selection: controller.target?.currentSelection)
            return
        }
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
            .buttonStyle(.hoverLink)
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

    // MARK: Wiki links

    /// Colours for the editor's wiki links and the "Linked from" list, from the library as it is now.
    private func refreshLinks() {
        controller.wiki = WikiDirectory.scope(for: note, in: context)
        backlinks = note.isLocked ? [] : context.backlinks(to: note)
        linksGeneration = WikiDirectory.generation
    }

    /// After a save, "Linked from" is looked for again only if the save could have changed it: a
    /// title or folder changed, a note was deleted for good, or a note it changed links here or did.
    /// Most saves are this note being typed in.
    private func refreshLinks(after saved: Notification) {
        let link = "pane-note:\(note.id.uuidString.lowercased())"
        let mayLink: (Note) -> Bool = { other in
            other.id != note.id && (backlinks.contains { $0.id == other.id } || other.body.contains("[[") || other.body.contains(link))
        }
        guard WikiDirectory.generation == linksGeneration, let changes = context.savedNotes(saved), !changes.notes.contains(where: mayLink) else {
            refreshLinks()
            return
        }
        controller.wiki = WikiDirectory.scope(for: note, in: context)
    }

    /// A wiki link was tapped: open its note, or offer to make it, as Obsidian does.
    private func followWikiLink(_ target: String) {
        // What was just typed here counts in the next note's "Linked from".
        saver.flush()
        if let linked = context.resolveWikiLink(target, from: note) {
            onOpenNote(linked.id, false)
        } else {
            missingNote = WikiLinks.name(of: target)
        }
    }

    /// The note a link named, made in this note's folder and opened for writing.
    private func createLinkedNote(_ title: String) {
        let made = context.createNote(in: note.folder.map { .folder($0.id) } ?? .all, body: title + "\n")
        WikiDirectory.invalidate()
        onOpenNote(made.id, true)
    }

    /// Leaving a note whose title changed: links to its old title now name the new one.
    private func followRename() {
        guard let old = titleAtOpen, !note.isLocked, note.deletedAt == nil, note.title != old else { return }
        titleAtOpen = note.title
        context.retargetWikiLinks(to: note, renamedFrom: old)
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
        controller.openWiki = { target in followWikiLink(target) }
        controller.suggestTitles = { [id = note.id] typed in WikiDirectory.suggestions(typed, excluding: id, in: context) }
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
        if showingPage, let receipt {
            ToolbarItem(placement: .principal) {
                AIReceipt(receipt: receipt, compact: true) { undo(receipt) }
                    .transition(.opacity)
            }
            .sharedBackgroundVisibility(.hidden)
        }

        if let collab {
            ToolbarItem(placement: .primaryAction) { PresenceStack(session: collab) { showPeople = true } }
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
        // A note with an app is just the app: no writing tools.
        if notePage == nil {
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
                .disabled(note.isLocked || showingPage)
        }
        }
        ToolbarSpacer(.fixed)
        if let collab {
            ToolbarItem { PresenceStack(session: collab) { showPeople = true } }
        }
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
        if let store = CollabStore.shared, store.isReady {
            Section {
                // One Share: a link anyone can View or Edit with, the people in the note, and Share as Template.
                Button("Share…", systemImage: "person.crop.circle.badge.plus") { showPeople = true }
                    .accessibilityIdentifier("collab.share")
            }
        }
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
            if !backlinks.isEmpty {
                Menu("Linked from", systemImage: "link") {
                    ForEach(backlinks, id: \.id) { n in
                        Button(n.title) { onOpenNote(n.id, false) }
                    }
                }
                .accessibilityIdentifier("editor.backlinks")
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

/// Collaboration (prototype): hooks an open shared note to its session. The editor takes merged
/// text from others, their carets are drawn, and your caret goes out as presence.
private struct CollabWiring: ViewModifier {
    let note: Note
    let controller: EditorController
    @Binding var showPeople: Bool

    private var session: CollabSession? { CollabStore.shared?.session(for: note.id) }

    func body(content: Content) -> some View {
        content
            .task(id: session.map { ObjectIdentifier($0) }) {
                guard let session else { controller.remoteCarets = []; return }
                session.onRemoteText = { [weak controller] text in controller?.target?.syncExternal(text) }
                // Carets go straight to the text view, not through SwiftUI's next update, so they move
                // in the same frame as the text.
                session.onCarets = { [weak controller] carets in controller?.target?.showRemoteCarets(carets) }
                // Your caret, a few times a second (it also goes with every keystroke).
                while !Task.isCancelled {
                    session.selectionChanged(controller.isEditing ? controller.target?.currentSelection : nil)
                    controller.remoteCarets = session.remoteCarets
                    CollabStore.shared?.loadPhotos(session)
                    try? await Task.sleep(for: .seconds(0.1))
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: CollabDemo.invite)) { _ in showPeople = true }
    }
}
