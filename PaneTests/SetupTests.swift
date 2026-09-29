import Foundation
import SwiftUI
import Testing
@testable import Pane

/// The first-run "Get set up" card: which step is next, when it celebrates, when it goes.
@Suite struct SetupProgressTests {
    @Test func freshAccountStartsAtBringYourNotes() {
        let p = SetupProgress()
        #expect(p.current == .bring)
        #expect(p.visible)
        #expect(!p.celebrating)
        #expect(!p.needsToDoNote)
    }

    @Test func stepsTickInOrderOfWhatReallyHappened() {
        var p = SetupProgress(imported: true)
        #expect(p.current == .connect)
        p.connected = true
        #expect(p.current == .tryIt)
        #expect(p.needsToDoNote, "step 3's prompt needs a To-do note")
        p.aiEdits = 1
        #expect(p.current == nil)
        #expect(p.celebrating)
        #expect(!p.needsToDoNote)
    }

    @Test func connectingBeforeImportingStillShowsStepOneFirst() {
        let p = SetupProgress(imported: false, connected: true)
        #expect(p.current == .bring)
        #expect(p.isDone(.connect))
    }

    @Test func hidingOrCelebratingEndsTheCardForGood() {
        #expect(!SetupProgress(dismissed: true).visible)
        #expect(!SetupProgress(aiEdits: 3, celebrated: true).visible)
        #expect(!SetupProgress(aiEdits: 3, dismissed: true).celebrating, "a hidden card never celebrates")
    }

    @Test func decodesTheServerAnswer() throws {
        let json = #"{"imported":true,"connected":false,"ai_edits":2,"dismissed":false,"celebrated":false}"#
        let p = try JSONDecoder().decode(SetupProgress.self, from: Data(json.utf8))
        #expect(p == SetupProgress(imported: true, connected: false, aiEdits: 2))
    }
}

/// A stand-in for the server.
private final class FakeSetup: SetupService, @unchecked Sendable {
    var answer = SetupProgress()
    var marked: [String] = []
    var calls = 0
    func progress() async throws -> SetupProgress { calls += 1; return answer }
    func mark(_ step: String) async throws { marked.append(step) }
}

@MainActor @Suite struct SetupStoreTests {
    @Test func noAccountNoCard() async {
        let store = SetupStore()
        await store.refresh(force: true)
        #expect(!store.visible)
    }

    @Test func firstAIEditCelebratesThenMarksIt() async throws {
        let fake = FakeSetup()
        let store = SetupStore()
        store.attach(account: UUID(), service: fake)
        fake.answer = SetupProgress(imported: true, connected: true)
        await store.refresh(force: true)
        #expect(store.visible && !store.showingCelebration)
        fake.answer.aiEdits = 1
        await store.refresh(force: true)
        #expect(store.showingCelebration, "That was your AI.")
        #expect(store.visible)
    }

    @Test func markingUpdatesAtOnceAndTellsTheServer() async {
        let fake = FakeSetup()
        let store = SetupStore()
        store.attach(account: UUID(), service: fake)
        await store.refresh(force: true)
        await store.mark("imported")
        #expect(store.progress?.imported == true)
        await store.mark("dismissed")
        #expect(!store.visible)
        #expect(fake.marked == ["imported", "dismissed"])
    }

    @Test func refreshesAreThrottledAndStopWhenTheCardIsGone() async {
        let fake = FakeSetup()
        let store = SetupStore()
        store.attach(account: UUID(), service: fake)
        await store.refresh(force: true)
        await store.refresh()
        await store.refresh()
        #expect(fake.calls == 1, "syncs while typing mustn't flood the server")
        await store.mark("dismissed")
        await store.refresh(force: true)
        #expect(fake.calls == 1, "a hidden card never asks again")
    }

    @Test func anotherAccountStartsOver() async {
        let fake = FakeSetup()
        fake.answer = SetupProgress(imported: true, dismissed: true)
        let store = SetupStore()
        store.attach(account: UUID(), service: fake)
        await store.refresh(force: true)
        #expect(!store.visible)
        store.attach(account: UUID(), service: FakeSetup())
        #expect(store.progress == nil)
        await store.refresh(force: true)
        #expect(store.visible)
    }
}

#if os(macOS)
/// The card in each state, light and dark: `AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/SetupCardSnapshots`.
@MainActor @Suite(.serialized) struct SetupCardSnapshots {
    @Test(arguments: [false, true])
    func states(dark: Bool) async throws {
        let mode = dark ? "dark" : "light"
        let states: [(String, SetupProgress, Bool)] = [
            ("1-bring", SetupProgress(), false),
            ("2-connect", SetupProgress(imported: true), false),
            ("3-try", SetupProgress(imported: true, connected: true), false),
            ("4-celebrate", SetupProgress(imported: true, connected: true, aiEdits: 1), true),
        ]
        for (name, p, celebrating) in states {
            let card = SetupCard(progress: p, celebrating: celebrating, onImport: {}, onStartFresh: {}, onConnect: {}, onHide: {})
                .frame(width: 330)
                .padding(12)
            try await AppSnapshotTests.render(card, name: "setup-\(name)-\(mode)", dark: dark)
        }
    }
}
#endif
