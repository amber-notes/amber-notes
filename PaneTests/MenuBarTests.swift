import Foundation
import SwiftData
import Testing
@testable import Pane

@MainActor @Suite struct MenuBarTests {
    func library() throws -> ModelContext {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        return ModelContext(c)
    }

    func note(_ body: String, in context: ModelContext, pinned: Bool = false, minutesAgo: Double) -> Note {
        let n = context.createNote(in: .all, body: body)
        n.isPinned = pinned
        n.updatedAt = Date.now.addingTimeInterval(-minutesAgo * 60)
        return n
    }

    @Test func pinnedFirstThenTheLatestSixWithoutDeletedOrSubNotes() throws {
        let ctx = try library()
        let pinned = note("Groceries", in: ctx, pinned: true, minutesAgo: 90)
        let recent = (0..<8).map { note("Note \($0)", in: ctx, minutesAgo: Double($0)) }
        let trashed = note("Old", in: ctx, minutesAgo: 0.5)
        trashed.trashedAt = .now
        let child = ctx.createSubNote(of: recent[0], body: "Child")
        recent[0].body += "\n[Child](pane-note:\(child.id.uuidString.lowercased()))"
        child.updatedAt = .now
        let s = MenuBarList.sections(try ctx.fetch(FetchDescriptor<Note>()), query: "", isNested: { ctx.isNested($0) })
        #expect(s.pinned == [pinned.id])
        #expect(s.recent == recent.prefix(6).map(\.id))
        #expect(!s.all.contains(trashed.id))
        #expect(!s.all.contains(child.id))
    }

    @Test func searchPutsTitleMatchesBeforeTextMatches() throws {
        let ctx = try library()
        let inBody = note("Monday\nbuy milk", in: ctx, minutesAgo: 1)
        let inTitle = note("Milk run\nsaturday", in: ctx, minutesAgo: 30)
        _ = note("Unrelated", in: ctx, minutesAgo: 2)
        let s = MenuBarList.sections(try ctx.fetch(FetchDescriptor<Note>()), query: " MILK ", isNested: { _ in false })
        #expect(s.matches == [inTitle.id, inBody.id])
        #expect(s.all == s.matches)
    }

    @Test func quickCaptureMakesANoteTitledByItsFirstLine() throws {
        let ctx = try library()
        #expect(QuickCapture.save("   \n ", in: ctx) == nil)
        let n = try #require(QuickCapture.save("  Call the dentist\nbefore Friday ", in: ctx))
        #expect(n.title == "Call the dentist")
        #expect(n.body == "Call the dentist\nbefore Friday")
        #expect(n.folder != nil)
    }

    @Test func openingANoteRemembersItForAFreshWindow() {
        let id = UUID()
        NoteOpener.shared.open(id)
        #expect(NoteOpener.shared.request == id)
        #expect(UserDefaults.standard.string(forKey: "lastNote") == id.uuidString)
        NoteOpener.shared.request = nil
    }

    @Test func testRunsNeverShowTheMenuBarItem() {
        #expect(MenuBarSettings.allowed == false)
    }
}

#if os(macOS)
import SwiftUI

/// Offscreen pictures of the panel: `AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/MenuBarSnapshotTests`.
@MainActor @Suite(.serialized) struct MenuBarSnapshotTests {
    @Test(arguments: [false, true]) func panel(dark: Bool) async throws {
        let c = try AppSnapshotTests.container()
        let backend = Backend()
        try await AppSnapshotTests.render(MenuBarPanel(backend: backend, sync: nil).modelContainer(c),
                                          name: "mac-menubar-\(dark ? "dark" : "light")", dark: dark)
        try await AppSnapshotTests.render(MenuBarPanel(backend: backend, sync: nil, query: "lis").modelContainer(c),
                                          name: "mac-menubar-typing-\(dark ? "dark" : "light")", dark: dark)
    }
}
#endif
