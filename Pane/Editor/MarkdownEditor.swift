import SwiftUI

/// The live-preview markdown editor. One instance per open note.
struct MarkdownEditor: View {
    /// The note's current body. Changes from elsewhere (sync, an AI) flow into the editor.
    let initialText: String
    let header: String
    let controller: EditorController
    var autofocus = false
    var identifier = "editor"
    var titleLine = true
    let onChange: (String) -> Void

    var body: some View {
        PlatformEditor(initialText: initialText, header: header, controller: controller, autofocus: autofocus, identifier: identifier, titleLine: titleLine, onChange: onChange)
    }
}

/// Behaviour shared by the UIKit and AppKit text views.
@MainActor
final class EditorCore {
    var styler = MarkdownStyler()
    let layoutDelegate = DecoratingLayoutDelegate()
    var onChange: (String) -> Void = { _ in }
    var applyingEdit = false
    private var lastActiveLine: NSRange?
    /// Live views currently placed over the text.
    private(set) var embeds: [LineEmbed] = []
    private(set) var grids: [GridTable] = []
    /// A just-inserted table whose first cell should take the keyboard.
    var pendingGridFocus: Int?
    /// Looks up a file so images can be sized (set by the text view).
    var resolveAttachment: (UUID) -> Attachment? = { _ in nil }
    /// Called after a restyle, so the view can place live views.
    var onCardsChanged: () -> Void = {}

    /// An empty 2×2 table after the caret's line; returns the edit and the table's index.
    func newGridEdit(text: String, selection: NSRange) -> (TextEdit, Int) {
        let ns = text as NSString
        let line = ns.lineRange(for: NSRange(location: min(selection.location, ns.length), length: 0))
        let empty = ns.substring(with: line).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let at = empty ? line.location : NSMaxRange(line)
        let lead = empty || ns.substring(with: line).hasSuffix("\n") ? "" : "\n"
        let body = lead + "|  |  |\n| --- | --- |\n|  |  |\n"
        let index = GridTable.find(in: ns.substring(to: at)).count
        // The caret ends up after the table, so the table isn't shown as source.
        return (TextEdit(range: NSRange(location: at, length: empty ? line.length : 0), replacement: body + (empty ? "\n" : ""), caret: at + (body as NSString).length), index)
    }


    /// Every live view to place over the text: cards and embeds, keyed for reuse.
    func overlays(layout: NSTextLayoutManager?, origin: CGPoint, target: EditorTarget, storage: NSTextStorage, controller: EditorController?, selection: @escaping () -> NSRange?) -> [(key: String, frame: CGRect, view: AnyView)] {
        guard let tlm = layout, let tcm = tlm.textContentManager, let container = tlm.textContainer else { return [] }
        let width = container.size.width - container.lineFragmentPadding * 2
        func frame(at offset: Int, height: CGFloat, maxWidth: CGFloat = .infinity) -> CGRect? {
            guard let loc = tcm.location(tcm.documentRange.location, offsetBy: offset) else { return nil }
            tlm.ensureLayout(for: NSTextRange(location: loc))
            guard let frag = tlm.textLayoutFragment(for: loc), let line = frag.textLineFragments.first else { return nil }
            let y = frag.layoutFragmentFrame.minY + line.typographicBounds.minY + origin.y
            return CGRect(x: origin.x + container.lineFragmentPadding, y: y, width: min(width, maxWidth), height: height)
        }
        var out: [(String, CGRect, AnyView)] = []
        for g in grids {
            // The row handles sit in the margin, so the grid lines up with the text.
            guard var f = frame(at: g.range.location, height: GridMetrics.height(g)) else { continue }
            f.origin.x -= GridMetrics.handle
            f.size.width += GridMetrics.handle
            let focusFirst = pendingGridFocus == g.index
            if focusFirst { pendingGridFocus = nil }
            let request = gridFocus?.grid == g.index ? gridFocus : nil
            let isSelected = armedGrid == g.index
            let view = TableGridView(table: g, initialFocus: focusFirst ? GridCell(row: 0, column: 0) : nil,
                                     focusRequest: request, selected: isSelected, exit: { [weak target] below in target?.leaveGrid(g.index, below: below) }) { edited in
                // Find the table again in the current text: earlier edits may have moved it.
                let now = GridTable.find(in: target.currentText)
                guard edited.index < now.count else { return }
                target.apply(TextEdit(range: now[edited.index].range, replacement: edited.markdown, caret: -1))
            }
            out.append(("g\(g.index)", f, AnyView(view)))
        }
        for e in embeds {
            // Cards and images share one column width, so their edges line up.
            let maxW = ImageSizes.maxWidth
            guard let f = frame(at: e.range.location, height: e.height, maxWidth: maxW) else { continue }
            let remove = {
                let ns = target.currentText as NSString
                var r = ns.lineRange(for: e.range)
                if NSMaxRange(r) == ns.length, r.location > 0 { r = NSRange(location: r.location - 1, length: r.length + 1) }
                target.apply(TextEdit(range: r, replacement: "", caret: -1))
            }
            out.append((e.key, f, AnyView(EmbedView(embed: e, controller: controller, remove: remove))))
        }
        return out
    }


    /// Restyles if the text changed or the caret moved to another line.
    /// `selection` is nil when you're not editing: then all syntax stays hidden.
    func restyle(_ storage: NSTextStorage, selection: NSRange?, force: Bool) {
        let ns = storage.string as NSString
        var line = NSRange(location: NSNotFound, length: 0)
        if let selection, ns.length > 0 {
            line = ns.lineRange(for: NSRange(location: min(selection.location, ns.length), length: min(selection.length, ns.length - min(selection.location, ns.length))))
        }
        if !force, dirty == nil, !needsFull, line == lastActiveLine { return }
        let previous = lastActiveLine
        lastActiveLine = line
        let structure = self.structure(of: storage.string)
        let fences = structure.fences
        var region = needsFull || alwaysFull || fences != lastFenceCount || structure.hasNestedFence ? nil : self.region(ns, structure: structure, previous: previous ?? line, active: line)
        lastFenceCount = fences
        needsFull = false
        dirty = nil
        if region == nil, ns.length > Self.progressiveThreshold {
            // A long note: style the top now and the rest a chunk at a time,
            // so it opens at once. The active line is styled with the top.
            region = chunk(ns, structure: structure, from: 0, including: line)
            unstyledFrom = NSMaxRange(region!)
            styling = storage
            scheduleChunk()
        } else if region == nil {
            unstyledFrom = Int.max
        }
        // Images need their size before their line is laid out.
        for e in structure.embeds where region.map({ NSLocationInRange(e.range.location, $0) }) ?? true {
            if case .image(let id, _) = e.kind, let a = resolveAttachment(id) { ImageSizes.learn(id, url: FileStore.url(for: a.id, filename: a.filename)) }
        }
        lastRegions.append(region.map { "\($0)" } ?? "full")
        if lastRegions.count > 6 { lastRegions.removeFirst() }
        let blocks = styler.apply(to: storage, active: selection ?? NSRange(location: NSNotFound, length: 0), region: region, structure: structure)
        publish(blocks)
    }

    /// The last few restyle regions, for tests that check incremental styling.
    private(set) var lastRegions: [String] = []

    /// Live views only for lines already styled (their space is reserved).
    private func publish(_ blocks: StyledBlocks) {
        embeds = blocks.embeds.filter { $0.range.location < unstyledFrom }
        grids = blocks.grids.filter { $0.range.location < unstyledFrom }
        onCardsChanged()
    }

    // MARK: Progressive styling

    /// Notes longer than this open with their top styled first.
    static let progressiveThreshold = 24_000
    private static let chunkSize = 16_000
    /// Everything from here on hasn't been styled yet (Int.max: all styled).
    private(set) var unstyledFrom = Int.max
    private weak var styling: NSTextStorage?
    private var chunkScheduled = false

    /// Whole lines from `from`, about one chunk long, never cutting a code block
    /// or table, and reaching at least to the end of `including`.
    private func chunk(_ ns: NSString, structure: NoteStructure, from: Int, including: NSRange) -> NSRange {
        var end = min(ns.length, from + Self.chunkSize)
        if including.location != NSNotFound { end = max(end, min(ns.length, NSMaxRange(including))) }
        end = end < ns.length ? NSMaxRange(ns.lineRange(for: NSRange(location: end, length: 0))) : ns.length
        var r = NSRange(location: from, length: end - from)
        let blocks = structure.code + structure.grids.map { ns.lineRange(for: $0.range) }
        var grew = true
        while grew {
            grew = false
            for b in blocks where NSIntersectionRange(b, r).length > 0 {
                let u = NSUnionRange(b, r)
                if u != r { r = u; grew = true }
            }
        }
        return r
    }

    private func scheduleChunk() {
        guard !chunkScheduled else { return }
        chunkScheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.chunkScheduled = false
            self.styleNextChunk()
        }
    }

    private func styleNextChunk() {
        guard let storage = styling, unstyledFrom < storage.length else { unstyledFrom = Int.max; return }
        let ns = storage.string as NSString
        let structure = self.structure(of: storage.string)
        let r = chunk(ns, structure: structure, from: unstyledFrom, including: NSRange(location: NSNotFound, length: 0))
        let active = lastActiveLine.flatMap { $0.location == NSNotFound ? nil : $0 } ?? NSRange(location: NSNotFound, length: 0)
        let blocks = styler.apply(to: storage, active: active, region: r, structure: structure)
        unstyledFrom = NSMaxRange(r) >= ns.length ? Int.max : NSMaxRange(r)
        publish(blocks)
        if unstyledFrom != Int.max { scheduleChunk() }
    }

    // MARK: Incremental restyling

    /// Tests: restyle everything every time (to tell incremental bugs from others).
    var alwaysFull = false

    /// Characters changed since the last restyle, as the text storage reported them.
    private var dirty: NSRange?
    /// The next restyle covers the whole note (first show, big replacements).
    private var needsFull = true
    private var lastFenceCount = -1
    private var editObserver: NSObjectProtocol?

    /// Follows edits to the text so a restyle can cover just the lines that changed.
    func observe(_ storage: NSTextStorage) {
        if let editObserver { NotificationCenter.default.removeObserver(editObserver) }
        editObserver = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: storage, queue: nil) { [weak self, weak storage] _ in
            guard let storage, storage.editedMask.contains(.editedCharacters) else { return }
            let edited = storage.editedRange, delta = storage.changeInLength
            MainActor.assumeIsolated { self?.noteEdit(edited, delta: delta) }
        }
    }

    func noteEdit(_ edited: NSRange, delta: Int) {
        version += 1
        func shift(_ r: NSRange) -> NSRange {
            // Ranges after the edit move with it; ranges it overlaps grow to cover it.
            let oldEnd = edited.location + edited.length - delta
            if r.location >= oldEnd { return NSRange(location: r.location + delta, length: r.length) }
            if NSMaxRange(r) <= edited.location { return r }
            return NSUnionRange(NSRange(location: r.location, length: max(0, r.length + delta)), edited)
        }
        dirty = dirty.map { NSUnionRange(shift($0), edited) } ?? edited
        if let l = lastActiveLine, l.location != NSNotFound { lastActiveLine = shift(l) }
        if unstyledFrom != Int.max, unstyledFrom > edited.location { unstyledFrom = max(edited.location, unstyledFrom + delta) }
        if edited.length > 20_000 || abs(delta) > 20_000 { needsFull = true }
    }

    /// Whole lines to restyle: the edit, the old and new active lines, the title
    /// if it's involved, grown until no code block or table is cut in two.
    /// Nil means the whole note.
    func region(_ ns: NSString, structure: NoteStructure, previous: NSRange, active: NSRange) -> NSRange? {
        let len = ns.length
        guard len > 0 else { return nil }
        func lines(_ r: NSRange) -> NSRange? {
            guard r.location != NSNotFound else { return nil }
            let loc = min(r.location, len)
            return ns.lineRange(for: NSRange(location: loc, length: min(r.length, len - loc)))
        }
        var parts = [dirty, previous, active].compactMap { $0 }.compactMap(lines)
        guard var r = parts.popLast() else { return nil }
        for p in parts { r = NSUnionRange(r, p) }
        // Markdown blocks run between blank lines (a paragraph's inline code, an HTML
        // block, a lazy quote line), and an edit can split or join lines: restyle the
        // whole run around the change, at most 100 lines each way.
        r = Self.blankLineRun(ns, around: r, maxLines: 100)
        // A typed-table comment or fence edited: everything may read differently.
        let touched = ns.substring(with: r)
        if touched.contains("<!--") || touched.contains("```") || touched.contains("~~~") { return nil }
        let title = MarkdownStyler.titleLocation(ns)
        if r.location <= title + 1 {
            // Near the title: the title (and the line after, which may become it) too.
            var end = title < len ? NSMaxRange(ns.lineRange(for: NSRange(location: title, length: 0))) : len
            if end < len { end = NSMaxRange(ns.lineRange(for: NSRange(location: end, length: 0))) }
            r = NSUnionRange(r, NSRange(location: 0, length: min(end, len)))
        }
        let blocks = structure.code + structure.grids.map { ns.lineRange(for: $0.range) }
        var grew = true
        while grew {
            grew = false
            for b in blocks where NSIntersectionRange(b, r).length > 0 || NSLocationInRange(r.location, b) {
                let u = NSUnionRange(b, r)
                if u != r { r = u; grew = true }
            }
        }
        // Past half the note, one full pass is simpler and no slower.
        return r.length > len / 2 ? nil : r
    }

    /// `r` grown to the blank lines (or note ends) around it, one extra line each
    /// way, at most `maxLines` lines further in either direction.
    static func blankLineRun(_ ns: NSString, around r: NSRange, maxLines: Int) -> NSRange {
        let len = ns.length
        func isBlank(_ line: NSRange) -> Bool {
            var i = line.location
            while i < NSMaxRange(line) {
                let c = ns.character(at: i)
                if c != 0x20 && c != 0x09 && c != 0x0A && c != 0x0D { return false }
                i += 1
            }
            return true
        }
        var start = r.location
        for n in 0...maxLines {
            guard start > 0 else { break }
            let prev = ns.lineRange(for: NSRange(location: start - 1, length: 0))
            start = prev.location
            if n > 0 && isBlank(prev) { break }
        }
        var end = NSMaxRange(r)
        for n in 0...maxLines {
            guard end < len else { break }
            let next = ns.lineRange(for: NSRange(location: end, length: 0))
            end = NSMaxRange(next)
            if n > 0 && isBlank(next) { break }
        }
        return NSRange(location: start, length: end - start)
    }

    /// Fenced-code markers in the note; when their count changes everything restyles.
    static func fenceCount(_ ns: NSString) -> Int {
        var n = 0
        var start = true
        var i = 0
        let len = ns.length
        while i < len {
            let c = ns.character(at: i)
            if start, c == 0x60 || c == 0x7E, i + 2 < len, ns.character(at: i + 1) == c, ns.character(at: i + 2) == c { n += 1 }
            start = c == 0x0A || (start && (c == 0x20 || c == 0x09))
            i += 1
        }
        return n
    }

    private var lastSelection: NSRange?
    /// Bumped on every edit, so the structure is scanned once per version of the text.
    private var version = 0
    private var structureCache: (version: Int, length: Int, structure: NoteStructure)?

    /// Code blocks, tables and embeds of the current text, scanned once per edit.
    func structure(of text: String) -> NoteStructure {
        let length = (text as NSString).length
        if let c = structureCache, c.version == version, c.length == length { return c.structure }
        let s = NoteStructure(text)
        structureCache = (version, length, s)
        return s
    }

    /// Tables and embeds, each a whole block the caret goes around.
    func blocks(in text: String) -> [EditorBlock] { structure(of: text).blocks }

    /// Where the caret should go instead, if it landed somewhere it can't be:
    /// inside a list marker, or inside a table's or embed's hidden markdown.
    /// `byKeyboard` is true when an arrow key moved it (then it enters a table
    /// like Notes); a click next to a block puts the caret after it.
    func caretFix(_ text: String, _ selection: NSRange, byKeyboard: Bool) -> CaretFix? {
        defer { lastSelection = selection }
        guard selection.length == 0 else { return nil }
        if let b = blocks(in: text).first(where: { $0.contains(selection.location) }) {
            let fromBelow = (lastSelection?.location ?? -1) > NSMaxRange(b.range)
            let fromAbove = lastSelection.map { $0.location < b.range.location } ?? false
            if byKeyboard, let g = b.grid, fromAbove || fromBelow {
                let rows = GridTable.find(in: text).first { $0.index == g }?.rows.count ?? 1
                return .enterGrid(g, GridCell(row: fromBelow ? rows - 1 : 0, column: 0))
            }
            // Clicks land after the block; the keyboard keeps its direction.
            if byKeyboard, fromBelow { return b.range.location > 0 ? .move(b.range.location - 1) : .newLineBefore(b.range.location) }
            let after = NSMaxRange(b.range)
            return after < (text as NSString).length ? .move(after + 1) : .newLineAfter(after)
        }
        return ListEditing.caretOutsideMarker(in: text, selection: selection, previous: lastSelection).map { .move($0) }
    }

    /// A grid cell the keyboard should move into (set when arrowing into a table).
    var gridFocus: GridFocusRequest?

    /// Delete next to a table or embed, like Notes: an embed goes at once; a table
    /// is selected first, and a second press removes it. Never merges a line into
    /// a block's markdown.
    func deleteNearBlock(_ text: String, _ sel: NSRange, forward: Bool) -> BlockDelete? {
        let ns = text as NSString
        let all = blocks(in: text)
        func removal(_ b: EditorBlock) -> TextEdit {
            var r = b.range
            if NSMaxRange(r) < ns.length { r.length += 1 } else if r.location > 0 { r.location -= 1; r.length += 1 }
            return TextEdit(range: r, replacement: "", caret: min(r.location, ns.length - r.length))
        }
        guard sel.length == 0 else { return nil }
        let hit = forward ? all.first { $0.range.location > 0 && $0.range.location - 1 == sel.location }
                          : all.first { NSMaxRange($0.range) + 1 == sel.location }
        guard let b = hit else { armedGrid = nil; return nil }
        guard let g = b.grid else { return .delete(removal(b)) }
        if armedGrid == g, armedAt == sel { armedGrid = nil; return .delete(removal(b)) }
        armedGrid = g
        armedAt = sel
        return .arm(g)
    }

    /// A table marked for deletion by one press of Delete; the next press removes it.
    private(set) var armedGrid: Int?
    private var armedAt: NSRange?

    /// Any caret move or edit clears the mark. Returns true if there was one.
    @discardableResult
    func disarm(unless sel: NSRange) -> Bool {
        guard armedGrid != nil, sel != armedAt else { return false }
        armedGrid = nil
        armedAt = nil
        return true
    }

    /// Checkbox hit test: `point` is in text-container coordinates.
    func checkboxLine(at point: CGPoint, layout: NSTextLayoutManager?) -> Int? {
        guard let layout, let fragment = layout.textLayoutFragment(for: point) as? DecoratedLayoutFragment,
              let d = fragment.decoration, case .checkbox = d.kind else { return nil }
        let x = point.x - fragment.layoutFragmentFrame.minX
        guard abs(x - d.markerX) < EditorMetrics.body * 1.1 else { return nil }
        guard let content = layout.textContentManager else { return nil }
        return content.offset(from: content.documentRange.location, to: fragment.rangeInElement.location)
    }
}

#if os(iOS)
import UIKit
import UniformTypeIdentifiers

private struct PlatformEditor: UIViewRepresentable {
    let initialText: String
    let header: String
    let controller: EditorController
    let autofocus: Bool
    let identifier: String
    let titleLine: Bool
    let onChange: (String) -> Void

    func makeUIView(context: Context) -> PaneTextView {
        let view = PaneTextView(frame: .zero)
        view.core.styler.firstLineIsTitle = titleLine
        view.configure(text: initialText, header: header)
        view.accessibilityIdentifier = identifier
        view.core.onChange = onChange
        controller.target = view
        view.controller = controller
        view.core.resolveAttachment = { [weak controller] id in controller?.resolveAttachment(id) }
        view.inputAccessoryView = FormatBarHost(controller: controller) { [weak view] in view?.resignFirstResponder() }
        if autofocus { DispatchQueue.main.async { view.becomeFirstResponder() } }
        return view
    }

    func updateUIView(_ view: PaneTextView, context: Context) {
        view.core.onChange = onChange
        view.setHeader(header)
        view.syncExternal(initialText)
        if controller.target !== view { controller.target = view }
    }
}

final class PaneTextView: UITextView, UITextViewDelegate, EditorTarget, UIGestureRecognizerDelegate, UITextDropDelegate {
    let core = EditorCore()
    weak var controller: EditorController?
    private let headerLabel = UILabel()
    private let readableWidth: CGFloat = 680

    private var cardHosts: [String: UIHostingController<AnyView>] = [:]

    func configure(text: String, header: String) {
        textLayoutManager?.delegate = core.layoutDelegate
        delegate = self
        textDropDelegate = self
        core.onCardsChanged = { [weak self] in self?.setNeedsLayout() }
        backgroundColor = .clear
        alwaysBounceVertical = true
        keyboardDismissMode = .interactive
        smartDashesType = .no
        smartQuotesType = .no
        linkTextAttributes = [:]
        typingAttributes = core.styler.typingAttributes
        self.text = text
        lastReported = text
        remember(text)
        core.observe(textStorage)
        core.restyle(textStorage, selection: nil, force: true)

        headerLabel.font = .systemFont(ofSize: 13, weight: .medium)
        headerLabel.textColor = .tertiaryLabel
        headerLabel.textAlignment = .center
        headerLabel.accessibilityIdentifier = "editor.date"
        addSubview(headerLabel)
        setHeader(header)

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.delegate = self
        addGestureRecognizer(tap)
        accessibilityIdentifier = "editor"
        NotificationCenter.default.addObserver(self, selector: #selector(textSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(textSizeChanged), name: UIAccessibility.boldTextStatusDidChangeNotification, object: nil)
    }

    func setHeader(_ s: String) {
        if headerLabel.text != s { headerLabel.text = s }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let side = max(20, (bounds.width - readableWidth) / 2)
        let inset = UIEdgeInsets(top: (headerLabel.text ?? "").isEmpty ? 14 : 44, left: side, bottom: 120, right: side)
        if textContainerInset != inset { textContainerInset = inset }
        headerLabel.frame = CGRect(x: 0, y: 12, width: bounds.width, height: 18)
        layoutCards()
    }

    /// Places live views (cards, files, links) over their reserved lines.
    private func layoutCards() {
        let items = core.overlays(layout: textLayoutManager, origin: CGPoint(x: textContainerInset.left, y: textContainerInset.top),
                                  target: self, storage: textStorage, controller: controller) { [weak self] in self?.editingSelection }
        let live = Set(items.map(\.key))
        for (k, host) in cardHosts where !live.contains(k) {
            host.view.removeFromSuperview()
            cardHosts[k] = nil
        }
        for item in items {
            let host = cardHosts[item.key] ?? {
                let h = UIHostingController(rootView: item.view)
                h.view.backgroundColor = .clear
                h.sizingOptions = []
                addSubview(h.view)
                cardHosts[item.key] = h
                h.view.frame = item.frame
                return h
            }()
            host.rootView = item.view
            if host.view.frame != item.frame {
                UIView.animate(withDuration: 0.22, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) { host.view.frame = item.frame }
            }
        }
    }

    func insertGrid() {
        let (edit, index) = core.newGridEdit(text: text, selection: selectedRange)
        core.pendingGridFocus = index
        apply(edit)
        resignFirstResponder()
    }


    // MARK: EditorTarget

    var currentText: String { text }
    var currentSelection: NSRange { selectedRange }

    func apply(_ edit: TextEdit) {
        guard let start = position(from: beginningOfDocument, offset: edit.range.location),
              let end = position(from: start, offset: edit.range.length),
              let range = textRange(from: start, to: end) else { return }
        core.applyingEdit = true
        replace(range, withText: edit.replacement)
        core.applyingEdit = false
        if edit.caret >= 0 { selectedRange = NSRange(location: min(edit.caret, (text as NSString).length), length: 0) }
        textDidChange()
    }

    func focusEditor() { becomeFirstResponder() }

    override func paste(_ sender: Any?) {
        let pb = UIPasteboard.general
        let html = pb.data(forPasteboardType: "public.html").flatMap { String(data: $0, encoding: .utf8) }
        if pb.hasImages, let image = pb.image, let png = image.pngData(),
           RichPaste.kind(hasImage: true, text: pb.string, htmlIsOnlyImage: RichPaste.htmlIsOnlyImage(html)) == .image {
            if let a = controller?.addData(png, "Image \(Date.now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false))).png".replacingOccurrences(of: ":", with: "."), .png) {
                controller?.insertFiles([a])
            }
            return
        }
        if let md = RichPaste.markdownFromPasteboard() {
            let sel = selectedRange
            apply(TextEdit(range: sel, replacement: md, caret: sel.location + (md as NSString).length))
            return
        }
        super.paste(sender)
    }

    // MARK: Dropping files

    private func isFileDrop(_ session: UIDropSession) -> Bool {
        session.items.contains { item in
            let types = item.itemProvider.registeredTypeIdentifiers.compactMap(UTType.init)
            return !types.contains { $0.conforms(to: .plainText) || $0.conforms(to: .url) && !$0.conforms(to: .fileURL) }
        }
    }

    func textDroppableView(_ view: UIView & UITextDroppable, proposalForDrop drop: UITextDropRequest) -> UITextDropProposal {
        let p = UITextDropProposal(operation: .copy)
        if isFileDrop(drop.dropSession) { p.dropAction = .insert }
        return p
    }

    func textDroppableView(_ view: UIView & UITextDroppable, willPerformDrop drop: UITextDropRequest) {
        guard isFileDrop(drop.dropSession) else { return }
        let position = drop.dropPosition
        let providers = drop.dropSession.items.map(\.itemProvider)
        Task { @MainActor in
            var urls: [URL] = []
            for p in providers {
                guard let type = p.registeredTypeIdentifiers.first else { continue }
                let name = p.suggestedName
                let url: URL? = await withCheckedContinuation { cont in
                    _ = p.loadFileRepresentation(forTypeIdentifier: type) { src, _ in
                        guard let src else { cont.resume(returning: nil); return }
                        // The provided file is deleted after this returns: copy it out.
                        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
                        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                        let ext = src.pathExtension
                        let fname = name.map { ext.isEmpty || $0.hasSuffix(".\(ext)") ? $0 : "\($0).\(ext)" } ?? src.lastPathComponent
                        let dest = dir.appending(path: fname)
                        cont.resume(returning: (try? FileManager.default.copyItem(at: src, to: dest)) != nil ? dest : nil)
                    }
                }
                if let url { urls.append(url) }
            }
            guard !urls.isEmpty else { return }
            self.selectedTextRange = self.textRange(from: position, to: position)
            self.controller?.insertFiles(self.controller?.addFiles(urls) ?? [])
        }
    }

    // MARK: Delegate

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        guard !core.applyingEdit else { return true }
        if text == "\n", let edit = ListEditing.returnKey(in: self.text, selection: range) {
            apply(edit); return false
        }
        if text.isEmpty {
            // Backspace deletes the character before the caret; a selection deletes itself.
            let sel = selectedRange
            let forward = sel.length == 0 && range.location == sel.location
            if let d = core.deleteNearBlock(self.text, sel, forward: forward) {
                switch d {
                case .arm: layoutCards()
                case .delete(let e): apply(e)
                }
                return false
            }
        }
        if text.isEmpty, range.length == 1, selectedRange.length == 0,
           let edit = ListEditing.backspace(in: self.text, selection: NSRange(location: range.location + 1, length: 0)) {
            apply(edit); return false
        }
        return true
    }

    func textViewDidChange(_ textView: UITextView) { textDidChange() }

    private func textDidChange() {
        guard markedTextRange == nil else { return }
        core.restyle(textStorage, selection: editingSelection, force: true)
        typingAttributes = core.styler.typingAttributes
        lastReported = text
        remember(text)
        core.onChange(text)
    }

    /// The last body we reported or received, to tell outside edits from our own.
    var lastReported = ""
    /// Hashes of recent texts we reported, not yet all written to the note.
    private var reported: [Int] = []

    private func remember(_ s: String) {
        reported.append(s.hashValue)
        if reported.count > 64 { reported.removeFirst(reported.count - 64) }
    }

    func syncExternal(_ new: String) {
        guard new != lastReported else { return }
        // The note still holds text we typed a moment ago (it's saved once typing
        // pauses): that's not a change from elsewhere.
        if reported.contains(new.hashValue) { return }
        reported.removeAll()
        lastReported = new
        guard new != text, markedTextRange == nil else { return }
        let keep = selectedRange
        let offset = contentOffset
        text = new
        selectedRange = NSRange(location: min(keep.location, (new as NSString).length), length: 0)
        core.restyle(textStorage, selection: editingSelection, force: true)
        setContentOffset(offset, animated: false)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard markedTextRange == nil else { return }
        if core.disarm(unless: selectedRange) { layoutCards() }
        if isFirstResponder, let fix = core.caretFix(text, selectedRange, byKeyboard: false) {
            resolve(fix)
            return
        }
        core.restyle(textStorage, selection: editingSelection, force: false)
    }

    private var editingSelection: NSRange? { isFirstResponder ? selectedRange : nil }

    func textViewDidBeginEditing(_ textView: UITextView) {
        controller?.isEditing = true
        core.restyle(textStorage, selection: selectedRange, force: true)
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        controller?.isEditing = false
        core.restyle(textStorage, selection: nil, force: true)
    }

    func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
        if case .link(let url) = textItem.content { return UIAction { _ in UIApplication.shared.open(url) } }
        return defaultAction
    }

    // MARK: Blocks

    private func resolve(_ fix: CaretFix) {
        switch fix {
        case .move(let at):
            selectedRange = NSRange(location: at, length: 0)
        case .newLineAfter(let at), .newLineBefore(let at):
            let after = { if case .newLineAfter = fix { true } else { false } }()
            DispatchQueue.main.async { [weak self] in
                self?.apply(TextEdit(range: NSRange(location: at, length: 0), replacement: "\n", caret: after ? at + 1 : at))
            }
        case .enterGrid(let grid, let cell):
            core.gridFocus = GridFocusRequest(grid: grid, cell: cell)
            layoutCards()
        }
    }

    func leaveGrid(_ index: Int, below: Bool) {
        core.gridFocus = nil
        guard let g = GridTable.find(in: text).first(where: { $0.index == index }) else { return }
        becomeFirstResponder()
        let len = (text as NSString).length
        if below {
            if NSMaxRange(g.range) < len { selectedRange = NSRange(location: NSMaxRange(g.range) + 1, length: 0) }
            else { apply(TextEdit(range: NSRange(location: len, length: 0), replacement: "\n", caret: len + 1)) }
        } else {
            if g.range.location > 0 { selectedRange = NSRange(location: g.range.location - 1, length: 0) }
            else { apply(TextEdit(range: NSRange(location: 0, length: 0), replacement: "\n", caret: 0)) }
        }
    }

    // MARK: Checkbox taps

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g is UITapGestureRecognizer, g.view === self, g.delegate === self {
            return checkboxLine(for: g.location(in: self)) != nil
        }
        return super.gestureRecognizerShouldBegin(g)
    }

    private func checkboxLine(for p: CGPoint) -> Int? {
        let point = CGPoint(x: p.x - textContainerInset.left, y: p.y - textContainerInset.top)
        return core.checkboxLine(at: point, layout: textLayoutManager)
    }

    /// The reader changed their text size or Bold Text: restyle to match, like Notes.
    @objc private func textSizeChanged() {
        core.styler.bodySize = EditorMetrics.body
        typingAttributes = core.styler.typingAttributes
        core.restyle(textStorage, selection: editingSelection, force: true)
    }

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        guard let line = checkboxLine(for: g.location(in: self)),
              let edit = ListEditing.toggleCheckbox(in: text, lineStart: line) else { return }
        let keep = selectedRange
        apply(edit)
        selectedRange = keep
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        DispatchQueue.main.asyncAfter(deadline: .now() + ListEditing.sortDelay) { [weak self] in self?.sortChecklist(around: line) }
    }

    /// Ticked items sink below the open ones, a moment after the tick.
    private func sortChecklist(around line: Int) {
        let sel = selectedRange
        guard let edit = ListEditing.sortChecklist(in: text, around: min(line, (text as NSString).length), caret: sel.location) else { return }
        apply(TextEdit(range: edit.range, replacement: edit.replacement, caret: -1))
        selectedRange = NSRange(location: edit.caret >= 0 ? edit.caret : sel.location, length: edit.caret >= 0 ? 0 : sel.length)
    }

    // MARK: Hardware keyboard

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(indentLine)),
            UIKeyCommand(input: "\t", modifierFlags: .shift, action: #selector(outdentLine)),
        ]
    }

    @objc private func indentLine() {
        if let e = ListEditing.indent(in: text, selection: selectedRange, outdent: false) { apply(e) } else { insertText("\t") }
    }

    @objc private func outdentLine() {
        if let e = ListEditing.indent(in: text, selection: selectedRange, outdent: true) { apply(e) }
    }
}

#else
import AppKit

private struct PlatformEditor: NSViewRepresentable {
    let initialText: String
    let header: String
    let controller: EditorController
    let autofocus: Bool
    let identifier: String
    let titleLine: Bool
    let onChange: (String) -> Void

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        let view = PaneTextView(frame: .zero)
        view.core.styler.firstLineIsTitle = titleLine
        view.configure(text: initialText, header: header)
        view.setAccessibilityIdentifier(identifier)
        view.core.onChange = onChange
        view.controller = controller
        view.core.resolveAttachment = { [weak controller] id in controller?.resolveAttachment(id) }
        controller.target = view
        scroll.documentView = view
        if autofocus { DispatchQueue.main.async { view.window?.makeFirstResponder(view) } }
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? PaneTextView else { return }
        view.core.onChange = onChange
        view.setHeader(header)
        view.syncExternal(initialText)
        if controller.target !== view { controller.target = view }
    }
}

final class PaneTextView: NSTextView, NSTextViewDelegate, EditorTarget {
    let core = EditorCore()
    weak var controller: EditorController?
    private let headerLabel = NSTextField(labelWithString: "")
    private let readableWidth: CGFloat = 720

    private var cardHosts: [String: NSHostingView<AnyView>] = [:]

    func configure(text: String, header: String) {
        textLayoutManager?.delegate = core.layoutDelegate
        delegate = self
        core.onCardsChanged = { [weak self] in DispatchQueue.main.async { self?.layoutCards() } }
        drawsBackground = false
        isRichText = false
        allowsUndo = true
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticTextReplacementEnabled = false
        isAutomaticLinkDetectionEnabled = false
        registerForDraggedTypes([.fileURL])
        smartInsertDeleteEnabled = false
        usesFindBar = true
        isIncrementalSearchingEnabled = true
        linkTextAttributes = [.cursor: NSCursor.pointingHand]
        isVerticallyResizable = true
        isHorizontallyResizable = false
        autoresizingMask = [.width]
        textContainer?.widthTracksTextView = true
        textContainer?.lineFragmentPadding = 0
        typingAttributes = core.styler.typingAttributes
        string = text
        lastReported = text
        remember(text)
        core.observe(textStorage!)
        core.restyle(textStorage!, selection: nil, force: true)

        headerLabel.font = .systemFont(ofSize: 11, weight: .medium)
        headerLabel.textColor = .tertiaryLabelColor
        headerLabel.alignment = .center
        headerLabel.setAccessibilityIdentifier("editor.date")
        addSubview(headerLabel)
        setHeader(header)
        setAccessibilityIdentifier("editor")
        placeCaretFromLaunchArguments()
    }

    /// Test runs can start editing at some text: `-uitest -caret "Manteigaria"`.
    private func placeCaretFromLaunchArguments() {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-caret"), i + 1 < args.count else { return }
        let target = (string as NSString).range(of: args[i + 1])
        guard target.location != NSNotFound else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self else { return }
            self.window?.makeFirstResponder(self)
            self.setSelectedRange(NSRange(location: NSMaxRange(target), length: 0))
        }
    }

    func setHeader(_ s: String) {
        if headerLabel.stringValue != s { headerLabel.stringValue = s }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        // Like Notes on the Mac: a slim margin and text that uses the full width.
        let inset = NSSize(width: 20, height: headerLabel.stringValue.isEmpty ? 14 : 44)
        if textContainerInset != inset { textContainerInset = inset }
        headerLabel.frame = NSRect(x: 0, y: 14, width: newSize.width, height: 16)
        DispatchQueue.main.async { [weak self] in self?.layoutCards() }
    }

    /// Places live views (cards, files, links) over their reserved lines.
    func layoutCards() {
        guard let storage = textStorage else { return }
        let items = core.overlays(layout: textLayoutManager, origin: textContainerOrigin,
                                  target: self, storage: storage, controller: controller) { [weak self] in self?.editingSelection }
        let live = Set(items.map(\.key))
        for (k, host) in cardHosts where !live.contains(k) {
            host.removeFromSuperview()
            cardHosts[k] = nil
        }
        for item in items {
            let host = cardHosts[item.key] ?? {
                let h = NSHostingView(rootView: item.view)
                h.sizingOptions = []
                h.frame = item.frame
                addSubview(h)
                cardHosts[item.key] = h
                return h
            }()
            host.rootView = item.view
            if host.frame != item.frame {
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.22
                    ctx.allowsImplicitAnimation = true
                    host.animator().frame = item.frame
                }
            }
        }
    }

    func insertGrid() {
        let (edit, index) = core.newGridEdit(text: string, selection: selectedRange())
        core.pendingGridFocus = index
        apply(edit)
    }


    override var isFlipped: Bool { true }

    // MARK: EditorTarget

    var currentText: String { string }
    var currentSelection: NSRange { selectedRange() }

    func apply(_ edit: TextEdit) {
        guard shouldChangeText(in: edit.range, replacementString: edit.replacement) else { return }
        core.applyingEdit = true
        textStorage?.replaceCharacters(in: edit.range, with: edit.replacement)
        didChangeText()
        core.applyingEdit = false
        if edit.caret >= 0 { setSelectedRange(NSRange(location: min(edit.caret, (string as NSString).length), length: 0)) }
    }

    func focusEditor() { window?.makeFirstResponder(self) }

    override func paste(_ sender: Any?) {
        let pb = NSPasteboard.general
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            controller?.insertFiles(controller?.addFiles(urls) ?? [])
            return
        }
        let imageData = pb.data(forType: .png) ?? pb.data(forType: NSPasteboard.PasteboardType("public.jpeg"))
            ?? pb.data(forType: .tiff).flatMap({ NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) })
        let html = pb.data(forType: .html).flatMap { String(data: $0, encoding: .utf8) }
        if let data = imageData, RichPaste.kind(hasImage: true, text: pb.string(forType: .string), htmlIsOnlyImage: RichPaste.htmlIsOnlyImage(html)) == .image {
            if let a = controller?.addData(data, "Image \(Date.now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false))).png".replacingOccurrences(of: ":", with: "."), .png) {
                controller?.insertFiles([a])
            }
            return
        }
        if let md = RichPaste.markdownFromPasteboard() {
            let sel = selectedRange()
            apply(TextEdit(range: sel, replacement: md, caret: sel.location + (md as NSString).length))
            return
        }
        pasteAsPlainText(sender)
    }

    // MARK: Dropping files

    private func droppedFiles(_ info: NSDraggingInfo) -> [URL] {
        (info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        droppedFiles(sender).isEmpty ? super.draggingEntered(sender) : .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard !droppedFiles(sender).isEmpty else { return super.draggingUpdated(sender) }
        // Show where the file will land.
        let at = characterIndexForInsertion(at: convert(sender.draggingLocation, from: nil))
        setSelectedRange(NSRange(location: at, length: 0))
        return .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = droppedFiles(sender)
        guard !urls.isEmpty else { return super.performDragOperation(sender) }
        let at = characterIndexForInsertion(at: convert(sender.draggingLocation, from: nil))
        setSelectedRange(NSRange(location: at, length: 0))
        controller?.insertFiles(controller?.addFiles(urls) ?? [])
        return true
    }

    // MARK: Delegate

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(insertNewline(_:)):
            if let e = ListEditing.returnKey(in: string, selection: selectedRange()) { apply(e); return true }
        case #selector(deleteBackward(_:)), #selector(deleteForward(_:)):
            let forward = selector == #selector(deleteForward(_:))
            if let d = core.deleteNearBlock(string, selectedRange(), forward: forward) {
                switch d {
                case .arm: layoutCards()
                case .delete(let e): apply(e)
                }
                return true
            }
            if !forward, let e = ListEditing.backspace(in: string, selection: selectedRange()) { apply(e); return true }
        case #selector(insertTab(_:)):
            if let e = ListEditing.indent(in: string, selection: selectedRange(), outdent: false) { apply(e); return true }
        case #selector(insertBacktab(_:)):
            if let e = ListEditing.indent(in: string, selection: selectedRange(), outdent: true) { apply(e); return true }
        default: break
        }
        return false
    }

    func textDidChange(_ notification: Notification) {
        guard !hasMarkedText() else { return }
        core.restyle(textStorage!, selection: editingSelection, force: true)
        typingAttributes = core.styler.typingAttributes
        lastReported = string
        remember(string)
        core.onChange(string)
    }

    /// The last body we reported or received, to tell outside edits from our own.
    var lastReported = ""
    /// Hashes of recent texts we reported, not yet all written to the note.
    private var reported: [Int] = []

    private func remember(_ s: String) {
        reported.append(s.hashValue)
        if reported.count > 64 { reported.removeFirst(reported.count - 64) }
    }

    func syncExternal(_ new: String) {
        guard new != lastReported else { return }
        // The note still holds text we typed a moment ago (it's saved once typing
        // pauses): that's not a change from elsewhere.
        if reported.contains(new.hashValue) { return }
        reported.removeAll()
        lastReported = new
        guard new != string, !hasMarkedText(), let storage = textStorage else { return }
        let keep = selectedRange()
        storage.replaceCharacters(in: NSRange(location: 0, length: storage.length), with: new)
        setSelectedRange(NSRange(location: min(keep.location, (new as NSString).length), length: 0))
        core.restyle(storage, selection: editingSelection, force: true)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        guard !hasMarkedText(), let storage = textStorage else { return }
        if core.disarm(unless: selectedRange()) { layoutCards() }
        if window?.firstResponder === self,
           let fix = core.caretFix(string, selectedRange(), byKeyboard: inKeyDown) {
            resolve(fix)
            return
        }
        core.restyle(storage, selection: editingSelection, force: false)
    }

    private var editingSelection: NSRange? { window?.firstResponder === self ? selectedRange() : nil }

    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok, let storage = textStorage {
            controller?.isEditing = true
            core.restyle(storage, selection: selectedRange(), force: true)
        }
        return ok
    }

    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        if ok, let storage = textStorage {
            controller?.isEditing = false
            core.restyle(storage, selection: nil, force: true)
        }
        return ok
    }

    // MARK: Blocks

    /// True while a key press is being handled, so caret moves know they came from the keyboard.
    private var inKeyDown = false

    override func keyDown(with event: NSEvent) {
        inKeyDown = true
        defer { inKeyDown = false }
        super.keyDown(with: event)
    }

    private func resolve(_ fix: CaretFix) {
        switch fix {
        case .move(let at):
            setSelectedRange(NSRange(location: at, length: 0))
        case .newLineAfter(let at), .newLineBefore(let at):
            let after = { if case .newLineAfter = fix { true } else { false } }()
            // Not while AppKit is still delivering this selection change.
            DispatchQueue.main.async { [weak self] in
                self?.apply(TextEdit(range: NSRange(location: at, length: 0), replacement: "\n", caret: after ? at + 1 : at))
            }
        case .enterGrid(let grid, let cell):
            core.gridFocus = GridFocusRequest(grid: grid, cell: cell)
            layoutCards()
        }
    }

    /// The keyboard leaves a table: the caret goes to the line above or below it.
    func leaveGrid(_ index: Int, below: Bool) {
        core.gridFocus = nil
        guard let g = GridTable.find(in: string).first(where: { $0.index == index }) else { return }
        window?.makeFirstResponder(self)
        let len = (string as NSString).length
        if below {
            if NSMaxRange(g.range) < len { setSelectedRange(NSRange(location: NSMaxRange(g.range) + 1, length: 0)) }
            else { apply(TextEdit(range: NSRange(location: len, length: 0), replacement: "\n", caret: len + 1)) }
        } else {
            if g.range.location > 0 { setSelectedRange(NSRange(location: g.range.location - 1, length: 0)) }
            else { apply(TextEdit(range: NSRange(location: 0, length: 0), replacement: "\n", caret: 0)) }
        }
    }

    // MARK: Checkbox clicks

    /// Over a checkbox the pointer is an arrow, not the text I-beam, like Notes.
    override func mouseMoved(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let point = CGPoint(x: p.x - textContainerOrigin.x, y: p.y - textContainerOrigin.y)
        if core.checkboxLine(at: point, layout: textLayoutManager) != nil {
            NSCursor.arrow.set()
            return
        }
        super.mouseMoved(with: event)
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let point = CGPoint(x: p.x - textContainerOrigin.x, y: p.y - textContainerOrigin.y)
        if let line = core.checkboxLine(at: point, layout: textLayoutManager),
           let edit = ListEditing.toggleCheckbox(in: string, lineStart: line) {
            let keep = selectedRange()
            apply(edit)
            setSelectedRange(keep)
            DispatchQueue.main.asyncAfter(deadline: .now() + ListEditing.sortDelay) { [weak self] in self?.sortChecklist(around: line) }
            return
        }
        super.mouseDown(with: event)
    }

    /// Ticked items sink below the open ones, a moment after the tick.
    private func sortChecklist(around line: Int) {
        let sel = selectedRange()
        guard let edit = ListEditing.sortChecklist(in: string, around: min(line, (string as NSString).length), caret: sel.location) else { return }
        apply(TextEdit(range: edit.range, replacement: edit.replacement, caret: -1))
        setSelectedRange(NSRange(location: edit.caret >= 0 ? edit.caret : sel.location, length: edit.caret >= 0 ? 0 : sel.length))
    }
}
#endif
