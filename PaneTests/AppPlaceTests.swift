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
