import Foundation
import Supabase
import SwiftUI
import TipKit

/// "Did you know" tips (TipKit) for what Amber Notes does that Apple Notes doesn't.
///
/// The rules every tip shares:
/// - at most one tip every 3 days: TipKit's displayFrequency is daily (it has no 3-day setting),
///   and `turn` holds the one tip whose 3 days these are (see `TipSpacing`);
/// - only once you've used the app on 3 different days (the `activeDay` event, donated once a day);
/// - never while the Get set up card shows (`setupVisible`);
/// - never while you type: `calm` is set when a note or the list opens, or after a tap such as a
///   tick, and cleared by the first keystroke, so a tip only appears at a quiet moment;
/// - once you close a tip or use its feature, it's gone for good (invalidated), and each is shown
///   at most twice.
///
/// Launch arguments, for captures and testing: `-resetTips` clears everything TipKit remembers,
/// `-showTips` shows every tip whose anchor is on screen, `-showTip <id>` shows just that one.
enum PaneTips {
    // MARK: Shared state

    /// Nothing is being typed: a note or the list just opened, or you tapped something.
    @Parameter static var calm: Bool = false
    /// The Get set up card is on screen.
    @Parameter static var setupVisible: Bool = false
    /// The open note is long enough to be worth sending, or it's a checklist.
    @Parameter static var noteIsLong: Bool = false
    /// The open note has lines with tabs or pipes between words, not yet a table.
    @Parameter static var noteHasTableText: Bool = false
    /// An AI's edit just landed on the open note, or you just deleted a lot of it.
    @Parameter static var historyMoment: Bool = false
    /// You just ticked a checklist item.
    @Parameter static var justTicked: Bool = false
    /// The tip whose turn it is ("" when any may go next); see `TipSpacing`.
    @Parameter static var turn: String = ""
    /// The menu bar icon is on (Mac).
    @Parameter static var menuBarShown: Bool = true

    /// Once per calendar day the app is used.
    static let activeDay = Tips.Event(id: "activeDay")
    /// Notes were brought in (an import, on any device).
    static let imported = Tips.Event(id: "imported")

    /// Notes were imported (the server knows, on any device): counted once per install.
    @MainActor static func importedOnce(defaults: UserDefaults = .standard) async {
        guard !defaults.bool(forKey: "tipsImported") else { return }
        defaults.set(true, forKey: "tipsImported")
        await imported.donate()
    }

    /// The tip the note list shows inline: the menu bar on the Mac, Share on iPhone.
    static var listTip: any Tip {
        #if os(macOS)
        MenuBarTip()
        #else
        ShareExtensionTip()
        #endif
    }

    /// Days of use before any tip, and before the Mac menu bar tip.
    static let minimumDays = 3
    static let menuBarDays = 5

    static let all: [any Tip] = [VersionHistoryTip(), ShareLinkTip(), ChecklistTip(), TableTip(), MenuBarTip(), ShareExtensionTip()]

    // MARK: Setup

    /// Once, at launch. Unit-test hosts never show tips.
    static func configure(arguments: [String] = ProcessInfo.processInfo.arguments) {
        guard !PaneApp.isUnitTestHost else { return }
        if arguments.contains("-resetTips") { try? Tips.resetDatastore() }
        if arguments.contains("-showTips") {
            Tips.showAllTipsForTesting()
        } else if let i = arguments.firstIndex(of: "-showTip"), i + 1 < arguments.count,
                  let tip = all.first(where: { $0.id == arguments[i + 1] }) {
            Tips.showTipsForTesting([type(of: tip)])
        }
        try? Tips.configure([.displayFrequency(frequency), .datastoreLocation(.applicationDefault)])
        Task { await appOpened() }
    }

    /// Daily, with `TipSpacing` making it every 3 days; captures show them at once.
    static var frequency: Tips.ConfigurationOption.DisplayFrequency {
        let args = ProcessInfo.processInfo.arguments
        return args.contains("-showTips") || args.contains("-showTip") ? .immediate : .daily
    }

    static let lastDayKey = "tipsLastActiveDay"

    /// Counts today as a day of use, once.
    @MainActor static func appOpened(now: Date = .now, defaults: UserDefaults = .standard) async {
        let today = dayStamp(now)
        turn = TipSpacing.turn(now: now, defaults: defaults)
        guard defaults.string(forKey: lastDayKey) != today else { return }
        defaults.set(today, forKey: lastDayKey)
        await activeDay.donate()
    }

    static func dayStamp(_ d: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)"
    }

    // MARK: Moments

    /// A note was opened: a quiet moment, and what the note is like decides which tips fit.
    @MainActor static func noteOpened(_ body: String) {
        historyMoment = false
        justTicked = false
        noteIsLong = TipTriggers.worthSharing(body)
        noteHasTableText = TipTriggers.tableText(in: body) != nil
        calm = true
    }

    /// The list (or no note) is showing.
    @MainActor static func listOpened() {
        noteIsLong = false
        noteHasTableText = false
        historyMoment = false
        justTicked = false
        calm = true
    }

    /// A keystroke: no tips until the next quiet moment.
    @MainActor static func typed() {
        if calm { calm = false }
    }

    @MainActor static func ticked() {
        justTicked = true
        calm = true
    }

    @MainActor static func aiEditLanded() {
        historyMoment = true
        calm = true
    }

    /// A big deletion: history is worth knowing about, next time things are quiet.
    @MainActor static func deletedALot() {
        historyMoment = true
    }
}

/// One tip per 3 days. The first tip shown takes the turn; for 3 days only it may show (again,
/// until you close it or use its feature); then the turn is free for the next one.
enum TipSpacing {
    static let days: TimeInterval = 3 * 86400
    static let tipKey = "tipsTurn", atKey = "tipsTurnAt"

    /// Whose turn it is now: the last tip shown, if that was under 3 days ago.
    static func turn(now: Date = .now, defaults: UserDefaults = .standard) -> String {
        guard let tip = defaults.string(forKey: tipKey), let at = defaults.object(forKey: atKey) as? Date,
              now.timeIntervalSince(at) < days else { return "" }
        return tip
    }

    /// A tip was shown: it has the next 3 days, unless it already had them.
    static func shown(_ tip: String, now: Date = .now, defaults: UserDefaults = .standard) -> String {
        if turn(now: now, defaults: defaults) != tip {
            defaults.set(tip, forKey: tipKey)
            defaults.set(now, forKey: atKey)
        }
        return tip
    }

    /// Whether `tip` may show, given whose turn it is.
    static func allows(_ tip: String, turn: String) -> Bool { turn.isEmpty || turn == tip }
}

/// When each tip's moment has come, worked out from a note's text.
enum TipTriggers {
    /// 10 or more lines with something on them, or a checklist.
    static func worthSharing(_ body: String) -> Bool {
        var lines = 0
        for line in body.split(separator: "\n", omittingEmptySubsequences: true) {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("- [ ]") || t.hasPrefix("- [x]") || t.hasPrefix("- [X]") { return true }
            if !t.isEmpty { lines += 1 }
            if lines >= 10 { return true }
        }
        return false
    }

    /// Removing this much at once is a "big deletion": 5 lines, or 400 characters.
    static func isBigDeletion(from old: String, to new: String) -> Bool {
        let removed = (old as NSString).length - (new as NSString).length
        let lines = old.components(separatedBy: "\n").count - new.components(separatedBy: "\n").count
        return removed >= 400 || lines >= 5
    }

    /// The first run of 2+ lines that split into the same number (2+) of cells on tabs or pipes,
    /// and aren't a markdown table already. UTF-16 range, whole lines.
    static func tableText(in body: String) -> NSRange? {
        let ns = body as NSString
        var start: Int?
        var count = 0
        var columns = 0
        var runEnd = 0
        var location = 0
        var found: NSRange?
        func close() {
            if let s = start, count >= 2 { found = found ?? NSRange(location: s, length: runEnd - s) }
            start = nil; count = 0; columns = 0
        }
        for line in body.components(separatedBy: "\n") {
            let length = (line as NSString).length
            let cells = TableText.cells(line)
            if let cells, cells.count >= 2, start == nil || cells.count == columns {
                if start == nil { start = location; columns = cells.count }
                count += 1
                runEnd = location + length
            } else {
                close()
                if let cells, cells.count >= 2 { start = location; columns = cells.count; count = 1; runEnd = location + length }
            }
            if found != nil { break }
            location += length + 1
        }
        close()
        guard let r = found, NSMaxRange(r) <= ns.length else { return nil }
        return r
    }
}

/// Turning lines with tabs or pipes into a markdown table (what the Table button does to them).
enum TableText {
    /// A line's cells, split on tabs or pipes; nil for a plain line or a markdown table line.
    static func cells(_ line: String) -> [String]? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return nil }
        // Already a markdown table (its rows start with a pipe, or it's the --- row).
        if t.hasPrefix("|") || t.allSatisfy({ "-:| ".contains($0) }) { return nil }
        let parts: [Substring]
        if t.contains("\t") {
            parts = t.split(separator: "\t", omittingEmptySubsequences: false)
        } else if t.contains("|") {
            parts = t.split(separator: "|", omittingEmptySubsequences: false)
        } else {
            return nil
        }
        let cells = parts.map { $0.trimmingCharacters(in: .whitespaces) }
        guard cells.count >= 2, cells.filter({ !$0.isEmpty }).count >= 2 else { return nil }
        return cells
    }

    /// The edit that turns the whole lines under `selection` into a table; nil for an empty
    /// selection or lines that aren't all table-like.
    static func edit(in text: String, selection: NSRange) -> TextEdit? {
        let ns = text as NSString
        guard selection.length > 0, NSMaxRange(selection) <= ns.length else { return nil }
        var lines = ns.lineRange(for: selection)
        // Keep the last line's break where it is.
        while lines.length > 0, ns.character(at: NSMaxRange(lines) - 1) == 10 { lines.length -= 1 }
        guard let table = markdown(ns.substring(with: lines).components(separatedBy: "\n")) else { return nil }
        return TextEdit(range: lines, replacement: table, caret: lines.location + (table as NSString).length)
    }

    /// The lines as a markdown table, the first line as its header. Nil unless 2+ lines have cells.
    static func markdown(_ lines: [String]) -> String? {
        let rows = lines.compactMap(cells)
        guard rows.count >= 2, rows.count == lines.filter({ !$0.trimmingCharacters(in: .whitespaces).isEmpty }).count else { return nil }
        let width = rows.map(\.count).max() ?? 0
        func row(_ cells: [String]) -> String {
            let padded = cells + Array(repeating: "", count: width - cells.count)
            return "| " + padded.map { $0.replacingOccurrences(of: "|", with: "\\|") }.joined(separator: " | ") + " |"
        }
        return ([row(rows[0]), "| " + Array(repeating: "---", count: width).joined(separator: " | ") + " |"] + rows.dropFirst().map(row))
            .joined(separator: "\n")
    }
}

// MARK: The tips

private var commonRules: [Tips.Rule] {
    [
        #Rule(PaneTips.activeDay) { $0.donations.count >= 3 },
        #Rule(PaneTips.$setupVisible) { $0 == false },
        #Rule(PaneTips.$calm) { $0 == true },
    ]
}

/// 1. After an AI edit lands on the open note, or a big deletion. Opens Show Version History.
struct VersionHistoryTip: Tip {
    var id: String { "versionHistory" }
    var title: Text { Text("Changed your mind?") }
    var message: Text? { Text("Every version of this note is kept. You can look back and restore any of them.") }
    var image: Image? { Image(systemName: "clock.arrow.circlepath") }
    var rules: [Rule] { commonRules + [#Rule(PaneTips.$historyMoment) { $0 == true }, #Rule(PaneTips.$turn) { $0 == "" || $0 == "versionHistory" }] }
    var options: [any TipOption] { [Tips.MaxDisplayCount(2)] }
    var actions: [Action] { [Action(id: "open", title: "Show Version History")] }
}

/// 2. A note long enough to send, or a checklist.
struct ShareLinkTip: Tip {
    var id: String { "shareLink" }
    var title: Text { Text("Send this note as a link") }
    var message: Text? { Text("Anyone with the link can read it in a browser, and it updates as you edit.") }
    var image: Image? { Image(systemName: "link") }
    var rules: [Rule] { commonRules + [#Rule(PaneTips.$noteIsLong) { $0 == true }, #Rule(PaneTips.$turn) { $0 == "" || $0 == "shareLink" }] }
    var options: [any TipOption] { [Tips.MaxDisplayCount(2)] }
}

/// 3. The first time you tick an item.
struct ChecklistTip: Tip {
    var id: String { "checklistTidy" }
    var title: Text { Text("Lists tidy themselves") }
    var message: Text? { Text("Ticked items move to the bottom, so what's left to do stays on top.") }
    var image: Image? { Image(systemName: "checklist") }
    var rules: [Rule] { commonRules + [#Rule(PaneTips.$justTicked) { $0 == true }, #Rule(PaneTips.$turn) { $0 == "" || $0 == "checklistTidy" }] }
    var options: [any TipOption] { [Tips.MaxDisplayCount(1)] }
}

/// 4. A note with lines that look like a table. Its action turns them into one.
struct TableTip: Tip {
    var id: String { "tableFromText" }
    var title: Text { Text("Turn this into a table") }
    var message: Text? { Text("Lines with tabs or | between words can become a table you can sort and chart.") }
    var image: Image? { Image(systemName: "tablecells") }
    var rules: [Rule] { commonRules + [#Rule(PaneTips.$noteHasTableText) { $0 == true }, #Rule(PaneTips.$turn) { $0 == "" || $0 == "tableFromText" }] }
    var options: [any TipOption] { [Tips.MaxDisplayCount(2)] }
    var actions: [Action] { [Action(id: "make", title: "Make Table")] }
}

/// 5. Mac: after a few days of use, the menu bar's quick capture.
struct MenuBarTip: Tip {
    var id: String { "menuBar" }
    var title: Text { Text("Jot a note from the menu bar") }
    var message: Text? { Text("Click Amber Notes in the menu bar to write or find a note without opening this window.") }
    var image: Image? { Image(systemName: "menubar.arrow.up.rectangle") }
    var rules: [Rule] {
        [
            #Rule(PaneTips.activeDay) { $0.donations.count >= 5 },
            #Rule(PaneTips.$setupVisible) { $0 == false },
            #Rule(PaneTips.$calm) { $0 == true },
            #Rule(PaneTips.$menuBarShown) { $0 == true },
            #Rule(PaneTips.$turn) { $0 == "" || $0 == "menuBar" },
        ]
    }
    var options: [any TipOption] { [Tips.MaxDisplayCount(2)] }
}

/// 6. iPhone: after an import, saving from other apps with Share.
struct ShareExtensionTip: Tip {
    var id: String { "shareExtension" }
    var title: Text { Text("Save from any app") }
    var message: Text? { Text("In Safari or any app, tap Share, then Amber Notes. It lands here as a note.") }
    var image: Image? { Image(systemName: "square.and.arrow.up") }
    var rules: [Rule] { commonRules + [#Rule(PaneTips.imported) { $0.donations.count >= 1 }, #Rule(PaneTips.$turn) { $0 == "" || $0 == "shareExtension" }] }
    var options: [any TipOption] { [Tips.MaxDisplayCount(2)] }
}

// MARK: Measuring

/// "Tip shown" and "feature used after the tip", counted on our own server like AI edits
/// (pane_tip_activity; no analytics SDK). Each is sent once per tip per install.
@MainActor
enum TipLog {
    static var client: SupabaseClient?
    /// Tests read what would have been sent.
    static var sent: [(tip: String, event: String)] = []
    static var defaults: UserDefaults = .standard

    private static func key(_ tip: String, _ event: String) -> String { "tipLog.\(tip).\(event)" }

    static func wasShown(_ tip: String) -> Bool { defaults.bool(forKey: key(tip, "shown")) }

    static func shown(_ tip: String) {
        PaneTips.turn = TipSpacing.shown(tip, defaults: defaults)
        record(tip, "shown")
    }

    /// You used the feature: its tip is done for good. Counted only if the tip was shown first.
    static func used(_ tip: some Tip) {
        tip.invalidate(reason: .actionPerformed)
        if wasShown(tip.id) { record(tip.id, "used") }
    }

    private static func record(_ tip: String, _ event: String) {
        guard !defaults.bool(forKey: key(tip, event)) else { return }
        defaults.set(true, forKey: key(tip, event))
        sent.append((tip, event))
        guard let client else { return }
        Task { _ = try? await client.rpc("pane_tip_event", params: ["tip": tip, "event": event]).execute() }
    }
}

extension View {
    /// Records the tip as shown the first time TipKit says it should display here.
    func logsTip(_ tip: some Tip) -> some View {
        task(id: tip.id) {
            for await show in tip.shouldDisplayUpdates where show {
                TipLog.shown(tip.id)
                break
            }
        }
    }
}
