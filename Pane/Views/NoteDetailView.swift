import SwiftData
import SwiftUI

struct NoteDetailView: View {
    @Environment(\.modelContext) private var context
    @Bindable var note: Note
    let controller: EditorController
    var autofocus = false
    let onNewNote: () -> Void

    var body: some View {
        MarkdownEditor(initialText: note.body, header: DateBucket.header(note.updatedAt), controller: controller, autofocus: autofocus) { text in
            guard text != note.body else { return }
            note.body = text
            note.touch()
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .safeAreaInset(edge: .top, spacing: 0) {
            if note.trashedAt != nil { trashBanner }
        }
        .navigationTitle("")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { toolbar }
        .sheet(item: Binding(get: { controller.cardRequest }, set: { controller.cardRequest = $0 })) { req in
            CardEditorSheet(title: req.title, content: req.content, isNew: req.index == nil) { title, content in
                controller.saveCard(req, title: title, content: content)
            }
        }
        #if os(iOS)
        .toolbar(controller.isEditing ? .hidden : .automatic, for: .bottomBar)
        .animation(.snappy(duration: 0.2), value: controller.isEditing)
        #endif
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
