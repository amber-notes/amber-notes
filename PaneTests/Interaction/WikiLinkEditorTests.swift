#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// Wiki links in the real Mac editor: shown as links with their syntax out of sight, fainter
/// when the note doesn't exist yet, followed on click, and offered as you type `[[`.
@MainActor @Suite(.serialized) struct WikiLinkEditorTests {
    static let kitchen = UUID()

    static func scope(_ generation: Int = 1, titles: [String] = ["Kitchen remodel", "Kitchen tiles", "Reading list"]) -> WikiScope {
        let entries = titles.enumerated().map { i, t in
            WikiIndex.Entry(id: i == 0 ? kitchen : UUID(), title: t, folders: ["Vault"], updated: Date(timeIntervalSince1970: Double(1_000 - i)))
        }
        return WikiScope(index: WikiIndex(entries), from: ["Vault"], generation: generation)
    }

    static let text = "Welcome\nSee [[Projects/Kitchen remodel|the kitchen]], [[Reading list]] and [[Someday]].\nLast line"

    func range(_ s: String, in h: EditorHarness) -> NSRange { (h.text as NSString).range(of: s) }

    func color(_ h: EditorHarness, at s: String) -> String {
        IncrementalStyleTests.resolve(h.view.textStorage!.attribute(.foregroundColor, at: range(s, in: h).location, effectiveRange: nil))
    }

    func hidden(_ h: EditorHarness, at s: String) -> Bool {
        let r = range(s, in: h)
        return (0..<r.length).allSatisfy { ((h.view.textStorage!.attribute(.font, at: r.location + $0, effectiveRange: nil) as? NSFont)?.pointSize ?? 99) < 1 }
    }

    func hiddenAt(_ h: EditorHarness, _ s: String, offset: Int, length: Int) -> Bool {
        let r = range(s, in: h)
        return (0..<length).allSatisfy { ((h.view.textStorage!.attribute(.font, at: r.location + offset + $0, effectiveRange: nil) as? NSFont)?.pointSize ?? 99) < 1 }
    }

    @Test func linksShowAsLinksWithTheirSyntaxHidden() async {
        let h = await EditorHarness(Self.text, focus: false)
        defer { h.close() }
        h.view.setWiki(Self.scope())
        await h.settle()
        let storage = h.view.textStorage!
        #expect(hidden(h, at: "[[Projects/Kitchen remodel|"), "brackets, folders and the target behind an alias hide")
        #expect(hiddenAt(h, "kitchen]]", offset: 7, length: 2) && hiddenAt(h, "[[Reading", offset: 0, length: 2), "closing and opening brackets hide")
        #expect(!hiddenAt(h, "Reading list", offset: 0, length: 12))
        let shown = range("the kitchen", in: h)
        #expect(LinkPolicy.action(for: storage.attribute(.link, at: shown.location, effectiveRange: nil) as Any) == .wiki("Projects/Kitchen remodel"))
        #expect(color(h, at: "the kitchen") == IncrementalStyleTests.resolve(PColor.paneAccent))
        #expect(color(h, at: "Reading list") == IncrementalStyleTests.resolve(PColor.paneAccent))
        #expect(color(h, at: "Someday") == IncrementalStyleTests.resolve(PColor.paneAccentFaded), "a note that doesn't exist yet is fainter")

        // The note gets made: the link fills in without reopening.
        h.view.setWiki(Self.scope(2, titles: ["Kitchen remodel", "Reading list", "Someday"]))
        await h.settle()
        #expect(color(h, at: "Someday") == IncrementalStyleTests.resolve(PColor.paneAccent))
        await h.snapshot("wiki-links-light")
    }

    @Test func theCaretLineShowsTheSyntaxDimmed() async {
        let h = await EditorHarness(Self.text)
        defer { h.close() }
        h.view.setWiki(Self.scope())
        await h.caret(after: "Someday")
        #expect(!hidden(h, at: "[[Projects/Kitchen remodel|"))
        #expect(color(h, at: "[[Projects") == IncrementalStyleTests.resolve(PColor.paneTertiary))
        #expect(color(h, at: "the kitchen") == IncrementalStyleTests.resolve(PColor.paneAccent))
    }

    @Test func clickingALinkFollowsIt() async {
        let h = await EditorHarness(Self.text, focus: false)
        defer { h.close() }
        h.view.setWiki(Self.scope())
        await h.settle()
        var followed: [String] = []
        h.controller.openWiki = { followed.append($0) }
        for word in ["the kitchen", "Someday"] {
            let r = range(word, in: h)
            let screen = h.view.firstRect(forCharacterRange: NSRange(location: r.location + 2, length: 1), actualRange: nil)
            let p = h.view.convert(h.window.convertFromScreen(screen), from: nil)
            await h.click(CGPoint(x: p.midX, y: p.midY))
        }
        #expect(followed == ["Projects/Kitchen remodel", "Someday"])
    }

    @Test func typingTwoBracketsOffersTitles() async {
        let h = await EditorHarness("Plan\n")
        defer { h.close() }
        h.controller.suggestTitles = { typed in
            ["Kitchen remodel", "Kitchen tiles", "Reading list"].filter { typed.isEmpty || $0.lowercased().contains(typed.lowercased()) }
        }
        await h.select((h.text as NSString).length)
        await h.type("Call about [[kit")
        #expect(h.controller.wikiSuggestions == ["Kitchen remodel", "Kitchen tiles"])
        #expect(h.view.subviews.contains { $0 is NSHostingView<WikiSuggestionList> }, "the list shows under the caret")
        await h.snapshot("wiki-suggestions-light")
        await h.press(EditorHarness.down)
        #expect(h.controller.wikiChoice == 1)
        await h.press(EditorHarness.returnKey)
        #expect(h.text == "Plan\nCall about [[Kitchen tiles]]")
        #expect(h.selection == NSRange(location: (h.text as NSString).length, length: 0))
        #expect(h.controller.wikiSuggestions.isEmpty)
        #expect(!h.view.subviews.contains { $0 is NSHostingView<WikiSuggestionList> })

        // Escape puts the list away for this link; Return then goes back to making lines.
        await h.type(" and [[Rea")
        #expect(h.controller.wikiSuggestions == ["Reading list"])
        await h.command(#selector(NSResponder.cancelOperation(_:)))
        #expect(h.controller.wikiSuggestions.isEmpty)
        await h.type("d")
        #expect(h.controller.wikiSuggestions.isEmpty, "not offered again while typing the same link")
    }

    @Test func darkMode() async {
        let h = await EditorHarness(Self.text, dark: true, focus: false)
        defer { h.close() }
        h.view.setWiki(Self.scope())
        await h.snapshot("wiki-links-dark")
    }
}

@Suite struct WikiTypingQueryTests {
    @Test func theTypedPartOfAnUnfinishedLink() {
        func q(_ s: String) -> String? {
            let caret = s.range(of: "^").map { s.utf16.distance(from: s.utf16.startIndex, to: $0.lowerBound) }!
            let text = s.replacingOccurrences(of: "^", with: "")
            return WikiLinks.typingQuery(in: text, caret: caret).map { (text as NSString).substring(with: $0) }
        }
        #expect(q("See [[Kit^") == "Kit")
        #expect(q("See [[^") == "")
        #expect(q("See [[Kit^]] later") == "Kit", "the closing brackets typed already")
        #expect(q("See [[Kitchen]] and ^") == nil)
        #expect(q("See [[Kitchen|alias^") == nil, "the alias isn't a title")
        #expect(q("See [[Kitchen#Bud^") == nil)
        #expect(q("[[Kit\nnext line^") == nil)
        #expect(q("^") == nil)
    }
}
#endif
