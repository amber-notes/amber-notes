import Foundation
import Testing
@testable import Pane

@Suite struct CardBlocksTests {
    @Test func findsMultilineCard() {
        let text = "Title\n\n<details>\n<summary>Recipe</summary>\n\n- flour\n- water\n\n</details>\nafter"
        let cards = CardBlocks.find(in: text)
        #expect(cards.count == 1)
        #expect(cards[0].title == "Recipe")
        #expect(cards[0].content == "- flour\n- water")
        #expect((text as NSString).substring(with: cards[0].range).hasSuffix("</details>"))
    }

    @Test func findsOneLineSummaryAndEscapes() {
        let text = "<details><summary>A &amp; B</summary>\nhidden\n</details>"
        let cards = CardBlocks.find(in: text)
        #expect(cards.first?.title == "A & B")
        #expect(cards.first?.content == "hidden")
    }

    @Test func ignoresUnclosedCard() {
        #expect(CardBlocks.find(in: "<details>\n<summary>x</summary>\nno end").isEmpty)
    }

    @Test func roundTrips() {
        let md = CardBlocks.markdown(title: "Q<3>", content: "\n  line one\nline two\n")
        let card = CardBlocks.find(in: "top\n" + md + "\nbottom").first
        #expect(card?.title == "Q<3>")
        #expect(card?.content == "line one\nline two")
        #expect(card?.index == 0)
    }

    @Test func findsSeveral() {
        let text = CardBlocks.markdown(title: "One", content: "a") + "\n\n" + CardBlocks.markdown(title: "Two", content: "b")
        #expect(CardBlocks.find(in: text).map(\.title) == ["One", "Two"])
    }
}
