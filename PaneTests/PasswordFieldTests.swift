import Foundation
import SwiftUI
import Testing
@testable import Pane

/// The eye button of a password field: what it shows, and where the cursor goes.
@Suite struct PasswordRevealTests {
    @Test func itStartsAsDots() {
        let reveal = PasswordReveal()
        #expect(!reveal.isRevealed)
        #expect(reveal.visible == .dots)
        #expect(reveal.symbol == "eye")
        #expect(reveal.label("password") == "Show password")
    }

    @Test func theEyeShowsAndHides() {
        var reveal = PasswordReveal()
        reveal.toggle()
        #expect(reveal.isRevealed)
        #expect(reveal.visible == .plain)
        #expect(reveal.symbol == "eye.slash")
        #expect(reveal.label("password") == "Hide password")
        #expect(reveal.label("key") == "Hide key")
        reveal.toggle()
        #expect(reveal == PasswordReveal())
    }

    @Test func leavingGoesBackToDots() {
        var reveal = PasswordReveal()
        #expect(!reveal.hide(), "nothing to hide")
        reveal.toggle()
        #expect(reveal.hide())
        #expect(reveal == PasswordReveal())
    }

    /// Only the field that shows can be typed in or tabbed to. The other one stays usable just
    /// while it still holds the cursor, so the cursor is handed over and never dropped.
    @Test func onlyTheFieldThatShowsTakesTheCursor() {
        var reveal = PasswordReveal()
        #expect(reveal.isEnabled(.dots, focused: nil))
        #expect(!reveal.isEnabled(.plain, focused: nil))
        #expect(!reveal.isEnabled(.plain, focused: .dots))
        reveal.toggle()
        #expect(reveal.isEnabled(.plain, focused: .dots))
        #expect(reveal.isEnabled(.dots, focused: .dots), "it has the cursor until the other field takes it")
        #expect(!reveal.isEnabled(.dots, focused: .plain))
        #expect(!reveal.isEnabled(.dots, focused: nil))
    }

    @Test func theCursorStaysWhereItWas() {
        #expect(PasswordReveal.caret(NSRange(location: 3, length: 0), length: 8) == NSRange(location: 3, length: 0))
        #expect(PasswordReveal.caret(NSRange(location: 2, length: 4), length: 8) == NSRange(location: 2, length: 4), "a selection too")
        #expect(PasswordReveal.caret(NSRange(location: 8, length: 0), length: 8) == NSRange(location: 8, length: 0))
    }

    @Test func aCursorThatCantBeReadGoesAfterTheText() {
        #expect(PasswordReveal.caret(nil, length: 8) == NSRange(location: 8, length: 0))
        #expect(PasswordReveal.caret(NSRange(location: 9, length: 0), length: 8) == NSRange(location: 8, length: 0))
        #expect(PasswordReveal.caret(NSRange(location: 6, length: 5), length: 8) == NSRange(location: 8, length: 0))
        #expect(PasswordReveal.caret(NSRange(location: NSNotFound, length: 0), length: 0) == NSRange(location: 0, length: 0))
    }

    @Test func aKeyIsCalledAKey() {
        #expect(PasswordField.Kind.current.noun == "password")
        #expect(PasswordField.Kind.new.noun == "password")
        #expect(PasswordField.Kind.key.noun == "key")
    }
}

#if os(macOS)
import AppKit

/// The view itself, drawn off screen: both fields are there (so the eye never changes the
/// layout), and only the one that shows can be typed in.
@MainActor @Suite struct PasswordFieldViewTests {
    private func fields(revealed: Bool) async -> (secure: [NSTextField], plain: [NSTextField], size: CGSize) {
        var reveal = PasswordReveal()
        if revealed { reveal.toggle() }
        let view = PasswordField("Password", text: .constant("correct horse"), id: "test.password", reveal: reveal).frame(width: 240)
        let host = NSHostingView(rootView: view)
        // Off screen, borderless and never ordered front: nothing appears on a developer's Mac.
        let window = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 240, height: 60),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        defer { window.close() }
        try? await Task.sleep(for: .seconds(0.3))
        host.layoutSubtreeIfNeeded()
        var all: [NSTextField] = []
        func walk(_ v: NSView) {
            if let f = v as? NSTextField, f.isEditable { all.append(f) }
            v.subviews.forEach(walk)
        }
        walk(host)
        return (all.filter { $0 is NSSecureTextField }, all.filter { !($0 is NSSecureTextField) }, host.fittingSize)
    }

    @Test func hiddenOnlyTheDotsCanBeTypedIn() async throws {
        let (secure, plain, _) = await fields(revealed: false)
        #expect(secure.count == 1)
        #expect(plain.count == 1)
        #expect(secure.first?.isEnabled == true)
        #expect(plain.first?.isEnabled == false)
    }

    @Test func shownOnlyTheTextCanBeTypedIn() async throws {
        let (secure, plain, _) = await fields(revealed: true)
        #expect(secure.first?.isEnabled == false)
        #expect(plain.first?.isEnabled == true)
    }

    @Test func theEyeDoesntChangeTheSize() async throws {
        let hidden = await fields(revealed: false).size
        let shown = await fields(revealed: true).size
        #expect(hidden == shown)
        #expect(hidden.height > 0)
    }
}
#endif
