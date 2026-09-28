import QuickLook
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct NoteDetailView: View {
    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @State private var importing = false
    @Bindable var note: Note
    let controller: EditorController
    var autofocus = false
    let onNewNote: () -> Void

    var body: some View {
        chrome(editor)
            .quickLookPreview(previewBinding)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true, onCompletion: attach)
            .onAppear(perform: wireController)
            .sheet(item: rowBinding, content: rowSheet)
    }

    private var editor: some View {
        MarkdownEditor(initialText: note.body, header: DateBucket.header(note.updatedAt), controller: controller, autofocus: autofocus, onChange: save)
    }

    private func chrome(_ content: some View) -> some View {
        content
            .ignoresSafeArea(.container, edges: .bottom)
            .background(Color.notePage.ignoresSafeArea())
            .safeAreaInset(edge: .top, spacing: 0) {
                if note.trashedAt != nil { trashBanner }
            }
            .navigationTitle("")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(controller.isEditing ? .hidden : .automatic, for: .bottomBar)
            .animation(.snappy(duration: 0.2), value: controller.isEditing)
            #endif
            .toolbar { toolbar }
    }

    private func save(_ text: String) {
        guard text != note.body else { return }
        note.body = text
        note.touch()
    }

    private func attach(_ result: Result<[URL], Error>) {
        if case .success(let urls) = result { controller.insertFiles(context.addAttachments(urls)) }
    }

    private var rowBinding: Binding<TableRowRequest?> {
        Binding(get: { controller.tableRequest }, set: { controller.tableRequest = $0 })
    }

    private func rowSheet(_ r: TableRowRequest) -> some View {
        TableRowSheet(columns: r.columns, values: r.values, isNew: r.rowIndex == nil,
                      onSave: { controller.saveRow(r, values: $0) },
                      onDelete: { controller.saveRow(r, values: nil) })
    }

    private var previewBinding: Binding<URL?> {
        Binding(get: { controller.previewURL }, set: { controller.previewURL = $0 })
    }

    /// Gives the editor what it needs from this screen: files, downloads, the picker.
    private func wireController() {
        let context = self.context
        let sync = self.sync
        controller.resolveAttachment = { id in context.attachment(id) }
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
        ToolbarItemGroup {
            formatMenu
            Button("Checklist", systemImage: "checklist", action: controller.checklist)
                .help("Checklist (⇧⌘L)")
            Button("Table", systemImage: "tablecells", action: controller.insertTable)
                .help("Table (⌥⌘T)")
            Button("Card", systemImage: "rectangle.stack", action: controller.newCard)
                .help("Collapsible card (⇧⌘C)")
            Button("Attach", systemImage: "paperclip") { importing = true }
                .help("Attach a file (⇧⌘A)")
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
                Button("Strikethrough", systemImage: "strikethrough", action: controller.strikethrough)
                Button("Code", systemImage: "chevron.left.forwardslash.chevron.right", action: controller.code)
            }
            Section {
                Button("Bulleted List", systemImage: "list.bullet", action: controller.bulletList)
                Button("Link", systemImage: "link", action: controller.insertLink)
            }
        } label: {
            Label("Format", systemImage: "textformat")
        }
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
