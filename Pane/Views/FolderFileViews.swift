import QuickLook
import QuickLookThumbnailing
import SwiftData
import SwiftUI
import UniformTypeIdentifiers
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

/// What a drop carries: items from inside the app, and file or folder URLs from outside it.
enum DropLoader {
    @MainActor
    static func load(_ providers: [NSItemProvider], then handle: @escaping @MainActor ([PaneDragItem], [URL]) -> Void) {
        let group = DispatchGroup()
        final class Box: @unchecked Sendable { var items: [PaneDragItem] = []; var urls: [URL] = []; let lock = NSLock() }
        let box = Box()
        for p in providers {
            if p.hasItemConformingToTypeIdentifier(UTType.paneItem.identifier) {
                group.enter()
                _ = p.loadDataRepresentation(forTypeIdentifier: UTType.paneItem.identifier) { data, _ in
                    if let data, let item = try? JSONDecoder().decode(PaneDragItem.self, from: data) { box.lock.withLock { box.items.append(item) } }
                    group.leave()
                }
            } else if p.canLoadObject(ofClass: URL.self) {
                group.enter()
                _ = p.loadObject(ofClass: URL.self) { url, _ in
                    if let url, url.isFileURL { box.lock.withLock { box.urls.append(url) } }
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) { MainActor.assumeIsolated { handle(box.items, box.urls) } }
    }
}

/// A file in the list, with its drag and swipe actions, beside the notes.
struct FileListRow: View {
    let file: Attachment
    var query = ""
    var showFolder = false
    let remove: () -> Void
    @Environment(SyncEngine.self) private var sync: SyncEngine?

    var body: some View {
        FileRow(file: file, showFolder: showFolder)
            // Out to Finder, Mail or the Desktop (the file itself), or onto a sidebar folder.
            #if os(macOS)
            // The List's own drag hook: the table starts the drag past the drag threshold and keeps
            // its click-to-select. `.onDrag` put a mouse-down gesture on the row that took the click,
            // so a click on a file often selected nothing (dev 2610071608).
            .itemProvider { FileOut.provider(for: file) { [sync] a in await sync?.download(a) ?? false } }
            #else
            .onDrag {
                FileOut.provider(for: file) { [sync] a in await sync?.download(a) ?? false }
            } preview: {
                Label(file.filename, systemImage: file.symbol)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .glassEffect(.regular, in: .capsule)
            }
            #endif
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
                    // On the server, not here yet: it needs the network to open.
                    if file.uploaded, !FileStore.exists(file) {
                        Image(systemName: "arrow.down.circle")
                            .foregroundStyle(Color.muted)
                            .accessibilityHidden(true)
                    }
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
        .accessibilityValue("File, \(file.kindText), \(file.sizeText)\(file.uploaded && !FileStore.exists(file) ? ", not downloaded" : "")")
        .accessibilityIdentifier("file.\(file.filename)")
    }
}

@MainActor
enum FileCopy {
    static func notDownloaded(_ name: String) -> String {
        "\u{201C}\(name)\u{201D} isn\u{2019}t on this \(Backend.device) yet. It downloads when you\u{2019}re back online. To have a folder\u{2019}s files with you offline, choose Keep Files Downloaded on the folder."
    }
}

/// The first page of a PDF, a picture or a video frame when it's on this device, else the kind's icon.
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
        // A page or picture says more than an icon; a spreadsheet's or text's thumbnail is mostly blank.
        let t = file.type
        guard FileStore.exists(file), t.conforms(to: .pdf) || t.conforms(to: .image) || t.conforms(to: .movie) else { image = nil; return }
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
    @State private var exporting = false
    let onNewNote: () -> Void

    enum Load: Equatable { case checking, downloading, ready(URL), failed, notDownloaded }

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
            // Back online, a file that wasn't here is fetched by itself.
            .task(id: "\(file.id)\(file.filename)\(sync?.reach == .online)") { await load() }
            .alert("Rename File", isPresented: $renaming) {
                TextField("Name", text: $nameDraft)
                    .accessibilityIdentifier("file.renameField")
                Button("Cancel", role: .cancel) {}
                Button("Rename") { context.rename(file, to: nameDraft) }
            } message: {
                Text("The ending (.\((file.filename as NSString).pathExtension)) stays.")
            }
            .fileExport(file, isPresented: $exporting)
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
            if file.type.conforms(to: .pdf) {
                // PDFs read like Preview: zoom, pages, contents, Find.
                PDFReader(url: url)
                    .id(url)
            } else if CSVTable.handles(file.filename) {
                // Quick Look shows CSV as plain text on iPhone: a table reads it as what it is.
                CSVTableView(url: url, separator: CSVTable.separator(file.filename))
                    .id(url)
                    .accessibilityIdentifier("file.table")
            } else {
                FilePreview(url: url)
                    .id(url)
                    .accessibilityIdentifier("file.preview")
            }
        case .checking:
            Color.clear
        case .downloading:
            VStack(spacing: 10) {
                ProgressView()
                Text("Downloading \u{201C}\(file.filename)\u{201D}")
                    .font(.callout)
                    .foregroundStyle(Color.muted)
            }
        case .notDownloaded:
            ContentUnavailableView {
                Label("Not downloaded yet", systemImage: "arrow.down.circle")
            } description: {
                Text(FileCopy.notDownloaded(file.filename))
            }
            .accessibilityIdentifier("file.notDownloaded")
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
        // Offline there's nothing to wait for: said at once, and fetched when the network is back.
        if let sync, sync.reach == .offline { state = .notDownloaded; return }
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
        #if os(macOS)
        // Where a note's toolbar has it: compose first.
        ToolbarItem {
            Button(action: onNewNote) {
                Label { Text("New Note") } icon: { ToolbarGlyph.image("square.and.pencil", shift: ToolbarGlyph.composeShift) }
            }
        }
        ToolbarSpacer(.flexible)
        #endif
        if case .ready(let url) = state {
            #if os(macOS)
            // The file itself, to drag out to Finder or Mail, like a document's icon in Preview's title bar.
            ToolbarItem {
                Image(systemName: file.symbol)
                    .foregroundStyle(file.tint)
                    .padding(.horizontal, 6)
                    .contentShape(.rect)
                    .onDrag { FileOut.provider(for: file) { [sync] a in await sync?.download(a) ?? false } }
                    .help("Drag to Finder or Mail")
                    .accessibilityLabel("\(file.filename), drag to copy it out")
                    .accessibilityIdentifier("file.dragOut")
            }
            #endif
            ToolbarItem {
                ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                    .accessibilityIdentifier("file.share")
            }
        }
        ToolbarItem {
            Menu {
                if file.trashedAt == nil {
                    Button(FileOut.exportTitle, systemImage: FileOut.exportSymbol) { exporting = true }
                        .disabled(!FileStore.exists(file))
                        .accessibilityIdentifier("file.export")
                    Divider()
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
    }
}

/// Comma- and tab-separated text, as rows and columns.
enum CSVTable {
    static func handles(_ name: String) -> Bool { ["csv", "tsv"].contains((name as NSString).pathExtension.lowercased()) }
    static func separator(_ name: String) -> Character { (name as NSString).pathExtension.lowercased() == "tsv" ? "\t" : "," }

    /// RFC 4180: quoted fields may hold the separator, newlines and doubled quotes.
    static func parse(_ text: String, separator: Character = ",", maxRows: Int = 5000) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], field = ""
        var quoted = false, i = text.startIndex
        while i < text.endIndex, rows.count < maxRows {
            let ch = text[i]
            if quoted {
                if ch == "\"" {
                    let next = text.index(after: i)
                    if next < text.endIndex, text[next] == "\"" { field.append("\""); i = next } else { quoted = false }
                } else { field.append(ch) }
            } else if ch == "\"" && field.isEmpty {
                quoted = true
            } else if ch == separator {
                row.append(field); field = ""
            } else if ch == "\n" || ch == "\r\n" || ch == "\r" {
                row.append(field); field = ""
                rows.append(row); row = []
            } else { field.append(ch) }
            i = text.index(after: i)
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows
    }
}

struct CSVTableView: View {
    let url: URL
    let separator: Character
    @State private var rows: [[String]] = []

    var body: some View {
        let width = rows.map(\.count).max() ?? 0
        ScrollView([.horizontal, .vertical]) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(0 ..< width, id: \.self) { c in
                            Text(c < row.count ? row[c] : "")
                                .font(r == 0 ? .callout.weight(.semibold) : .callout)
                                .monospacedDigit()
                                .lineLimit(3)
                                .frame(minWidth: 60, maxWidth: 280, alignment: .leading)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .background(r == 0 ? Color.ink.opacity(0.06) : r.isMultiple(of: 2) ? Color.ink.opacity(0.025) : Color.clear)
                                .overlay(alignment: .trailing) { Rectangle().fill(Color.ink.opacity(0.08)).frame(width: 0.5) }
                        }
                    }
                }
            }
            .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.ink.opacity(0.12), lineWidth: 0.5) }
            .clipShape(.rect(cornerRadius: 8, style: .continuous))
            .padding(20)
        }
        // A table starts where it starts, top left, as in Numbers.
        .defaultScrollAnchor(.topLeading)
        .task(id: url) {
            let text = (try? String(contentsOf: url, encoding: .utf8)) ?? (try? String(contentsOf: url, encoding: .isoLatin1)) ?? ""
            rows = CSVTable.parse(text, separator: separator)
        }
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
