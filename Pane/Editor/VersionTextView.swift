import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

extension NSAttributedString.Key {
    /// On a whole line: it differs from the note as it is now (version history). Drawn with the
    /// same amber band as an AI's change (DecoratedLayoutFragment).
    static let paneChanged = NSAttributedString.Key("pane.changed")
}

/// A version of a note, read-only, styled as the editor styles it (checklists, headings,
/// lists, quotes), with `changed` lines tinted amber.
struct VersionTextView {
    let text: String
    let changed: [NSRange]

    /// The text styled with nothing being edited, so all markup stays hidden.
    @MainActor static func style(_ storage: NSTextStorage, changed: [NSRange]) {
        let styler = MarkdownStyler()
        styler.apply(to: storage, active: NSRange(location: NSNotFound, length: 0))
        let length = storage.length
        storage.beginEditing()
        for r in changed where NSMaxRange(r) <= length {
            // The whole paragraph, so its layout fragment sees it at its first character.
            let line = (storage.string as NSString).paragraphRange(for: r)
            storage.addAttribute(.paneChanged, value: true, range: line)
        }
        storage.endEditing()
    }

    final class Coordinator {
        let layoutDelegate = DecoratingLayoutDelegate()
        var shown: (String, [NSRange])?
    }
}

#if os(macOS)
extension VersionTextView: NSViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        let view = NSTextView(usingTextLayoutManager: true)
        view.textLayoutManager?.delegate = context.coordinator.layoutDelegate
        view.isEditable = false
        view.isSelectable = true
        view.isRichText = false
        view.drawsBackground = false
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainer?.widthTracksTextView = true
        view.textContainer?.lineFragmentPadding = 0
        view.textContainerInset = NSSize(width: 20, height: 16)
        scroll.documentView = view
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? NSTextView, let storage = view.textStorage else { return }
        if let shown = context.coordinator.shown, shown.0 == text, shown.1 == changed { return }
        context.coordinator.shown = (text, changed)
        view.string = text
        Self.style(storage, changed: changed)
        view.scroll(.zero)
    }
}
#else
extension VersionTextView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView(usingTextLayoutManager: true)
        view.textLayoutManager?.delegate = context.coordinator.layoutDelegate
        view.isEditable = false
        view.isSelectable = true
        view.backgroundColor = .clear
        view.textContainer.lineFragmentPadding = 0
        view.textContainerInset = UIEdgeInsets(top: 12, left: 20, bottom: 24, right: 20)
        view.alwaysBounceVertical = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if let shown = context.coordinator.shown, shown.0 == text, shown.1 == changed { return }
        context.coordinator.shown = (text, changed)
        view.text = text
        Self.style(view.textStorage, changed: changed)
        view.setContentOffset(.zero, animated: false)
    }
}
#endif
