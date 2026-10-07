import Foundation
import Testing
@testable import Pane

/// "How did you hear about Amber Notes?": asked once when the server says, one tap answers or
/// skips, and an answer given offline still reaches the server.
@MainActor
@Suite struct HeardFromTests {
    final class FakeService: HeardFromService, @unchecked Sendable {
        var ask = true
        var reachable = true
        var answers: [(HeardFrom.Source, String?)] = []
        func shouldAsk() async throws -> Bool {
            guard reachable else { throw URLError(.notConnectedToInternet) }
            return ask
        }
        func answer(_ source: HeardFrom.Source, detail: String?) async throws {
            guard reachable else { throw URLError(.notConnectedToInternet) }
            answers.append((source, detail))
        }
    }

    static func store(_ service: FakeService) -> HeardFromStore {
        let defaults = UserDefaults(suiteName: "heardFrom.\(UUID())")!
        let s = HeardFromStore(defaults: defaults, arguments: [])
        s.attach(account: UUID(), service: service)
        return s
    }

    /// Lets the store's send task run.
    static func settle() async { for _ in 0..<5 { await Task.yield() } }

    @Test func itShowsOnlyWhenTheServerSaysToAsk() async {
        let quiet = FakeService()
        quiet.ask = false
        let a = Self.store(quiet)
        await a.refresh()
        #expect(!a.visible)

        let b = Self.store(FakeService())
        await b.refresh()
        #expect(b.visible)
    }

    @Test func oneTapAnswersAndIsSent() async {
        let service = FakeService()
        let s = Self.store(service)
        await s.refresh()
        s.answer(.tiktok)
        #expect(s.chosen == .tiktok)
        await Self.settle()
        #expect(service.answers.map(\.0) == [.tiktok])
        #expect(service.answers.first?.1 == nil)
        // A second tap while the tick shows changes nothing.
        s.answer(.google)
        await Self.settle()
        #expect(service.answers.count == 1)
    }

    @Test func skipAndSwipingAwayBothCountAsSkipped() async {
        let one = FakeService(), two = FakeService()
        let a = Self.store(one), b = Self.store(two)
        await a.refresh(); await b.refresh()
        a.skip()
        b.closed()
        await Self.settle()
        #expect(!a.visible && !b.visible)
        #expect(one.answers.map(\.0) == [.skipped])
        #expect(two.answers.map(\.0) == [.skipped])
    }

    @Test func somethingElseKeepsTrimmedWordsOnlyForOther() async {
        let service = FakeService()
        let s = Self.store(service)
        s.answer(.other, detail: "  a newsletter \n")
        await Self.settle()
        #expect(service.answers.first?.1 == "a newsletter")

        let other = FakeService()
        let t = Self.store(other)
        t.answer(.other, detail: "   ")
        await Self.settle()
        #expect(other.answers.first?.1 == nil, "an empty field is just Something else")
    }

    @Test func anOfflineAnswerIsSentLaterAndNeverAskedAgain() async {
        let service = FakeService()
        service.reachable = false
        let s = Self.store(service)
        s.answer(.friend)
        await Self.settle()
        #expect(service.answers.isEmpty)
        s.visible = false

        service.reachable = true
        await s.refresh()
        #expect(service.answers.map(\.0) == [.friend])
        #expect(!s.visible, "answered here: not asked again while the server catches up")
        await s.refresh()
        #expect(service.answers.count == 1, "sent once")
    }

    @Test func everyChoiceHasPlainWordsAndTheServersName() {
        #expect(HeardFrom.choices.count == 9)
        #expect(!HeardFrom.choices.contains(.skipped))
        let names = HeardFrom.Source.allCases.map(\.rawValue)
        #expect(names == ["google", "blog", "ai_assistant", "tiktok", "youtube", "instagram", "friend", "product_hunt_hn", "other", "skipped"])
        for source in HeardFrom.choices { #expect(!HeardFrom.title(source).isEmpty) }
    }
}
