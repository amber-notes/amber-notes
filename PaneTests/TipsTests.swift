import Foundation
import Testing
import TipKit
@testable import Pane

/// "Did you know" tips: when each one's moment comes, the rules they share, and counting.
@MainActor @Suite(.serialized) struct TipsTests {
    // MARK: Moments

    @Test func aNoteIsWorthSharingAtTenLinesOrAsAChecklist() {
        #expect(!TipTriggers.worthSharing("Title\n\nOne line"))
        #expect(TipTriggers.worthSharing((1...10).map { "Line \($0)" }.joined(separator: "\n")))
        // Blank lines don't count.
        #expect(!TipTriggers.worthSharing((1...9).map { "Line \($0)" }.joined(separator: "\n\n")))
        #expect(TipTriggers.worthSharing("Groceries\n- [ ] Milk"))
        #expect(TipTriggers.worthSharing("Done\n- [x] Milk"))
    }

    @Test func aBigDeletionIsFiveLinesOrFourHundredCharacters() {
        let long = (1...8).map { "Line \($0)" }.joined(separator: "\n")
        #expect(TipTriggers.isBigDeletion(from: long, to: "Line 1\nLine 2"))
        #expect(!TipTriggers.isBigDeletion(from: long, to: (1...5).map { "Line \($0)" }.joined(separator: "\n")))
        #expect(TipTriggers.isBigDeletion(from: String(repeating: "x", count: 500), to: "x"))
        #expect(!TipTriggers.isBigDeletion(from: "short", to: ""))
        #expect(!TipTriggers.isBigDeletion(from: "a", to: long), "adding text isn't deleting")
    }

    @Test func tableLikeLinesAreFoundByTabsOrPipes() {
        let tabs = "Budget\nItem\tCost\nRent\t900\nFood\t300\nThanks"
        let r = try! #require(TipTriggers.tableText(in: tabs))
        #expect((tabs as NSString).substring(with: r) == "Item\tCost\nRent\t900\nFood\t300")
        let pipes = "Team\nName | Role | City\nSara | Sales | Oslo\n"
        #expect(TipTriggers.tableText(in: pipes).map { (pipes as NSString).substring(with: $0) } == "Name | Role | City\nSara | Sales | Oslo")
    }

    @Test func oneLineTablesAndRealTablesDontCount() {
        #expect(TipTriggers.tableText(in: "Just a | pipe once\nand text") == nil)
        #expect(TipTriggers.tableText(in: "| A | B |\n| --- | --- |\n| 1 | 2 |") == nil)
        #expect(TipTriggers.tableText(in: "No tables here.\nNone at all.") == nil)
        // Different numbers of cells aren't one table.
        #expect(TipTriggers.tableText(in: "a\tb\nc\td\te") == nil)
    }

    @Test func tableLikeLinesBecomeAMarkdownTable() {
        #expect(TableText.markdown(["Item\tCost", "Rent\t900", "Food\t300"]) == "| Item | Cost |\n| --- | --- |\n| Rent | 900 |\n| Food | 300 |")
        #expect(TableText.markdown(["Name | Role", "Sara | Sales"]) == "| Name | Role |\n| --- | --- |\n| Sara | Sales |")
        #expect(TableText.markdown(["Only one\tline"]) == nil)
        #expect(TableText.markdown(["a\tb", "plain line"]) == nil)
    }

    @Test func theTableButtonConvertsTheSelectedLinesOnly() {
        let text = "Budget\nItem\tCost\nRent\t900\nAfter"
        let ns = text as NSString
        let sel = NSRange(location: ns.range(of: "Item").location, length: 5)
        let within = NSUnionRange(sel, ns.range(of: "900"))
        let edit = try! #require(TableText.edit(in: text, selection: within))
        #expect(ns.replacingCharacters(in: edit.range, with: edit.replacement) == "Budget\n| Item | Cost |\n| --- | --- |\n| Rent | 900 |\nAfter")
        // No selection: the button inserts an empty table as before.
        #expect(TableText.edit(in: text, selection: NSRange(location: 3, length: 0)) == nil)
        // Plain lines selected: nothing to convert.
        #expect(TableText.edit(in: text, selection: NSRange(location: 0, length: 6)) == nil)
    }

    // MARK: Spacing and days

    static func defaults() -> UserDefaults {
        let name = "TipsTests.\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    @Test func oneTipHasThreeDaysThenTheNextMayGo() {
        let d = Self.defaults()
        let t0 = Date(timeIntervalSince1970: 1_790_000_000)
        #expect(TipSpacing.turn(now: t0, defaults: d) == "")
        #expect(TipSpacing.shown("shareLink", now: t0, defaults: d) == "shareLink")
        #expect(TipSpacing.turn(now: t0.addingTimeInterval(86400), defaults: d) == "shareLink")
        #expect(TipSpacing.allows("shareLink", turn: "shareLink"))
        #expect(!TipSpacing.allows("versionHistory", turn: "shareLink"))
        // Showing the same tip again doesn't restart its 3 days.
        _ = TipSpacing.shown("shareLink", now: t0.addingTimeInterval(2 * 86400), defaults: d)
        #expect(TipSpacing.turn(now: t0.addingTimeInterval(3 * 86400 + 1), defaults: d) == "")
        #expect(TipSpacing.allows("versionHistory", turn: ""))
    }

    @Test func daysAreCalendarDays() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Stockholm")!
        let late = cal.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 23, minute: 50))!
        #expect(PaneTips.dayStamp(late, calendar: cal) == PaneTips.dayStamp(late.addingTimeInterval(-3600), calendar: cal))
        #expect(PaneTips.dayStamp(late, calendar: cal) != PaneTips.dayStamp(late.addingTimeInterval(20 * 60), calendar: cal))
    }

    // MARK: Quiet moments

    @Test func typingEndsTheQuietMomentAndOpeningANoteStartsOne() {
        PaneTips.noteOpened("Groceries\n- [ ] Milk\nItem\tCost\nRent\t900")
        #expect(PaneTips.calm && PaneTips.noteIsLong && PaneTips.noteHasTableText)
        #expect(!PaneTips.historyMoment && !PaneTips.justTicked)
        PaneTips.typed()
        #expect(!PaneTips.calm)
        // A big deletion while typing makes history due, but not until things are quiet again.
        PaneTips.deletedALot()
        #expect(PaneTips.historyMoment && !PaneTips.calm)
        PaneTips.ticked()
        #expect(PaneTips.calm && PaneTips.justTicked)
        PaneTips.listOpened()
        #expect(PaneTips.calm && !PaneTips.noteIsLong && !PaneTips.historyMoment && !PaneTips.justTicked)
        PaneTips.aiEditLanded()
        #expect(PaneTips.historyMoment && PaneTips.calm)
    }

    // MARK: Counting

    @Test func shownAndUsedAreSentOnceAndUsedOnlyAfterShown() {
        let d = Self.defaults()
        TipLog.defaults = d
        TipLog.sent = []
        defer { TipLog.defaults = .standard; TipLog.sent = []; PaneTips.turn = "" }
        TipLog.used(TableTip())
        #expect(TipLog.sent.isEmpty, "used without the tip ever showing isn't counted")
        TipLog.shown("tableFromText")
        TipLog.shown("tableFromText")
        TipLog.used(TableTip())
        TipLog.used(TableTip())
        #expect(TipLog.sent.map { "\($0.tip):\($0.event)" } == ["tableFromText:shown", "tableFromText:used"])
        #expect(PaneTips.turn == "tableFromText", "a tip shown takes the turn")
    }

    @Test func theTipsAreSixWithDistinctIdsTheServerKnows() {
        let ids = PaneTips.all.map(\.id)
        #expect(Set(ids) == ["versionHistory", "shareLink", "checklistTidy", "tableFromText", "menuBar", "shareExtension"])
        let sql = try! String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "supabase/migrations/20260929220000_tip_events.sql"), encoding: .utf8)
        for id in ids { #expect(sql.contains("'\(id)'"), "the server accepts \(id)") }
    }

    // MARK: TipKit rules

    /// The shared rules, evaluated by TipKit itself: nothing before 3 days of use, nothing with
    /// the setup card, nothing while typing, and only the tip whose turn it is.
    @Test func tipKitShowsATipOnlyWhenEveryRuleHolds() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "tips-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? Tips.configure([.datastoreLocation(.url(dir)), .displayFrequency(.immediate)])
        let tip = ShareLinkTip()
        PaneTips.setupVisible = false
        PaneTips.turn = ""
        PaneTips.noteOpened((1...12).map { "Line \($0)" }.joined(separator: "\n"))
        func shows() async -> Bool {
            try? await Task.sleep(for: .milliseconds(150))
            return tip.shouldDisplay
        }
        #expect(await !shows(), "no tips before 3 days of use")
        for _ in 0..<3 { await PaneTips.activeDay.donate() }
        #expect(await shows())
        PaneTips.setupVisible = true
        #expect(await !shows(), "never with the setup card")
        PaneTips.setupVisible = false
        PaneTips.typed()
        #expect(await !shows(), "never while typing")
        PaneTips.noteOpened((1...12).map { "Line \($0)" }.joined(separator: "\n"))
        PaneTips.turn = "versionHistory"
        #expect(await !shows(), "another tip has these 3 days")
        PaneTips.turn = ""
        #expect(await shows())
        tip.invalidate(reason: .tipClosed)
        #expect(await !shows(), "closed is gone for good")
        PaneTips.listOpened()
        PaneTips.calm = false
    }
}
