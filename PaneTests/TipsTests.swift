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
        PaneTips.noteOpened("Groceries\n- [ ] Milk")
        #expect(PaneTips.calm && PaneTips.noteIsLong && !PaneTips.historyMoment)
        PaneTips.typed()
        #expect(!PaneTips.calm)
        // A big deletion while typing makes history due, but not until things are quiet again.
        PaneTips.deletedALot()
        #expect(PaneTips.historyMoment && !PaneTips.calm)
        PaneTips.listOpened()
        #expect(PaneTips.calm && !PaneTips.noteIsLong && !PaneTips.historyMoment)
        PaneTips.aiEditLanded()
        #expect(PaneTips.historyMoment && PaneTips.calm)
    }

    // MARK: Counting

    @Test func shownAndUsedAreSentOnceAndUsedOnlyAfterShown() {
        let d = Self.defaults()
        TipLog.defaults = d
        TipLog.sent = []
        defer { TipLog.defaults = .standard; TipLog.sent = []; PaneTips.turn = "" }
        TipLog.used(MenuBarTip())
        #expect(TipLog.sent.isEmpty, "used without the tip ever showing isn't counted")
        TipLog.shown("menuBar")
        TipLog.shown("menuBar")
        TipLog.used(MenuBarTip())
        TipLog.used(MenuBarTip())
        #expect(TipLog.sent.map { "\($0.tip):\($0.event)" } == ["menuBar:shown", "menuBar:used"])
        #expect(PaneTips.turn == "menuBar", "a tip shown takes the turn")
    }

    @Test func theTipsAreFourWithDistinctIdsTheServerKnows() {
        let ids = PaneTips.all.map(\.id)
        #expect(Set(ids) == ["versionHistory", "shareLink", "menuBar", "shareExtension"])
        #expect(Set(Feature.allCases.map(\.rawValue)) == Set(ids))
        let sql = try! String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "supabase/migrations/20260929230000_tip_events.sql"), encoding: .utf8)
        for id in ids { #expect(sql.contains("'\(id)'"), "the server accepts \(id)") }
        #expect(!sql.contains("checklistTidy") && !sql.contains("tableFromText"), "the removed tips are gone from the server too")
    }

    // MARK: Features you've ever used

    @Test func aFeatureUsedHereIsRememberedAndItsTipCountedAsUsed() {
        let d = Self.defaults()
        FeatureUse.defaults = d
        TipLog.defaults = d
        TipLog.sent = []
        FeatureUse.deviceEvidence = { [] }
        defer { FeatureUse.defaults = .standard; TipLog.defaults = .standard; TipLog.sent = []; FeatureUse.deviceEvidence = { Inbox.everUsed ? [.shareExtension] : [] } }
        #expect(FeatureUse.local.isEmpty)
        FeatureUse.mark(.menuBar)
        FeatureUse.mark(.menuBar)
        #expect(FeatureUse.local == [.menuBar])
        #expect(d.stringArray(forKey: FeatureUse.key) == ["menuBar"])
        #expect(TipLog.sent.isEmpty, "the tip was never shown, so its use isn't counted as after the tip")
    }

    @Test func theShareExtensionHavingWrittenHereBeforeCountsAsUse() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "inbox-\(UUID().uuidString)")
        Inbox.rootOverride = dir
        defer { Inbox.rootOverride = nil; try? FileManager.default.removeItem(at: dir) }
        #expect(!Inbox.everUsed)
        try Inbox.add(markdown: "Saved from Safari", files: [])
        for (_, item) in Inbox.pending() { Inbox.remove(item) }
        #expect(Inbox.pending().isEmpty)
        #expect(Inbox.everUsed, "the folder stays after its items are filed")
    }

    @Test func withoutAServerWhatThisDeviceKnowsIsEnough() {
        let client = FeatureUse.client
        FeatureUse.client = nil
        defer { FeatureUse.client = client; PaneTips.featureUseKnown = false }
        PaneTips.featureUseKnown = false
        FeatureUse.applyLocal()
        #expect(PaneTips.featureUseKnown)
    }

    // MARK: TipKit rules

    /// The shared rules, evaluated by TipKit itself: nothing before 3 days of use, nothing with
    /// the setup card, only the tip whose turn it is, and gone once closed. (The note moments and
    /// "not while typing" are parameters other suites' views set as they open notes, so they're
    /// checked above without TipKit; here a tip uses only the rules nothing else touches.)
    ///
    /// Runs on its own (`TEST_RUNNER_AMBER_TIPKIT=1 scripts/qa-test.sh PaneTests/TipsTests`):
    /// setting up TipKit in a full run would let tips appear in other suites' windows.
    @Test func tipKitShowsATipOnlyWhenEveryRuleHolds() async throws {
        guard ProcessInfo.processInfo.environment["AMBER_TIPKIT"] == "1" else { return }
        let dir = FileManager.default.temporaryDirectory.appending(path: "tips-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? Tips.configure([.datastoreLocation(.url(dir)), .displayFrequency(.immediate)])
        let tip = RulesProbeTip()
        PaneTips.setupVisible = false
        PaneTips.turn = ""
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
        PaneTips.turn = "versionHistory"
        #expect(await !shows(), "another tip has these 3 days")
        PaneTips.turn = ""
        #expect(await shows())
        tip.invalidate(reason: .tipClosed)
        #expect(await !shows(), "closed is gone for good")

        // A real tip: due now, and never again once its feature turns out to have been used.
        let share = ShareLinkTip()
        PaneTips.featureUseKnown = false
        PaneTips.noteOpened((1...12).map { "Line \($0)" }.joined(separator: "\n"))
        try? await Task.sleep(for: .milliseconds(150))
        #expect(!share.shouldDisplay, "no tip until what you've used is known")
        PaneTips.featureUseKnown = true
        try? await Task.sleep(for: .milliseconds(150))
        #expect(share.shouldDisplay)
        FeatureUse.apply([.shareLink])
        try? await Task.sleep(for: .milliseconds(150))
        #expect(!share.shouldDisplay, "a feature you've used never gets its tip")
        // Leave TipKit unable to show anything to the rest of the run.
        PaneTips.setupVisible = true
    }
}

/// The app's shared rules without the moment ones, for the TipKit test above.
private struct RulesProbeTip: Tip {
    var title: Text { Text("Probe") }
    var rules: [Rule] {
        [
            #Rule(PaneTips.activeDay) { $0.donations.count >= 3 },
            #Rule(PaneTips.$setupVisible) { $0 == false },
            #Rule(PaneTips.$turn) { $0 == "" || $0 == "probe" },
        ]
    }
}
