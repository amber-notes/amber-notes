import QuickLook
import QuickLookThumbnailing
import SwiftData
import SwiftUI
#if os(macOS)
import Quartz
#endif

extension Attachment {
    /// The icon's colour, as on a file in a note.
    var tint: Color {
        if type.conforms(to: .pdf) { return .red }
        if symbol == "tablecells" { return .green }
        if type.conforms(to: .presentation) { return .orange }
        return .blue
    }

    /// "PDF · 2.1 MB": the ending says the kind more briefly than its full description.
    var listDetail: String {
        let ext = (filename as NSString).pathExtension.uppercased()
        return ext.isEmpty ? sizeText : "\(ext) · \(sizeText)"
    }
}

/// A row of the note list: a note, or a file kept in the folder.
enum ListItem: Identifiable, DatedListItem {
    case note(Note)
    case file(Attachment)

    var id: UUID {
        switch self {
        case .note(let n): n.id
        case .file(let f): f.id
        }
    }

    var listDate: Date {
        switch self {
        case .note(let n): n.listDate
        case .file(let f): f.listDate
        }
    }

    var pinnedInList: Bool {
        if case .note(let n) = self { return n.pinnedInList }
        return false
    }
}

/// A file in the list, with its drag and swipe actions, beside the notes.
struct FileListRow: View {
    let file: Attachment
    var query = ""
    var showFolder = false
    let remove: () -> Void

    var body: some View {
        FileRow(file: file, showFolder: showFolder)
            .draggable(PaneDragItem(kind: .file, id: file.id)) {
                Label(file.filename, systemImage: file.symbol)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .glassEffect(.regular, in: .capsule)
            }
            .swipeActions(edge: .trailing) {
                Button(file.trashedAt == nil ? "Delete" : "Delete Forever…", systemImage: "trash", role: .destructive, action: remove)
            }
    }
}

/// A file laid out like a note row: its name where a note's title is, the date and kind under
/// it, and a thumbnail on the trailing side, where Notes shows a note's picture.
struct FileRow: View {
    let file: Attachment
    var showFolder = false
    @Environment(\.modelContext) private var context
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let large = typeSize.isAccessibilitySize
        let detail = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(spacing: 8))
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: RowMetrics.spacing) {
                Text(file.filename)
                    .font(RowMetrics.title)
                    .foregroundStyle(Color.ink)
                    .lineLimit(large ? 3 : 1)
                    .truncationMode(.middle)
                detail {
                    Text(DateBucket.rowDate(file.listDate))
                        .monospacedDigit()
                        .foregroundStyle(Color.ink.opacity(0.85))
                    Text(file.listDetail)
                        .monospacedDigit()
                        .foregroundStyle(Color.muted)
                        .lineLimit(1)
                }
                .font(RowMetrics.detail)
                if showFolder, let id = file.folderID, let f = context.folder(id) {
                    HStack(spacing: 5) {
                        Image(systemName: "folder")
                        Text(f.name)
                    }
                    .font(RowMetrics.detail)
                    .foregroundStyle(Color.muted)
                }
            }
            Spacer(minLength: 0)
            FileThumbnail(file: file, side: RowMetrics.thumbnail)
        }
        .padding(.vertical, RowMetrics.vertical)
        .padding(.leading, RowMetrics.leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(file.filename)
        .accessibilityValue("File, \(file.kindText), \(file.sizeText)")
        .accessibilityIdentifier("file.\(file.filename)")
    }
}

/// The file's first page or picture when it's on this device, else its kind's icon.
struct FileThumbnail: View {
    let file: Attachment
    let side: CGFloat
    @Environment(\.displayScale) private var scale
    @State private var image: CGImage?

    var body: some View {
        ZStack {
            if let image {
                Image(decorative: image, scale: scale)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: side * 0.22, style: .continuous)
                    .fill(file.tint.opacity(0.16))
                Image(systemName: file.symbol)
                    .font(.system(size: side * 0.42, weight: .medium))
                    .foregroundStyle(file.tint)
            }
        }
        .frame(width: side, height: side)
        .clipShape(.rect(cornerRadius: side * 0.22, style: .continuous))
        .overlay {
            if image != nil {
                RoundedRectangle(cornerRadius: side * 0.22, style: .continuous)
                    .strokeBorder(Color.ink.opacity(0.12), lineWidth: 0.5)
            }
        }
        .accessibilityHidden(true)
        .task(id: "\(file.id)\(file.filename)\(FileStore.exists(file))") { await load() }
    }

    private func load() async {
        guard FileStore.exists(file) else { image = nil; return }
        let request = QLThumbnailGenerator.Request(fileAt: FileStore.url(for: file.id, filename: file.filename),
                                                   size: CGSize(width: side, height: side), scale: scale, representationTypes: .thumbnail)
        image = try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).cgImage
    }
}

/// A file opened from the list: the system's preview of it (Quick Look), filling the detail column.
struct FileDetailView: View {
    @Bindable var file: Attachment
    @Environment(\.modelContext) private var context
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @State private var state: Load = .checking
    @State private var renaming = false
    @State private var nameDraft = ""
    @State private var confirmForever = false
    let onNewNote: () -> Void

    enum Load: Equatable { case checking, downloading, ready(URL), failed }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.notePage.ignoresSafeArea())
            .navigationTitle(file.filename)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .safeAreaInset(edge: .bottom, spacing: 0) { if file.trashedAt != nil { trashBanner } }
            .toolbar { toolbar }
            .task(id: "\(file.id)\(file.filename)") { await load() }
            .alert("Rename File", isPresented: $renaming) {
                TextField("Name", text: $nameDraft)
                    .accessibilityIdentifier("file.renameField")
                Button("Cancel", role: .cancel) {}
                Button("Rename") { context.rename(file, to: nameDraft) }
            } message: {
                Text("The ending (.\((file.filename as NSString).pathExtension)) stays.")
            }
            .confirmationDialog("Delete \u{201C}\(file.filename)\u{201D} forever?", isPresented: $confirmForever, titleVisibility: .visible) {
                Button("Delete Forever", role: .destructive) { withAnimation(.snappy) { context.purge(file) } }
            } message: {
                Text("You can't undo this.")
            }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .ready(let url):
            FilePreview(url: url)
                .id(url)
                .accessibilityIdentifier("file.preview")
        case .checking:
            Color.clear
        case .downloading:
            VStack(spacing: 10) {
                ProgressView()
                Text("Downloading \u{201C}\(file.filename)\u{201D}")
                    .font(.callout)
                    .foregroundStyle(Color.muted)
            }
        case .failed:
            ContentUnavailableView {
                Label("Can't open this file yet", systemImage: file.symbol)
            } description: {
                Text("It's on its way from the device that added it. Check your connection and try again.")
            } actions: {
                Button("Try Again") { Task { await load() } }
                    .buttonStyle(.glass)
            }
        }
    }

    private func load() async {
        if FileStore.exists(file) { state = .ready(FileStore.url(for: file.id, filename: file.filename)); return }
        state = .downloading
        if await sync?.download(file) == true, FileStore.exists(file) {
            state = .ready(FileStore.url(for: file.id, filename: file.filename))
        } else {
            state = .failed
        }
    }

    private var trashBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "trash").foregroundStyle(.secondary)
            Text("This file is in Recently Deleted.")
                .font(.callout)
            Spacer()
            Button("Recover") { withAnimation(.snappy) { context.restore(file) } }
                .buttonStyle(.glassProminent)
                .accessibilityIdentifier("file.recover")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: 18))
        .padding(12)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if case .ready(let url) = state {
            ToolbarItem {
                ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                    .accessibilityIdentifier("file.share")
            }
        }
        ToolbarItem {
            Menu {
                if file.trashedAt == nil {
                    Button("Rename…", systemImage: "pencil") { nameDraft = FolderFileName.stem(file.filename); renaming = true }
                    Menu("Move to", systemImage: "folder") {
                        ForEach(context.allFolders().sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { f in
                            Button(f.name) { withAnimation(.snappy) { context.move(file, to: f) } }
                                .disabled(file.folderID == f.id)
                        }
                    }
                    Divider()
                    Button("Delete", systemImage: "trash", role: .destructive) { withAnimation(.snappy) { context.trash(file) } }
                } else {
                    Button("Recover", systemImage: "arrow.uturn.backward") { withAnimation(.snappy) { context.restore(file) } }
                    Button("Delete Forever…", systemImage: "trash", role: .destructive) { confirmForever = true }
                }
            } label: {
                Label("More", systemImage: "ellipsis")
            }
            .menuIndicator(.hidden)
            .accessibilityIdentifier("file.more")
        }
        #if os(macOS)
        ToolbarSpacer(.flexible)
        ToolbarItem {
            Button(action: onNewNote) {
                Label { Text("New Note") } icon: { ToolbarGlyph.image("square.and.pencil", shift: ToolbarGlyph.composeShift) }
            }
        }
        #endif
    }
}

#if os(macOS)
/// Quick Look's own preview, in the window: PDFs scroll and zoom, images, spreadsheets, documents.
struct FilePreview: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> QLPreviewView {
        let view = QLPreviewView(frame: .zero, style: .normal)!
        view.autostarts = true
        view.shouldCloseWithWindow = false
        view.previewItem = url as NSURL
        return view
    }

    func updateNSView(_ view: QLPreviewView, context: Context) {
        if (view.previewItem as? NSURL) as URL? != url { view.previewItem = url as NSURL }
    }

    static func dismantleNSView(_ view: QLPreviewView, coordinator: ()) { view.close() }
}
#else
/// Quick Look's own preview, in the page: PDFs scroll and zoom, images, spreadsheets, documents.
struct FilePreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Source { Source(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        guard context.coordinator.url != url else { return }
        context.coordinator.url = url
        controller.reloadData()
    }

    final class Source: NSObject, QLPreviewControllerDataSource {
        var url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
#endif
