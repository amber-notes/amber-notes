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
    /// Cards currently shown as views, and which of them are open.
    private(set) var cards: [CardBlock] = []
    private var expanded: Set<String> = []
    /// Called after a restyle, so the view can place card views.
    var onCardsChanged: () -> Void = {}

    init() {
        styler.cardHeight = { [weak self] card in CardMetrics.height(card, expanded: self?.isExpanded(card) ?? false) }
    }

    private func key(_ c: CardBlock) -> String { "\(c.index)|\(c.title)" }
    func isExpanded(_ c: CardBlock) -> Bool { expanded.contains(key(c)) }

    /// Where each card view goes, in text-view coordinates.
    func cardFrames(layout: NSTextLayoutManager?, origin: CGPoint) -> [(CardBlock, CGRect)] {
        guard let tlm = layout, let tcm = tlm.textContentManager, let container = tlm.textContainer else { return [] }
        let width = container.size.width - container.lineFragmentPadding * 2
        var out: [(CardBlock, CGRect)] = []
        for card in cards {
            guard let loc = tcm.location(tcm.documentRange.location, offsetBy: card.range.location) else { continue }
            tlm.ensureLayout(for: NSTextRange(location: loc))
            guard let frag = tlm.textLayoutFragment(for: loc), let line = frag.textLineFragments.first else { continue }
            let y = frag.layoutFragmentFrame.minY + line.typographicBounds.minY + origin.y
            out.append((card, CGRect(x: origin.x + container.lineFragmentPadding, y: y, width: width, height: styler.cardHeight(card))))
        }
        return out
    }

    func actions(for card: CardBlock, in target: EditorTarget, storage: NSTextStorage, controller: EditorController?, selection: @escaping () -> NSRange?) -> CardActions {
        CardActions(
            toggleExpanded: { [weak self] in
                guard let self else { return }
                let k = self.key(card)
                if self.expanded.contains(k) { self.expanded.remove(k) } else { self.expanded.insert(k) }
                self.restyle(storage, selection: selection(), force: true)
            },
            edit: { controller?.cardRequest = CardEditRequest(index: card.index, title: card.title, content: card.content) },
            toggleCheckbox: { offset in
                let ns = target.currentText as NSString
                var start = card.contentRange.location
                for _ in 0..<offset {
                    let r = ns.lineRange(for: NSRange(location: start, length: 0))
                    start = NSMaxRange(r)
                }
                if let e = ListEditing.toggleCheckbox(in: target.currentText, lineStart: start) {
                    target.apply(TextEdit(range: e.range, replacement: e.replacement, caret: -1))
                }
            },
            unwrap: {
                target.apply(TextEdit(range: card.range, replacement: card.content, caret: -1))
            },
            delete: {
                let ns = target.currentText as NSString
                var r = card.range
                if NSMaxRange(r) < ns.length { r.length += 1 }
                target.apply(TextEdit(range: r, replacement: "", caret: -1))
            }
        )
    }

    /// Replaces card `index` (or inserts a new one after the caret's line).
    func cardEdit(index: Int?, markdown: String, text: String, selection: NSRange) -> TextEdit {
        let ns = text as NSString
        if let index, let card = CardBlocks.find(in: text).first(where: { $0.index == index }) {
            return TextEdit(range: card.range, replacement: markdown, caret: -1)
        }
        let line = ns.lineRange(for: NSRange(location: min(selection.location, ns.length), length: 0))
        let lineText = ns.substring(with: line).trimmingCharacters(in: .whitespacesAndNewlines)
        if lineText.isEmpty {
            let body = markdown + "\n"
            return TextEdit(range: NSRange(location: line.location, length: line.length), replacement: body + (NSMaxRange(line) < ns.length ? "\n" : ""), caret: line.location + (body as NSString).length)
        }
        let insertAt = NSMaxRange(line)
        let lead = ns.substring(with: line).hasSuffix("\n") ? "\n" : "\n\n"
        let body = lead + markdown + "\n"
        return TextEdit(range: NSRange(location: insertAt, length: 0), replacement: body, caret: insertAt + (body as NSString).length)
    }

    /// Restyles if the text changed or the caret moved to another line.
    /// `selection` is nil when you're not editing: then all syntax stays hidden.
    func restyle(_ storage: NSTextStorage, selection: NSRange?, force: Bool) {
        let ns = storage.string as NSString
        var line = NSRange(location: NSNotFound, length: 0)
        if let selection, ns.length > 0 {
            line = ns.lineRange(for: NSRange(location: min(selection.location, ns.length), length: min(selection.length, ns.length - min(selection.location, ns.length))))
        }
        if !force, line == lastActiveLine { return }
        lastActiveLine = line
        cards = styler.apply(to: storage, active: selection ?? NSRange(location: NSNotFound, length: 0))
        onCardsChanged()
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

final class PaneTextView: UITextView, UITextViewDelegate, EditorTarget, UIGestureRecognizerDelegate {
    let core = EditorCore()
    weak var controller: EditorController?
    private let headerLabel = UILabel()
    private let readableWidth: CGFloat = 680

    private var cardHosts: [Int: UIHostingController<CardView>] = [:]

    func configure(text: String, header: String) {
        textLayoutManager?.delegate = core.layoutDelegate
        delegate = self
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

    /// Places a live card view over each collapsed `<details>` block.
    private func layoutCards() {
        let frames = core.cardFrames(layout: textLayoutManager, origin: CGPoint(x: textContainerInset.left, y: textContainerInset.top))
        let live = Set(frames.map { $0.0.index })
        for (i, host) in cardHosts where !live.contains(i) {
            host.view.removeFromSuperview()
            cardHosts[i] = nil
        }
        for (card, frame) in frames {
            let view = CardView(card: card, expanded: core.isExpanded(card),
                                actions: core.actions(for: card, in: self, storage: textStorage, controller: controller) { [weak self] in self?.editingSelection })
            let host = cardHosts[card.index] ?? {
                let h = UIHostingController(rootView: view)
                h.view.backgroundColor = .clear
                h.sizingOptions = []
                addSubview(h.view)
                cardHosts[card.index] = h
                return h
            }()
            host.rootView = view
            if host.view.frame != frame {
                UIView.animate(withDuration: 0.22, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) { host.view.frame = frame }
            }
        }
    }

    func saveCard(index: Int?, markdown: String) {
        apply(core.cardEdit(index: index, markdown: markdown, text: text, selection: selectedRange))
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
        if let md = RichPaste.markdownFromPasteboard() {
            let sel = selectedRange
            apply(TextEdit(range: sel, replacement: md, caret: sel.location + (md as NSString).length))
            return
        }
        super.paste(sender)
    }

    // MARK: Delegate

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        guard !core.applyingEdit else { return true }
        if text == "\n", let edit = ListEditing.returnKey(in: self.text, selection: range) {
            apply(edit); return false
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
        core.onChange(text)
    }

    /// The last body we reported or received, to tell outside edits from our own.
    var lastReported = ""

    func syncExternal(_ new: String) {
        guard new != lastReported else { return }
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

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        guard let line = checkboxLine(for: g.location(in: self)),
              let edit = ListEditing.toggleCheckbox(in: text, lineStart: line) else { return }
        let keep = selectedRange
        apply(edit)
        selectedRange = keep
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
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

    private var cardHosts: [Int: NSHostingView<CardView>] = [:]

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
        core.restyle(textStorage!, selection: nil, force: true)

        headerLabel.font = .systemFont(ofSize: 11, weight: .medium)
        headerLabel.textColor = .tertiaryLabelColor
        headerLabel.alignment = .center
        headerLabel.setAccessibilityIdentifier("editor.date")
        addSubview(headerLabel)
        setHeader(header)
        setAccessibilityIdentifier("editor")
    }

    func setHeader(_ s: String) {
        if headerLabel.stringValue != s { headerLabel.stringValue = s }
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        let side = max(28, (newSize.width - readableWidth) / 2)
        let inset = NSSize(width: side, height: headerLabel.stringValue.isEmpty ? 14 : 44)
        if textContainerInset != inset { textContainerInset = inset }
        headerLabel.frame = NSRect(x: 0, y: 14, width: newSize.width, height: 16)
        DispatchQueue.main.async { [weak self] in self?.layoutCards() }
    }

    /// Places a live card view over each collapsed `<details>` block.
    func layoutCards() {
        let frames = core.cardFrames(layout: textLayoutManager, origin: textContainerOrigin)
        let live = Set(frames.map { $0.0.index })
        for (i, host) in cardHosts where !live.contains(i) {
            host.removeFromSuperview()
            cardHosts[i] = nil
        }
        for (card, frame) in frames {
            let view = CardView(card: card, expanded: core.isExpanded(card),
                                actions: core.actions(for: card, in: self, storage: textStorage!, controller: controller) { [weak self] in self?.editingSelection })
            let host = cardHosts[card.index] ?? {
                let h = NSHostingView(rootView: view)
                h.sizingOptions = []
                addSubview(h)
                cardHosts[card.index] = h
                return h
            }()
            host.rootView = view
            if host.frame != frame {
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.22
                    ctx.allowsImplicitAnimation = true
                    host.animator().frame = frame
                }
            }
        }
    }

    func saveCard(index: Int?, markdown: String) {
        apply(core.cardEdit(index: index, markdown: markdown, text: string, selection: selectedRange()))
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
        if let md = RichPaste.markdownFromPasteboard() {
            let sel = selectedRange()
            apply(TextEdit(range: sel, replacement: md, caret: sel.location + (md as NSString).length))
            return
        }
        pasteAsPlainText(sender)
    }

    // MARK: Delegate

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case #selector(insertNewline(_:)):
            if let e = ListEditing.returnKey(in: string, selection: selectedRange()) { apply(e); return true }
        case #selector(deleteBackward(_:)):
            if let e = ListEditing.backspace(in: string, selection: selectedRange()) { apply(e); return true }
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
        core.onChange(string)
    }

    /// The last body we reported or received, to tell outside edits from our own.
    var lastReported = ""

    func syncExternal(_ new: String) {
        guard new != lastReported else { return }
        lastReported = new
        guard new != string, !hasMarkedText(), let storage = textStorage else { return }
        let keep = selectedRange()
        storage.replaceCharacters(in: NSRange(location: 0, length: storage.length), with: new)
        setSelectedRange(NSRange(location: min(keep.location, (new as NSString).length), length: 0))
        core.restyle(storage, selection: editingSelection, force: true)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        guard !hasMarkedText(), let storage = textStorage else { return }
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

    // MARK: Checkbox clicks

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let point = CGPoint(x: p.x - textContainerOrigin.x, y: p.y - textContainerOrigin.y)
        if let line = core.checkboxLine(at: point, layout: textLayoutManager),
           let edit = ListEditing.toggleCheckbox(in: string, lineStart: line) {
            let keep = selectedRange()
            apply(edit)
            setSelectedRange(keep)
            return
        }
        super.mouseDown(with: event)
    }
}
#endif
