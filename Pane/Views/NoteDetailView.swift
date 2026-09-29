import QuickLook
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct NoteDetailView: View {
    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @State private var importing = false
    @State private var saver = DebouncedSave()
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
    }

    private var editor: some View {
        MarkdownEditor(initialText: note.body, header: DateBucket.header(note.updatedAt), controller: controller, autofocus: autofocus, onChange: save)
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
        let note = self.note
        saver.schedule(base: note.body) { [saver] in
            // Something else rewrote the note meanwhile (sync, an AI): the editor
            // already shows that version, so this older text must not win.
            guard note.body == saver.base else { return }
            write(text, to: note)
        }
    }

    private func write(_ text: String, to note: Note) {
        guard text != note.body else { return }
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
        controller.newSubNote = { createSubNote() }
        controller.download = { a in await sync?.download(a) ?? false }
        controller.attach = { importing = true }
        controller.addFiles = { urls in context.addAttachments(urls) }
        controller.addData = { data, name, type in
            guard let a = try? FileStore.importData(data, filename: name, type: type) else { return nil }
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
            Button("Checklist", systemImage: "checklist", action: controller.checklist)
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Table", systemImage: "tablecells", action: controller.insertTable)
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Attach", systemImage: "paperclip") { importing = true }
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
                // The pencil pokes out top-right; nudge so the symbol reads as centred.
                Label("New Note", systemImage: "square.and.pencil").offset(x: 0.5, y: 0.5)
            }
                .help("New Note (⌘N)")
                .accessibilityIdentifier("list.newNote")
        }
        ToolbarSpacer(.flexible)
        ToolbarItemGroup {
            formatMenu
            Button("Checklist", systemImage: "checklist", action: controller.checklist)
                .help("Checklist (⇧⌘L)")
            Button("Table", systemImage: "tablecells", action: controller.insertTable)
                .help("Table (⌥⌘T)")
            Button("Attach", systemImage: "paperclip") { importing = true }
                .help("Attach File (⇧⌘A)")
        }
        ToolbarSpacer(.fixed)
        ToolbarItemGroup {
            ShareLink(item: note.body, preview: SharePreview(note.title))
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
                Button("Numbered List", systemImage: "list.number", action: controller.numberedList)
                Button("Block Quote", systemImage: "text.quote", action: controller.blockQuote)
            }
            Section {
                Button("Sub-note", systemImage: "doc.badge.plus") { controller.newSubNote() }
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
            #if os(iOS)
            ShareLink(item: note.body, preview: SharePreview(note.title))
            #endif
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
        .accessibilityIdentifier("editor.more")
    }
}

extension Color {
    /// The note itself sits on a darker page than the list and sidebar, like Apple Notes.
    static var notePage: Color {
        #if os(macOS)
        Color(nsColor: .textBackgroundColor)
        #else
        Color(uiColor: .systemBackground)
        #endif
    }
}
