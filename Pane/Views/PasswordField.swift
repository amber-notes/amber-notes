import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Whether a password is shown as text, and which of a PasswordField's two fields is in use.
struct PasswordReveal: Equatable {
    /// The two fields: dots, or the text itself.
    enum Field: Hashable { case dots, plain }

    private(set) var isRevealed = false

    var visible: Field { isRevealed ? .plain : .dots }
    var symbol: String { isRevealed ? "eye.slash" : "eye" }

    /// What the eye button does next, for VoiceOver: "Show password", "Hide password".
    func label(_ noun: String) -> String { "\(isRevealed ? "Hide" : "Show") \(noun)" }

    mutating func toggle() { isRevealed.toggle() }

    /// Back to dots. False when it already was.
    @discardableResult mutating func hide() -> Bool {
        defer { isRevealed = false }
        return isRevealed
    }

    /// A field can be typed in when it's the one showing, or while it still holds the cursor
    /// just after the eye was pressed, so the cursor is handed over rather than dropped.
    func isEnabled(_ field: Field, focused: Field?) -> Bool { field == visible || field == focused }

    /// Where the cursor goes in the other field: where it was, or after the last character.
    static func caret(_ range: NSRange?, length: Int) -> NSRange {
        guard let range, range.location >= 0, range.length >= 0, range.location + range.length <= length else {
            return NSRange(location: length, length: 0)
        }
        return range
    }
}

/// A password field with an eye button at its trailing edge that shows what was typed.
///
/// Both fields are always there, one on top of the other, and the eye moves the cursor between
/// them. Swapping a SecureField for a TextField instead removes the field that has the cursor:
/// the cursor is lost, and on iPhone the keyboard drops. It starts as dots every time, and goes
/// back to dots when the screen closes or the app is left. The text lives only in the caller's
/// binding.
struct PasswordField: View {
    enum Kind {
        /// The password of something that exists (autofill offers the saved one).
        case current
        /// A password being chosen (autofill offers a strong one, and saves it).
        case new
        /// Another secret typed by hand, like an API key. No autofill.
        case key

        var noun: String { self == .key ? "key" : "password" }
    }

    let title: String
    @Binding var text: String
    var prompt: Text?
    var kind = Kind.current
    /// The accessibility identifier of the field. The eye button is `id` + ".reveal".
    let id: String
    /// Whether the cursor is in the field; set it to true to put it there.
    var focused: Binding<Bool>?

    @State private var reveal: PasswordReveal
    /// Where the cursor goes once the other field has it.
    @State private var caret: NSRange?
    /// The cursor follows the next change of `reveal` to the field then showing.
    @State private var cursorFollows = false
    /// What `focused` was last told, to tell a caller's request from our own report.
    @State private var reported = false
    @FocusState private var focus: PasswordReveal.Field?

    /// `reveal` is for pictures of the shown state; everything else starts as dots.
    init(_ title: String, text: Binding<String>, prompt: Text? = nil, kind: Kind = .current, id: String,
         focused: Binding<Bool>? = nil, reveal: PasswordReveal = PasswordReveal()) {
        self.title = title
        self._text = text
        self.prompt = prompt
        self.kind = kind
        self.id = id
        self.focused = focused
        self._reveal = State(initialValue: reveal)
    }

    #if os(macOS)
    private static let leftApp = NSApplication.didResignActiveNotification
    private static let backInApp = NSApplication.didBecomeActiveNotification
    private static let eyeHeight: CGFloat = 22
    #else
    private static let leftApp = UIApplication.willResignActiveNotification
    private static let backInApp = UIApplication.didBecomeActiveNotification
    private static let eyeHeight: CGFloat = 28
    #endif

    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                input(.dots) {
                    SecureField(title, text: $text, prompt: prompt)
                        .textContentType(contentType)
                }
                input(.plain) {
                    TextField(title, text: $text, prompt: prompt)
                        // Only while it shows: a second field of the same kind confuses autofill.
                        .textContentType(reveal.isRevealed ? contentType : nil)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                }
            }
            Button(action: toggle) {
                Image(systemName: reveal.symbol)
                    .frame(width: 28, height: Self.eyeHeight)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel(reveal.label(kind.noun))
            .accessibilityIdentifier("\(id).reveal")
        }
        .onChange(of: reveal.isRevealed) {
            guard cursorFollows else { return }
            cursorFollows = false
            // A turn later: a field asked to take the cursor in the update that enables it doesn't.
            Task { @MainActor in focus = reveal.visible }
        }
        .onChange(of: focus) { _, now in
            report(now != nil)
            guard now == reveal.visible, let range = caret else { return }
            caret = nil
            // After the field has taken the cursor (the Mac selects everything when it does).
            Task { @MainActor in if focus == reveal.visible { FieldCaret.place(range) } }
        }
        .onChange(of: focused?.wrappedValue) { _, wanted in
            guard let wanted, wanted != reported else { return }
            reported = wanted
            if wanted { Task { @MainActor in focus = reveal.visible } } else { focus = nil }
        }
        .onAppear {
            guard focused?.wrappedValue == true else { return }
            reported = true
            Task { @MainActor in focus = reveal.visible }
        }
        .onDisappear {
            reveal.hide()
            report(false)
        }
        .onReceive(NotificationCenter.default.publisher(for: Self.leftApp)) { _ in hide() }
        .onReceive(NotificationCenter.default.publisher(for: Self.backInApp)) { _ in
            // Hidden while the app was away, when the cursor couldn't be moved.
            if let focus, focus != reveal.visible { self.focus = reveal.visible }
        }
    }

    private func input(_ field: PasswordReveal.Field, @ViewBuilder _ content: () -> some View) -> some View {
        let showing = reveal.visible == field
        return content()
            .focused($focus, equals: field)
            .disabled(!reveal.isEnabled(field, focused: focus))
            .opacity(showing ? 1 : 0)
            .allowsHitTesting(showing)
            .accessibilityHidden(!showing)
            .accessibilityIdentifier(id)
    }

    #if os(macOS)
    private var contentType: NSTextContentType? {
        switch kind {
        case .current: .password
        case .new: .newPassword
        case .key: nil
        }
    }
    #else
    private var contentType: UITextContentType? {
        switch kind {
        case .current: .password
        case .new: .newPassword
        case .key: nil
        }
    }
    #endif

    /// The eye: shows or hides the text, and the cursor ends up in the field, where it was.
    private func toggle() {
        follow()
        reveal.toggle()
    }

    /// Back to dots when the app is left. The cursor stays in the field if it was there.
    private func hide() {
        guard reveal.isRevealed else { return }
        if focus != nil { follow() }
        reveal.hide()
    }

    private func follow() {
        caret = PasswordReveal.caret(focus == nil ? nil : FieldCaret.current(), length: (text as NSString).length)
        cursorFollows = true
    }

    private func report(_ isFocused: Bool) {
        guard let focused, reported != isFocused else { return }
        reported = isFocused
        focused.wrappedValue = isFocused
    }
}

/// The cursor of the text field being typed in: read and placed, never its text.
@MainActor enum FieldCaret {
    #if os(macOS)
    private static var editor: NSTextView? {
        guard let editor = NSApp.keyWindow?.firstResponder as? NSTextView, editor.isFieldEditor else { return nil }
        return editor
    }

    static func current() -> NSRange? { editor?.selectedRange() }

    static func place(_ range: NSRange) {
        guard let editor, NSMaxRange(range) <= (editor.textStorage?.length ?? 0) else { return }
        editor.setSelectedRange(range)
    }
    #else
    fileprivate static weak var found: UIResponder?

    /// The first responder, which answers an action sent to nobody in particular.
    private static var field: UITextField? {
        found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.paneFieldCaretFound), to: nil, from: nil, for: nil)
        return found as? UITextField
    }

    static func current() -> NSRange? {
        guard let field, let selected = field.selectedTextRange else { return nil }
        return NSRange(location: field.offset(from: field.beginningOfDocument, to: selected.start),
                       length: field.offset(from: selected.start, to: selected.end))
    }

    static func place(_ range: NSRange) {
        guard let field,
              let start = field.position(from: field.beginningOfDocument, offset: range.location),
              let end = field.position(from: start, offset: range.length) else { return }
        field.selectedTextRange = field.textRange(from: start, to: end)
    }
    #endif
}

#if os(iOS)
private extension UIResponder {
    @objc func paneFieldCaretFound() { FieldCaret.found = self }
}
#endif
