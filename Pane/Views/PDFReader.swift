import PDFKit
import SwiftUI

/// A PDF kept in a folder, read the way Preview reads one: zoom (⌘+ ⌘- ⌘0, fit width, pinch),
/// the page you're on and Go to Page, a sidebar of page thumbnails and the table of contents,
/// Find (⌘F) with every match highlighted, and text you can select and copy. It sits in the note
/// pane, under a bar styled like the app's toolbar.
@MainActor @Observable
final class PDFReaderModel {
    let document: PDFDocument?
    /// The view, once it's made (the representable hands it over).
    @ObservationIgnored weak var view: PDFView?

    var page = 1
    var pageCount: Int
    var scale: CGFloat = 1
    var fitsWidth = true
    var showsSidebar = false
    var sidebar: Sidebar = .pages
    var finding = false
    var query = ""
    var matches: [PDFSelection] = []
    var match = 0

    enum Sidebar: Hashable { case pages, contents }

    /// Zoom steps, as Preview's: from a quarter to six times.
    static let steps: [CGFloat] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6]

    init(url: URL) {
        document = PDFDocument(url: url)
        pageCount = document?.pageCount ?? 0
    }

    init(document: PDFDocument?) {
        self.document = document
        pageCount = document?.pageCount ?? 0
    }

    /// The table of contents, when the PDF has one.
    var outline: [PDFOutline] {
        guard let root = document?.outlineRoot else { return [] }
        return (0 ..< root.numberOfChildren).compactMap { root.child(at: $0) }
    }

    var pageLabel: String { pageCount == 0 ? "" : "\(page) of \(pageCount)" }
    var zoomLabel: String { "\(Int((scale * 100).rounded()))%" }

    /// The next step up or down from the current scale.
    static func step(from scale: CGFloat, up: Bool) -> CGFloat {
        if up { return steps.first { $0 > scale + 0.001 } ?? steps.last! }
        return steps.last { $0 < scale - 0.001 } ?? steps.first!
    }

    func zoom(in up: Bool) {
        guard let v = view else { return }
        fitsWidth = false
        v.autoScales = false
        v.scaleFactor = Self.step(from: v.scaleFactor, up: up)
        scale = v.scaleFactor
    }

    func actualSize() {
        guard let v = view else { return }
        fitsWidth = false
        v.autoScales = false
        v.scaleFactor = 1
        scale = 1
    }

    func fitWidth() {
        guard let v = view else { return }
        fitsWidth = true
        v.autoScales = true
        scale = v.scaleFactor
    }

    /// Goes to a page (1-based), clamped to the document.
    func go(to number: Int) {
        guard let doc = document, doc.pageCount > 0 else { return }
        let n = min(max(number, 1), doc.pageCount)
        if let p = doc.page(at: n - 1) { view?.go(to: p) }
        page = n
    }

    func go(to outline: PDFOutline) {
        if let d = outline.destination { view?.go(to: d) } else if let a = outline.action as? PDFActionGoTo { view?.go(to: a.destination) }
    }

    /// Every match of the query, highlighted, the first one shown.
    func find() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard let doc = document, !q.isEmpty else { clearFind(); return }
        matches = doc.findString(q, withOptions: [.caseInsensitive, .diacriticInsensitive])
        for m in matches { m.color = .findHighlight }
        view?.highlightedSelections = matches
        match = 0
        show()
    }

    func next(_ forward: Bool = true) {
        guard !matches.isEmpty else { return }
        match = (match + (forward ? 1 : matches.count - 1)) % matches.count
        show()
    }

    private func show() {
        guard matches.indices.contains(match), let v = view else { return }
        let m = matches[match]
        v.setCurrentSelection(m, animate: true)
        v.go(to: m)
    }

    func clearFind() {
        matches = []
        match = 0
        view?.highlightedSelections = nil
        view?.clearSelection()
    }

    var findLabel: String {
        if query.trimmingCharacters(in: .whitespaces).isEmpty { return "" }
        return matches.isEmpty ? "Not found" : "\(match + 1) of \(matches.count)"
    }

    /// Follows the view: the page shown and the scale.
    func sync() {
        guard let v = view, let doc = document else { return }
        if let p = v.currentPage { page = doc.index(for: p) + 1 }
        scale = v.scaleFactor
    }
}

extension PColor {
    /// Find highlights: Preview's yellow, readable in light and dark.
    static var findHighlight: PColor { PColor.systemYellow.withAlphaComponent(0.55) }
}

struct PDFReader: View {
    @State private var model: PDFReaderModel
    @FocusState private var findFocused: Bool
    @State private var pageDraft = ""
    @FocusState private var pageFocused: Bool

    init(url: URL, sidebar: Bool = PDFReader.captureSidebar, contents: Bool = false, find: String? = PDFReader.captureFind) {
        let m = PDFReaderModel(url: url)
        m.showsSidebar = sidebar
        if contents, !m.outline.isEmpty { m.sidebar = .contents }
        if let find { m.query = find; m.finding = true }
        _model = State(initialValue: m)
    }

    /// Captures: `-uitest -pdfSidebar` opens the sidebar, `-pdfFind <words>` starts a find.
    static var captureSidebar: Bool { ProcessInfo.processInfo.arguments.contains("-uitest") && ProcessInfo.processInfo.arguments.contains("-pdfSidebar") }
    static var captureFind: String? {
        let a = ProcessInfo.processInfo.arguments
        guard a.contains("-uitest"), let i = a.firstIndex(of: "-pdfFind"), i + 1 < a.count else { return nil }
        return a[i + 1]
    }

    var body: some View {
        VStack(spacing: 0) {
            bar
            Divider()
            HStack(spacing: 0) {
                if model.showsSidebar {
                    sidebar
                        .frame(width: PDFReaderMetrics.sidebarWidth)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                    Divider()
                }
                PDFKitView(model: model)
                    .accessibilityIdentifier("file.pdf")
            }
        }
        .animation(.snappy(duration: 0.22), value: model.showsSidebar)
        .task { if !model.query.isEmpty { try? await Task.sleep(for: .milliseconds(300)); model.find() } }
        .background(Color.notePage)
    }

    // MARK: The bar

    private var bar: some View {
        #if os(iOS)
        // iPhone: pinch zooms; the bar keeps pages, the sidebar and Find.
        HStack(spacing: 10) {
            Button { model.showsSidebar.toggle() } label: { Label("Pages", systemImage: "sidebar.left") }
                .accessibilityIdentifier("pdf.sidebar")
            if model.finding {
                findField
                Button("Done") { model.finding = false; model.query = ""; model.clearFind() }
            } else {
                Spacer(minLength: 4)
                pageField
                Spacer(minLength: 4)
                Button { model.finding = true; findFocused = true } label: { Label("Find", systemImage: "magnifyingglass") }
                    .accessibilityIdentifier("pdf.findButton")
            }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.bar)
        #else
        macBar
        #endif
    }

    private var macBar: some View {
        HStack(spacing: 8) {
            Button { model.showsSidebar.toggle() } label: { Label("Sidebar", systemImage: "sidebar.left") }
                .help(model.showsSidebar ? "Hide Sidebar" : "Show Sidebar")
                .accessibilityIdentifier("pdf.sidebar")
            Divider().frame(height: 18)
            Button { model.zoom(in: false) } label: { Label("Zoom Out", systemImage: "minus.magnifyingglass") }
                .keyboardShortcut("-", modifiers: .command)
                .help("Zoom Out (⌘-)")
            Text(model.zoomLabel)
                .font(.callout.monospacedDigit())
                .foregroundStyle(Color.muted)
                .frame(minWidth: 44)
                .accessibilityLabel("Zoom \(model.zoomLabel)")
            Button { model.zoom(in: true) } label: { Label("Zoom In", systemImage: "plus.magnifyingglass") }
                .keyboardShortcut("+", modifiers: .command)
                .help("Zoom In (⌘+)")
            Menu {
                Button("Fit Width") { model.fitWidth() }
                Button("Actual Size") { model.actualSize() }.keyboardShortcut("0", modifiers: .command)
            } label: {
                Label("Zoom", systemImage: model.fitsWidth ? "arrow.left.and.right" : "1.magnifyingglass")
            }
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Fit Width or Actual Size (⌘0)")
            .accessibilityIdentifier("pdf.zoom")
            Spacer(minLength: 8)
            pageField
            Spacer(minLength: 8)
            findField
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.bar)
        // ⌘F finds in the PDF; ⌘= is ⌘+ without shift.
        .background {
            Button("Find") { model.finding = true; findFocused = true }.keyboardShortcut("f", modifiers: .command).hidden()
            Button("Zoom In") { model.zoom(in: true) }.keyboardShortcut("=", modifiers: .command).hidden()
        }
    }

    private var pageField: some View {
        HStack(spacing: 4) {
            TextField("Page", text: $pageDraft)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.trailing)
                .frame(width: 44)
                .focused($pageFocused)
                .onSubmit { if let n = Int(pageDraft) { model.go(to: n) }; pageFocused = false }
                .accessibilityLabel("Go to page")
                .accessibilityIdentifier("pdf.page")
            Text("of \(model.pageCount)")
                .font(.callout.monospacedDigit())
                .foregroundStyle(Color.muted)
        }
        .onChange(of: model.page, initial: true) { _, p in if !pageFocused { pageDraft = "\(p)" } }
        .help("Go to Page")
    }

    private var findField: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass").foregroundStyle(Color.muted).imageScale(.small)
            TextField("Find in PDF", text: $model.query)
                .textFieldStyle(.plain)
                #if os(macOS)
                .frame(width: PDFReaderMetrics.findWidth)
                #endif
                .focused($findFocused)
                .onSubmit { model.matches.isEmpty ? model.find() : model.next() }
                .onChange(of: model.query) { _, _ in model.find() }
                .accessibilityIdentifier("pdf.find")
            if !model.findLabel.isEmpty {
                Text(model.findLabel).font(.caption.monospacedDigit()).foregroundStyle(Color.muted).fixedSize()
                Button { model.next(false) } label: { Label("Previous", systemImage: "chevron.up") }.disabled(model.matches.isEmpty)
                Button { model.next() } label: { Label("Next", systemImage: "chevron.down") }.disabled(model.matches.isEmpty)
                Button { model.query = ""; model.clearFind() } label: { Label("Clear", systemImage: "xmark.circle.fill") }
                    .foregroundStyle(Color.muted)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.ink.opacity(0.06), in: .capsule)
    }

    // MARK: The sidebar

    private var sidebar: some View {
        VStack(spacing: 0) {
            if !model.outline.isEmpty {
                Picker("Show", selection: $model.sidebar) {
                    Text("Pages").tag(PDFReaderModel.Sidebar.pages)
                    Text("Contents").tag(PDFReaderModel.Sidebar.contents)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(8)
            }
            if model.sidebar == .contents && !model.outline.isEmpty {
                List {
                    OutlineGroup(model.outline.map(OutlineItem.init), children: \.children) { item in
                        Button(item.title) { model.go(to: item.outline) }
                            .buttonStyle(.plain)
                            .lineLimit(2)
                    }
                }
                .listStyle(.sidebar)
                .accessibilityIdentifier("pdf.contents")
            } else {
                PDFThumbnails(model: model)
                    .accessibilityIdentifier("pdf.thumbnails")
            }
        }
        .background(Color.ink.opacity(0.03))
    }
}

/// An outline entry as a tree for OutlineGroup.
struct OutlineItem: Identifiable {
    let outline: PDFOutline
    var id: ObjectIdentifier { ObjectIdentifier(outline) }
    var title: String { outline.label ?? "Untitled" }
    var children: [OutlineItem]? {
        outline.numberOfChildren == 0 ? nil : (0 ..< outline.numberOfChildren).compactMap { outline.child(at: $0) }.map(OutlineItem.init)
    }
}

enum PDFReaderMetrics {
    #if os(macOS)
    static let sidebarWidth: CGFloat = 150
    static let findWidth: CGFloat = 150
    #else
    static let sidebarWidth: CGFloat = 110
    static let findWidth: CGFloat = 110
    #endif
}

#if os(macOS)
struct PDFKitView: NSViewRepresentable {
    let model: PDFReaderModel

    func makeNSView(context: Context) -> PDFView {
        let v = PDFView()
        v.document = model.document
        v.displayMode = .singlePageContinuous
        v.displaysPageBreaks = true
        v.autoScales = true
        v.backgroundColor = .clear
        model.view = v
        context.coordinator.observe(v, model: model)
        return v
    }

    func updateNSView(_ v: PDFView, context: Context) {}

    func makeCoordinator() -> PDFCoordinator { PDFCoordinator() }
}

struct PDFThumbnails: NSViewRepresentable {
    let model: PDFReaderModel

    func makeNSView(context: Context) -> PDFThumbnailView {
        let t = PDFThumbnailView()
        t.thumbnailSize = CGSize(width: 96, height: 124)
        t.backgroundColor = .clear
        t.pdfView = model.view
        return t
    }

    func updateNSView(_ t: PDFThumbnailView, context: Context) {
        if t.pdfView !== model.view { t.pdfView = model.view }
    }
}
#else
struct PDFKitView: UIViewRepresentable {
    let model: PDFReaderModel

    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.document = model.document
        v.displayMode = .singlePageContinuous
        v.autoScales = true
        v.backgroundColor = .clear
        model.view = v
        context.coordinator.observe(v, model: model)
        return v
    }

    func updateUIView(_ v: PDFView, context: Context) {}

    func makeCoordinator() -> PDFCoordinator { PDFCoordinator() }
}

struct PDFThumbnails: UIViewRepresentable {
    let model: PDFReaderModel

    func makeUIView(context: Context) -> PDFThumbnailView {
        let t = PDFThumbnailView()
        t.layoutMode = .vertical
        t.thumbnailSize = CGSize(width: 72, height: 96)
        t.backgroundColor = .clear
        t.pdfView = model.view
        return t
    }

    func updateUIView(_ t: PDFThumbnailView, context: Context) {
        if t.pdfView !== model.view { t.pdfView = model.view }
    }
}
#endif

/// Keeps the model's page and zoom in step with what the view shows.
@MainActor final class PDFCoordinator: NSObject {
    nonisolated(unsafe) private var tokens: [NSObjectProtocol] = []

    func observe(_ v: PDFView, model: PDFReaderModel) {
        for name in [Notification.Name.PDFViewPageChanged, .PDFViewScaleChanged] {
            tokens.append(NotificationCenter.default.addObserver(forName: name, object: v, queue: .main) { [weak model] _ in
                MainActor.assumeIsolated { model?.sync() }
            })
        }
    }

    deinit { tokens.forEach(NotificationCenter.default.removeObserver) }
}
