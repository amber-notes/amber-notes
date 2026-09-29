import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import Supabase
import SwiftData
import Testing
@testable import Pane

/// Version history: who made a version, how the list groups, which lines are tinted, restoring.
@MainActor @Suite struct NoteHistoryTests {
    static let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    static func v(_ version: Int64, _ minutesAgo: Double, _ author: VersionAuthor, current: Bool = false, restored: Bool = false) -> NoteVersion {
        NoteVersion(version: version, madeAt: t0.addingTimeInterval(-minutesAgo * 60), author: author, restored: restored, isCurrent: current)
    }

    static let mac = VersionAuthor.you(device: "Mac"), phone = VersionAuthor.you(device: "iPhone")

    // MARK: Who

    @Test func authorsComeFromSourceAndClient() {
        #expect(VersionAuthor(source: "app", client: "iPhone") == .you(device: "iPhone"))
        #expect(VersionAuthor(source: "app", client: nil) == .you(device: nil))
        #expect(VersionAuthor(source: "app", client: "Something odd") == .you(device: nil))
        #expect(VersionAuthor(source: "mcp", client: "ChatGPT") == .ai("ChatGPT"))
        #expect(VersionAuthor(source: "mcp", client: nil) == .ai("An AI"))
        // The app restoring on a device is you; an AI's restore_revision tool is the AI.
        #expect(VersionAuthor(source: "restore", client: "Mac") == .you(device: "Mac"))
        #expect(VersionAuthor(source: "restore", client: "Claude Code") == .ai("Claude Code"))
        #expect(VersionAuthor.you(device: "iPhone").name == "You on iPhone")
        #expect(VersionAuthor.you(device: nil).name == "You")
        #expect(VersionAuthor.ai("ChatGPT").name == "ChatGPT")
    }

    @Test func aiMarksMatchTheConnectionName() {
        #expect(VersionAuthorMark.asset("ChatGPT") == "AIGlyphOpenAI")
        #expect(VersionAuthorMark.asset("Codex") == "AIGlyphOpenAI")
        #expect(VersionAuthorMark.asset("Claude Code (work laptop)") == "AIGlyphClaude")
        #expect(VersionAuthorMark.asset("Cursor") == nil)
    }

    /// Rows written before authors were recorded take them from the revision before.
    @Test func olderRowsBorrowTheirAuthorFromTheRevisionBefore() {
        typealias R = SupabaseHistoryStore.RevisionRow
        let revisions = [
            R(version: 7, source: "mcp", client: "ChatGPT", created_at: Self.t0, body_source: "app", body_client: "Mac", body_at: Self.t0.addingTimeInterval(-600)),
            R(version: 5, source: "app", client: nil, created_at: Self.t0.addingTimeInterval(-3000), body_source: nil, body_client: nil, body_at: nil),
            R(version: 4, source: "mcp", client: "Claude Code", created_at: Self.t0.addingTimeInterval(-4000), body_source: nil, body_client: nil, body_at: nil),
            R(version: 2, source: "app", client: nil, created_at: Self.t0.addingTimeInterval(-9000), body_source: nil, body_client: nil, body_at: nil),
        ]
        let current = SupabaseHistoryStore.NoteRow(version: 8, updated_at: Self.t0, body_source: "mcp", body_client: "ChatGPT", body_at: Self.t0)
        let out = SupabaseHistoryStore.versions(revisions: revisions, current: current)
        #expect(out.map(\.version) == [8, 7, 5, 4, 2])
        #expect(out[0].isCurrent && out[0].author == .ai("ChatGPT"))
        #expect(out[1].author == Self.mac && out[1].madeAt == Self.t0.addingTimeInterval(-600))
        // Version 5 was written by the edit that replaced version 4: Claude Code, when 4 was replaced.
        #expect(out[2].author == .ai("Claude Code") && out[2].madeAt == Self.t0.addingTimeInterval(-4000))
        // Nothing kept just before 4 and 2: you, at the time it was replaced.
        #expect(out[3].author == .you(device: nil) && out[3].madeAt == Self.t0.addingTimeInterval(-4000))
        #expect(out[4].author == .you(device: nil))
    }

    // MARK: Grouping

    @Test func typingOnOneDeviceCollapsesIntoOneEntry() {
        let versions = [
            Self.v(20, 0, Self.phone, current: true),
            Self.v(19, 10, Self.mac), Self.v(17, 13, Self.mac), Self.v(15, 17, Self.mac), // each within 5 minutes of the next
            Self.v(13, 30, Self.mac), // 13 minutes on: a new entry
        ]
        let entries = HistoryGrouping.entries(versions)
        #expect(entries.map(\.id) == [20, 19, 13])
        #expect(entries.map(\.count) == [1, 3, 1])
    }

    @Test func aiEditsDevicesRestoresAndTheCurrentVersionStandAlone() {
        let versions = [
            Self.v(30, 0, Self.mac, current: true),
            Self.v(29, 1, Self.mac),                   // same device as current, but current stands alone
            Self.v(28, 2, .ai("ChatGPT")), Self.v(27, 3, .ai("ChatGPT")), // every AI edit is its own
            Self.v(26, 4, Self.phone), Self.v(25, 5, Self.mac),            // another device
            Self.v(24, 6, Self.mac, restored: true), Self.v(23, 7, Self.mac),
        ]
        let entries = HistoryGrouping.entries(versions)
        #expect(entries.map(\.id) == [30, 29, 28, 27, 26, 25, 24, 23])
        #expect(entries.allSatisfy { $0.count == 1 })
    }

    @Test func entriesGroupByDayNewestFirst() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Stockholm")!
        cal.locale = Locale(identifier: "en_US")
        let now = cal.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 15))!
        func at(_ day: Int, _ hour: Int) -> Date { cal.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour))! }
        let entries = [(1, at(29, 14)), (2, at(29, 9)), (3, at(28, 20)), (4, at(25, 8))].map {
            HistoryEntry(version: NoteVersion(version: Int64($0.0), madeAt: $0.1, author: Self.mac))
        }
        let days = HistoryGrouping.days(entries, now: now, calendar: cal)
        #expect(days.map { $0.entries.map(\.id) } == [[1, 2], [3], [4]])
        #expect(days[0].title == "Today")
        #expect(days[1].title == "Yesterday")
        #expect(days[2].title.contains("Friday") && days[2].title.contains("25") && days[2].title.contains("September"))
    }

    // MARK: Tint

    @Test func changedLinesAreTheLinesTheCurrentNoteDoesNotHave() {
        let current = "Groceries\n\n- [ ] Oat milk\n- [x] Eggs\n- [ ] Burrata"
        let version = "Groceries\n\n- [ ] Oat milk\n- [ ] Eggs\n- [ ] Lemons 🍋"
        let ranges = HistoryDiff.changedLines(in: version, comparedTo: current)
        let ns = version as NSString
        #expect(ranges.map { ns.substring(with: $0) } == ["- [ ] Eggs", "- [ ] Lemons 🍋"])
        // UTF-16: the lemon counts as two.
        #expect(ranges.last == NSRange(location: ns.length - 15, length: 15))
    }

    @Test func noTintForTheSameTextBlankLinesOrLinesThatWereOnlyRemovedSince() {
        #expect(HistoryDiff.changedLines(in: "A\n\nB", comparedTo: "A\n\nB").isEmpty)
        // An added blank line isn't worth a band.
        #expect(HistoryDiff.changedLines(in: "A\n\n\nB", comparedTo: "A\nB").isEmpty)
        // A line the current note added since isn't in the version, so nothing there to tint.
        #expect(HistoryDiff.changedLines(in: "A\nB", comparedTo: "A\nNew\nB").isEmpty)
        #expect(HistoryDiff.summary(0) == "Same text as the current note.")
        #expect(HistoryDiff.summary(1) == "1 line differs from the current note.")
        #expect(HistoryDiff.summary(4) == "4 lines differ from the current note.")
    }

    @Test func previewMarksWholeChangedParagraphsForTheAmberBand() {
        let storage = NSTextStorage(string: "Title\n- [ ] Eggs\nSame")
        VersionTextView.style(storage, changed: [NSRange(location: 6, length: 10)])
        #expect(storage.attribute(.paneChanged, at: 6, effectiveRange: nil) != nil)
        #expect(storage.attribute(.paneChanged, at: 0, effectiveRange: nil) == nil)
        #expect(storage.attribute(.paneChanged, at: storage.length - 1, effectiveRange: nil) == nil)
    }

    // MARK: Restore

    static func demo() throws -> (ModelContainer, Note) {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        Seed.ensureLibrary(c.mainContext, demo: true)
        try c.mainContext.save()
        let note = try #require(try c.mainContext.fetch(FetchDescriptor<Note>()).first { $0.title == "Groceries" })
        return (c, note)
    }

    @Test func restoringWritesTheOldTextAsANewVersionAndKeepsTheOneItReplaced() async throws {
        let (c, note) = try Self.demo()
        let history = NoteHistory(store: DemoHistoryStore(context: c.mainContext), context: c.mainContext, sync: nil)
        let before = note.body
        let versions = try await history.versions(of: note.id)
        #expect(versions.count == 8)
        #expect(versions.contains { $0.author == .ai("ChatGPT") })
        let target = versions[2]
        let old = try await history.body(of: note, target)
        #expect(old != before)

        try await history.restore(noteID: note.id, toVersion: target.version)
        #expect(note.body == old)
        #expect(note.dirty, "a restore syncs like any edit")

        let after = try await history.versions(of: note.id)
        #expect(after.count == 9)
        #expect(after[0].isCurrent && after[0].restored)
        // What was current is kept, so the restore itself can be undone.
        #expect(try await history.body(of: note, after[1]) == before)
        try await history.restore(noteID: note.id, toVersion: after[1].version)
        #expect(note.body == before)
    }

    @Test func aServerRestoreTakesTheRowTheServerWrote() async throws {
        let (c, note) = try Self.demo()
        let server = FakeServer(note: note.id)
        let history = NoteHistory(store: server, context: c.mainContext, sync: nil)
        try await history.restore(noteID: note.id, toVersion: 3)
        #expect(server.restored == [3])
        #expect(note.body == "Groceries\n\n- [ ] Saffron")
    }

    @Test func offlineRestoreChangesNothingAndSaysWhy() async throws {
        let (c, note) = try Self.demo()
        let store = DemoHistoryStore(context: c.mainContext)
        let history = NoteHistory(store: store, context: c.mainContext, sync: nil)
        let target = try await history.versions(of: note.id)[1]
        let before = note.body
        store.offline = true
        await #expect(throws: HistoryError.offline) { try await history.restore(noteID: note.id, toVersion: target.version) }
        await #expect(throws: HistoryError.offline) { _ = try await history.versions(of: note.id) }
        #expect(note.body == before)
        #expect(HistoryError.offline.localizedDescription.contains("offline"))
    }

    @Test func aNoteWithNoHistoryIsEmptyNotAnError() async throws {
        let (c, _) = try Self.demo()
        let plain = try #require(try c.mainContext.fetch(FetchDescriptor<Note>()).first { $0.title == "Snippets" })
        let model = VersionHistoryModel(note: plain, history: NoteHistory(store: DemoHistoryStore(context: c.mainContext), context: c.mainContext, sync: nil))
        await model.load()
        #expect(model.phase == .loaded)
        #expect(model.isEmpty)
        let local = VersionHistoryModel(note: plain, history: NoteHistory(store: EmptyHistoryStore(), context: c.mainContext, sync: nil))
        await local.load()
        #expect(local.phase == .loaded && local.isEmpty)
    }

    @Test func theListOpensOnTheNewestEarlierVersionWithItsChangesTinted() async throws {
        let (c, note) = try Self.demo()
        let model = VersionHistoryModel(note: note, history: NoteHistory(store: DemoHistoryStore(context: c.mainContext), context: c.mainContext, sync: nil))
        await model.load()
        #expect(model.days.first?.title == "Today")
        #expect(model.selected?.version.author == .ai("ChatGPT"))
        // ChatGPT's version had the eggs and spinach still to buy.
        let text = try #require(model.previewText) as NSString
        #expect(model.changed.map { text.substring(with: $0) } == ["- [ ] Eggs", "- [ ] Spinach"])
        // The Mac typing burst in the demo shows as one entry.
        #expect(model.entries.contains { $0.count == 3 && $0.version.author == Self.mac })
        #expect(await model.restore())
        #expect(note.body == text as String)
    }
}

/// A server that answers a restore with its row.
@MainActor
private final class FakeServer: NoteHistoryStore {
    let note: UUID
    var restored: [Int64] = []
    init(note: UUID) { self.note = note }
    func versions(of note: UUID) async throws -> [NoteVersion] { [] }
    func body(of note: UUID, version: Int64) async throws -> String { "unused" }
    func restore(note: UUID, version: Int64) async throws -> NoteDTO? {
        restored.append(version)
        let n = Note(body: "Groceries\n\n- [ ] Saffron")
        n.id = note
        var row = NoteDTO(n)
        row.version = 12
        return row
    }
}
