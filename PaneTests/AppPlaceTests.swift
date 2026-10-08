import Foundation
import Testing
@testable import Pane

/// The places the onboarding emails link to (Pane/Model/AppPlace.swift).
struct AppPlaceTests {
    @Test func parsesTheWebAndAppLinks() {
        let cases: [(String, AppPlace?)] = [
            ("https://ambernotes.app/open/connect-ai", .connectAI),
            ("https://www.ambernotes.app/open/import/", .importNotes),
            ("https://ambernotes.app/open/history", .history),
            ("ambernotes://connect-ai", .connectAI),
            ("ambernotes://history", .history),
            ("ambernotes://import", .importNotes),
        ]
        for (link, place) in cases { #expect(AppPlace.parse(URL(string: link)!) == place, "\(link)") }
    }

    @Test func leavesEverythingElseAlone() {
        for link in ["https://ambernotes.app/open/template/grocery-list", "https://ambernotes.app/open/connect?request=x",
                     "https://evil.example/open/history", "http://ambernotes.app/open/history", "ambernotes://template/trip-plan",
                     "ambernotes://history/extra", "https://ambernotes.app/history"] {
            #expect(AppPlace.parse(URL(string: link)!) == nil, "\(link)")
        }
    }

    @Test func templateAndCopyLinksStillParseAsBefore() {
        #expect(NoteSourceLink.parse(URL(string: "https://ambernotes.app/open/template/grocery-list")!)?.slug == "grocery-list")
        #expect(NoteSourceLink.parse(URL(string: "https://ambernotes.app/open/connect-ai")!) == nil)
    }

    @Test func historyOpensOnTheNoteAnAIChangedLast() {
        let now = Date()
        let notes: [(id: Int, aiEditedAt: Date?)] = [(1, nil), (2, now.addingTimeInterval(-60)), (3, now), (4, now.addingTimeInterval(-3600))]
        #expect(AppPlace.historyNote(notes) == 3)
        #expect(AppPlace.historyNote([(id: 1, aiEditedAt: nil)]) == nil)
    }

    @Test @MainActor func centerTakesOnlyItsOwnLinks() {
        let center = AppPlaceCenter()
        #expect(center.receive(URL(string: "https://ambernotes.app/open/history")!))
        #expect(center.pending == .history)
        #expect(!center.receive(URL(string: "https://ambernotes.app/open/template/trip-plan")!))
    }
}

/// Settings' pages: the Mac remembers its last tab, links open theirs, and signed out there are
/// only General and Account.
@MainActor struct SettingsTabTests {
    func defaults() -> UserDefaults { UserDefaults(suiteName: "SettingsTabTests.\(UUID().uuidString)")! }

    @Test func remembersTheLastTab() {
        let d = defaults()
        #expect(SettingsRoute(defaults: d).tab == .general, "General the first time")
        let route = SettingsRoute(defaults: d)
        route.tab = .storage
        #expect(SettingsRoute(defaults: d).tab == .storage, "the next launch opens where you left it")
    }

    @Test func linksOpenTheirTab() {
        let route = SettingsRoute(defaults: defaults())
        route.open(.ai)
        #expect(route.tab == .ai)
        #if os(iOS)
        #expect(route.target == .ai, "iPhone pushes the page once Settings shows")
        #else
        #expect(route.target == nil, "the Mac's window just switches tab")
        #endif
    }

    @Test func signedOutShowsGeneralAndAccount() {
        let view = SettingsView(backend: Backend(), sync: nil, route: SettingsRoute(defaults: defaults()))
        #expect(view.tabs.prefix(2) == [.general, .account])
        #expect(!view.tabs.contains(.ai) && !view.tabs.contains(.storage))
    }

    @Test func signedInShowsAccountAIAndStorage() {
        let backend = Backend(testClient: CaptureScreen.client, email: "sara@example.com")
        let view = SettingsView(backend: backend, sync: nil, route: SettingsRoute(defaults: defaults()))
        #expect(Array(view.tabs.filter { $0 != .security }) == [.general, .account, .ai, .storage])
    }
}
