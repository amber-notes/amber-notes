import EventKit
import QuartzCore
import SwiftData
import SwiftUI

/// Screenshots and recordings only (`-uitest`): an AI's edit played on a demo note, as if a
/// sync had just brought it.
///   `-aiEdit Groceries -aiScene paella -aiBy ChatGPT -aiAfter 2.5`
enum Capture {
    /// Captures: the held "landed" moment (tint and receipt) is over.
    static let clearAIMarks = Notification.Name("pane.captureClearAIMarks")

    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// What an AI might do to a demo note, as the website's demo tells it.
    static func edited(_ body: String, scene: String) -> String {
        switch scene {
        case "paella":
            return body.replacingOccurrences(of: "- [ ] Oat milk", with: "- [ ] Paella rice\n- [ ] Saffron\n- [ ] Chorizo\n- [ ] Chicken thighs\n- [ ] Smoked paprika\n- [ ] Oat milk")
        case "lisbon":
            return body.replacingOccurrences(of: "- [ ] Day trip to Sintra", with: "- [ ] Day trip to Sintra\n- [ ] Late checkout requested, confirm by 10 May")
        case "oateggs":
            // "Add oat milk and eggs to my groceries."
            return body.replacingOccurrences(of: "- [ ] Lemons", with: "- [ ] Oat milk\n- [ ] Eggs\n- [ ] Lemons")
        case "standup":
            return body + "\n- Today: review the importer PR, then pair on table editing"
        default:
            return body
        }
    }

    /// The note changes the way a synced AI edit changes it: new text, the AI's name and time
    /// (which the server sets), then the same bookkeeping the sync engine does.
    @MainActor static func aiEdit(_ context: ModelContext, title: String, scene: String, by ai: String) {
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        guard let note = notes.first(where: { $0.title == title && $0.deletedAt == nil }) else { return }
        let old = note.body, oldAt = note.aiEditedAt
        let new = edited(old, scene: scene)
        guard new != old else { return }
        note.body = new
        note.updatedAt = .now
        note.aiEditor = ai
        note.aiEditedAt = .now
        AIEdit.arrived(note, previousBody: old, previousEditAt: oldAt, quiet: false)
    }

    @MainActor static func scheduleFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest") else { return }
        // `-seedLisbon edited`: the website's Lisbon note as it ends up (after the Sintra edit),
        // in place of the demo's own Lisbon trip; open it with `-open "Lisbon, 4 days in May"`.
        if let state = argument("-seedLisbon") {
            let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
            for n in notes where n.title == "Lisbon" || n.title == "Hotel booking" || n.title == "Trip documents" { context.purge(n) }
            let travel = context.allFolders().first { $0.name == "Travel" }
            _ = context.createNote(in: travel.map { .folder($0.id) } ?? .all, body: state == "edited" ? lisbonEdit(lisbonNote) : lisbonNote)
            try? context.save()
        }
        let delay = argument("-aiAfter").flatMap(Double.init) ?? 2.5
        if let title = argument("-aiEdit") {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                aiEdit(context, title: title, scene: argument("-aiScene") ?? "paella", by: argument("-aiBy") ?? "ChatGPT")
            }
        }
        // Several AIs at once: `-aiEdits "Groceries:paella:ChatGPT|Lisbon:lisbon:Claude|Standup notes:standup:Claude Code"`,
        // applied in order, a few seconds apart in their times, so the last one listed is the newest.
        if let list = argument("-aiEdits") {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                for edit in list.split(separator: "|") {
                    let parts = edit.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
                    guard parts.count == 3 else { continue }
                    aiEdit(context, title: parts[0], scene: parts[1], by: parts[2])
                }
            }
        }
    }
}

/// Locked notes, for screenshots (`-uitest`): a bank note, and the notes password "demo".
///   `-lockCapture setup`    the note open, with the Set Password sheet
///   `-lockCapture confirm`  the note open, asking to lock it
///   `-lockCapture locked`   the note locked (open it with `-open "Bank details"` for the lock screen)
///   `-lockCapture open`     the note locked and unlocked, showing its text
extension Capture {
    static let lockCapture = Notification.Name("pane.captureLock")
    static let bankNote = "Bank details\n\nIBAN SE45 5000 0000 0583 9825 7466\nCard PIN 4821\n\n- [ ] Order the new card\n- [x] Tell the bank about the move"

    @MainActor static func lockedNotesFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let state = argument("-lockCapture") else { return }
        let note = context.createNote(in: .all, body: bankNote)
        note.isPinned = true
        try? context.save()
        Task { @MainActor in
            if state != "setup" {
                let vault = NoteVault.shared
                try? await vault.setUp(password: "demo", hint: "The usual one")
                if state != "confirm" { try? vault.lock(note) }
                if state == "locked" { vault.lockNow() }
                try? context.save()
            }
            // The note on screen shows the sheet or the question once it's up.
            try? await Task.sleep(for: .seconds(1.5))
            NotificationCenter.default.post(name: lockCapture, object: state)
        }
    }
}

/// The website's Lisbon note, on every platform.
extension Capture {
    static let lisbonNote = """
    Lisbon, 4 days in May

    Tiles, trams and pastries, at an easy pace.

    > Pastéis de nata before 10, trams after 10.

    ## Day by day
    - [ ] Day 1 Alfama and the castle
    - [ ] Day 2 Belém
    - [ ] Day 3 LX Factory
    - [ ] Day 4 Cascais

    ## Where to eat
    | Place | Dish |
    | --- | --- |
    | Ramiro | Seafood |
    | Manteigaria | Pastel de nata |
    | Time Out Market | A bit of everything |

    ## Pack
    - Comfortable shoes
    - A light jacket for the evenings
    """

    /// "Swap day 3 for a day trip to Sintra, and add a dinner spot."
    static func lisbonEdit(_ body: String) -> String {
        body.replacingOccurrences(of: "- [ ] Day 3 LX Factory", with: "- [ ] Day 3 Sintra, Pena Palace early")
            .replacingOccurrences(of: "| Time Out Market | A bit of everything |", with: "| Time Out Market | A bit of everything |\n| Cervejaria Trindade | Steak |")
    }

}

#if os(macOS)
/// The Apple Notes import sheet, from a real front window, for the website and the App Store:
///   `-uitest -demo -importLarge -open Groceries -importSheet -captureImport <dir>`
/// Writes the sheet's window id, then `ready-import-sheet` (everything picked, the button ready)
/// and `ready-import-progress` (half done), each waiting for `shot-<name>`; then quits.
extension Capture {
    static let importHalfway = Notification.Name("pane.captureImportHalfway")

    @MainActor static func importSequenceFromArguments() {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let path = argument("-captureImport") else { return }
        let dir = URL(fileURLWithPath: path)
        Task { @MainActor in
            @MainActor func wait(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }
            var sheet: NSWindow?
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for _ in 0..<600 where sheet == nil {
                sheet = NSApp.windows.compactMap(\.attachedSheet).first
                if sheet == nil { await wait(0.1) }
            }
            guard let sheet, let parent = sheet.sheetParent else {
                let seen = NSApp.windows.map { "\($0.windowNumber) \(type(of: $0)) \($0.frame) visible:\($0.isVisible) sheet:\($0.isSheet)" }
                try? seen.joined(separator: "\n").write(to: dir.appending(path: "no-sheet.txt"), atomically: true, encoding: .utf8)
                return
            }
            if let screen = NSScreen.screens.max(by: { $0.backingScaleFactor < $1.backingScaleFactor }) {
                let v = screen.visibleFrame
                parent.setFrameOrigin(NSPoint(x: v.midX - parent.frame.width / 2, y: v.midY - parent.frame.height / 2))
            }
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try? "\(sheet.windowNumber)".write(to: dir.appending(path: "window-id"), atomically: true, encoding: .utf8)
            await wait(2)
            @MainActor func shoot(_ name: String) async {
                for _ in 0..<10 where !NSApp.isActive {
                    NSApp.activate(ignoringOtherApps: true)
                    parent.orderFrontRegardless()
                    await wait(0.3)
                }
                await wait(0.4)
                try? "".write(to: dir.appending(path: "ready-\(name)"), atomically: true, encoding: .utf8)
                let done = dir.appending(path: "shot-\(name)")
                for _ in 0..<400 where !FileManager.default.fileExists(atPath: done.path) { await wait(0.05) }
            }
            await shoot("import-sheet")
            NotificationCenter.default.post(name: importHalfway, object: nil)
            await wait(0.8)
            await shoot("import-progress")
            try? "".write(to: dir.appending(path: "finished"), atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
        }
    }
}

/// The website's Lisbon story: ChatGPT writes a whole note, then makes one precise edit.
extension Capture {
    /// A note an AI wrote, arriving the way a synced one does (this device didn't have it).
    @MainActor static func aiCreate(_ context: ModelContext, body: String, in folder: Folder?, by ai: String) -> Note {
        let note = context.createNote(in: folder.map { .folder($0.id) } ?? .all, body: body)
        note.aiEditor = ai
        note.aiEditedAt = .now
        AIEdit.arrived(note, previousBody: nil, previousEditAt: nil, quiet: false)
        try? context.save()
        return note
    }

    @MainActor static func lisbonStory(_ context: ModelContext, k: Double, shoot: (String) async -> Void) async {
        func wait(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        // The demo library's own Lisbon trip would read as a second one: this story starts without it.
        for n in notes where n.title == "Lisbon" || n.title == "Hotel booking" || n.title == "Trip documents" { context.purge(n) }
        // Nothing pinned, so the new note lands at the very top of the list.
        for n in notes where n.isPinned { n.isPinned = false }
        try? context.save()
        await wait(1.2)
        await shoot("lisbon-0-before")

        // 1: ChatGPT writes the note. It appears at the top of the list with its dot…
        let travel = context.allFolders().first { $0.name == "Travel" }
        let lisbon = aiCreate(context, body: lisbonNote, in: travel, by: "ChatGPT")
        await wait(1.2)
        await shoot("lisbon-1-listed")
        // …and opening it shows everything it wrote, tinted, with the receipt.
        NoteOpener.shared.open(lisbon.id)
        await wait(1.6 * k)
        await shoot("lisbon-1-tint-and-pill")
        await release(wait)
        await shoot("lisbon-1-faded")

        // 2: one precise edit on the open note.
        let old = lisbon.body, oldAt = lisbon.aiEditedAt
        lisbon.body = lisbonEdit(old)
        lisbon.updatedAt = .now
        lisbon.aiEditor = "ChatGPT"
        lisbon.aiEditedAt = .now
        AIEdit.arrived(lisbon, previousBody: old, previousEditAt: oldAt, quiet: false)
        await wait(1.3 * k)
        await shoot("lisbon-2-tint-and-pill")
        await release(wait)
        await shoot("lisbon-2-faded")
    }

    /// Clears the held tint and receipt (the faded state), and waits for them to leave.
    @MainActor static func release(_ wait: (Double) async -> Void) async {
        NotificationCenter.default.post(name: clearAIMarks, object: nil)
        await wait(1.0)
    }

}

/// The website demo, captured from a real front window (so it looks focused):
///   `-uitest -demo -open Groceries -captureDemo <dir>`
/// The app sizes its window to 1180×560 pt (`-captureHeight 720` for the tall one) with the site's column widths, then plays every
/// frame in one run: the intro, before, the three scenes and the caret. For each frame it writes
/// `ready-<name>` into `dir` and waits for `shot-<name>`, which the shell writes after
/// `screencapture -l <window-id>`. It quits by itself at the end. No input events.
extension Capture {
    @MainActor static func demoSequenceFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let path = argument("-captureDemo") else { return }
        Task { @MainActor in await demoSequence(context, dir: URL(fileURLWithPath: path)) }
    }

    @MainActor private static func demoSequence(_ context: ModelContext, dir: URL) async {
        func wait(_ s: Double) async { try? await Task.sleep(for: .seconds(s)) }
        func editors(in view: NSView?) -> [PaneTextView] {
            guard let view else { return [] }
            return (view as? PaneTextView).map { [$0] } ?? view.subviews.flatMap { editors(in: $0) }
        }
        func split(in view: NSView?) -> NSSplitView? {
            guard let view else { return nil }
            if let s = view as? NSSplitView { return s }
            for v in view.subviews { if let s = split(in: v) { return s } }
            return nil
        }
        var window: NSWindow?
        for _ in 0..<100 where window == nil {
            window = NSApp.windows.first { w in editors(in: w.contentView).contains { $0.string.hasPrefix("Groceries") } }
            if window == nil { await wait(0.1) }
        }
        guard let w = window, let note = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).first(where: { $0.title == "Groceries" }) else { return }
        let height = argument("-captureHeight").flatMap(Double.init) ?? 560
        // A busy Mac takes seconds per screencapture: `-captureSlow 4` stretches the tint and receipt to match.
        let k = argument("-captureSlow").flatMap(Double.init) ?? 1
        ChangeTint.slowMotion = k
        // Each "landed" frame holds still until it's taken, however long a busy Mac takes.
        ChangeTint.holdForCapture = true
        w.setContentSize(NSSize(width: 1180, height: height))
        // On a Retina screen, so the frames come out at 2x.
        if let screen = NSScreen.screens.max(by: { $0.backingScaleFactor < $1.backingScaleFactor }) {
            let f = w.frame, v = screen.visibleFrame
            w.setFrameOrigin(NSPoint(x: v.midX - f.width / 2, y: v.midY - f.height / 2))
        } else {
            w.center()
        }
        NSApp.activate()
        w.makeKeyAndOrderFront(nil)
        await wait(1)
        split(in: w.contentView)?.setPosition(208, ofDividerAt: 0)
        split(in: w.contentView)?.setPosition(468, ofDividerAt: 1)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? "\(w.windowNumber)".write(to: dir.appending(path: "window-id"), atomically: true, encoding: .utf8)
        await wait(1)
        // Counts every time something else takes the front, so a frame caught mid-way is taken again.
        final class Resigns: @unchecked Sendable { var count = 0 }
        let resigns = Resigns()
        let observer = NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in resigns.count += 1 }
        defer { NotificationCenter.default.removeObserver(observer) }
        func shoot(_ name: String) async {
            let ready = dir.appending(path: "ready-\(name)"), done = dir.appending(path: "shot-\(name)")
            for _ in 0..<4 {
                // Something else may have come forward meanwhile (an install, a notification): take the front again.
                // Cooperative activation is ignored while another app is in front; this one isn't.
                for _ in 0..<10 where !(NSApp.isActive && w.isKeyWindow) {
                    NSApp.activate(ignoringOtherApps: true)
                    w.orderFrontRegardless()
                    w.makeKey()
                    await wait(0.3)
                }
                await wait(0.3)
                let before = resigns.count
                try? "".write(to: ready, atomically: true, encoding: .utf8)
                for _ in 0..<400 where !FileManager.default.fileExists(atPath: done.path) { await wait(0.05) }
                if resigns.count == before && NSApp.isActive { return }
                // Not in front the whole time: take it again.
                try? FileManager.default.removeItem(at: ready)
                try? FileManager.default.removeItem(at: done)
            }
        }
        // Nothing is focused until the caret frame, like the site's other frames.
        w.makeFirstResponder(nil)

        if argument("-demoStory") == "lisbon" {
            await lisbonStory(context, k: k, shoot: shoot)
            try? "".write(to: dir.appending(path: "finished"), atomically: true, encoding: .utf8)
            NSApp.terminate(nil)
            return
        }

        let full = note.body
        for scene in ["pretype", "pretype1"] {
            note.body = DemoData.apply(scene, to: full)
            await wait(0.8)
            await shoot("intro-\(scene)")
        }
        note.body = full
        await wait(0.8)
        await shoot("scene0-before")

        aiEdit(context, title: "Groceries", scene: "paella", by: "ChatGPT")
        await wait(1.3 * k)
        await shoot("scene1-tint")
        await wait(6.5 * k)
        await shoot("scene1-faded")

        let old = note.body, oldAt = note.aiEditedAt
        note.body = DemoData.apply("bought", to: old)
        note.updatedAt = .now
        note.aiEditor = "ChatGPT"
        note.aiEditedAt = .now
        AIEdit.arrived(note, previousBody: old, previousEditAt: oldAt, quiet: false)
        await wait(1.3 * k)
        await shoot("scene2-tint")
        await wait(6.5 * k)
        await shoot("scene2-faded")

        // "What's still left to buy?" changes nothing: the lines it read are tinted, no receipt.
        guard let editor = editors(in: w.contentView).first(where: { $0.string.contains("Paella rice") }) else { return }
        editor.tintChanges(from: note.body.components(separatedBy: "\n").filter { !$0.hasPrefix("- [ ]") }.joined(separator: "\n"))
        await wait(1.3 * k)
        await shoot("scene3-tint")
        await wait(4.5 * k)
        await shoot("scene3-faded")

        // The caret after "Cherry tomatoes", held on rather than blinking.
        w.makeFirstResponder(editor)
        let at = NSMaxRange((editor.string as NSString).range(of: "Cherry tomatoes"))
        editor.setSelectedRange(NSRange(location: at, length: 0))
        await wait(0.4)
        func indicators(in view: NSView) -> [NSTextInsertionIndicator] {
            ((view as? NSTextInsertionIndicator).map { [$0] } ?? []) + view.subviews.flatMap { indicators(in: $0) }
        }
        let found = indicators(in: w.contentView ?? editor)
        found.forEach { $0.displayMode = .visible }
        await wait(0.4)
        await shoot("caret-after-cherry-tomatoes")
        if let i = found.first {
            let f = i.convert(i.bounds, to: nil)
            let base = i.color ?? NSColor.textInsertionPointColor
            let c = base.usingColorSpace(.sRGB) ?? base
            let info = String(format: "{\"indicators_found\": %d, \"x_pt\": %.1f, \"y_from_top_pt\": %.1f, \"width_pt\": %.1f, \"height_pt\": %.1f, \"srgb\": [%.3f, %.3f, %.3f, %.3f], \"hex\": \"#%02X%02X%02X\"}",
                              found.count, f.minX, height - f.maxY, f.width, f.height, c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent,
                              Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
            try? info.write(to: dir.appending(path: "caret.json"), atomically: true, encoding: .utf8)
        }
        try? "".write(to: dir.appending(path: "finished"), atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }
}
#endif

/// Note pages (prototype, NotePage), for recordings: a habit tracker and a budget as plain
/// markdown tables, and pages arriving as a sync would bring them.
///   `-pageDemo`                                   seeds the two notes
///   `-seedPage "Budget=/path/budget.html"`        a page already there (made by Claude)
///   `-aiPage "Habit tracker=/path/page.html" -aiPageBy Claude -aiAfter 3`   one arriving later
///   `-seedData "Habit tracker=/path/data.json"`   the app's own data for that note
///   `-seedNote /path/note.md` (repeatable)       a note from a file, before the pages above
extension Capture {
    /// Fourteen days of habits, ending yesterday with gaps, and today's row half done.
    static func habitNote(today: Date = .now) -> String {
        let marks = ["✓✓·✓", "✓✓✓✓", "·✓✓·", "✓✓✓✓", "✓·✓✓", "✓✓✓·", "··✓✓", "✓✓✓✓", "✓✓·✓", "✓✓✓✓", "✓·✓✓", "✓✓✓✓", "✓✓✓·", "✓✓✓✓", "✓···"]
        var rows: [String] = []
        for (i, m) in marks.enumerated() {
            let d = Calendar.current.date(byAdding: .day, value: i - (marks.count - 1), to: today)!
            rows.append("| \(TypedTable.day(d)) | " + m.map { $0 == "✓" ? "✓" : " " }.joined(separator: " | ") + " |")
        }
        return "Habit tracker\n\nSmall things, most days. A ✓ means done.\n\n| Date | Walk | Read | Stretch | No phone in bed |\n| --- | --- | --- | --- | --- |\n"
            + rows.joined(separator: "\n") + "\n"
    }

    static let budgetNote = """
    October budget

    Spending for the month. Amounts in kronor.

    | Date | Item | Category | Amount |
    | --- | --- | --- | --- |
    | 2026-10-01 | Rent | Home | 9200 |
    | 2026-10-01 | Groceries | Food | 640 |
    | 2026-10-02 | Train card | Travel | 970 |
    | 2026-10-02 | Lunch with Sara | Food | 185 |
    | 2026-10-03 | Groceries | Food | 410 |
    | 2026-10-03 | Phone | Home | 299 |
    | 2026-10-04 | Cinema | Fun | 290 |

    - [ ] Cancel the old gym membership
    - [x] Move savings on payday
    """

    @MainActor static func notePagesFromArguments(_ context: ModelContext) {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest") else { return }
        // `-seedNote /path/note.md`, as often as needed: notes from files (the first line is the title).
        for (i, a) in args.enumerated() where a == "-seedNote" && i + 1 < args.count {
            if let body = try? String(contentsOfFile: args[i + 1], encoding: .utf8) { _ = context.createNote(in: .all, body: body) }
        }
        if args.contains("-pageDemo") {
            let budget = context.createNote(in: .all, body: budgetNote)
            budget.updatedAt = .now.addingTimeInterval(-90)
            let habits = context.createNote(in: .all, body: habitNote())
            habits.isPinned = true
            try? context.save()
        }
        // `-showcase <dir>`: the habit tracker with reminders, meeting prep, a trip log and a weather app.
        if let dir = argument("-showcase") {
            showcase(context, pages: URL(fileURLWithPath: dir))
        }
        // `-widgetDemo <dir>`: "Budget 2026" with three sub-notes that are apps, shown as widgets.
        if let dir = argument("-widgetDemo") {
            budgetWithWidgets(context, pages: URL(fileURLWithPath: dir))
        }
        func note(_ title: String) -> Note? {
            ((try? context.fetch(FetchDescriptor<Note>())) ?? []).first { $0.title == title && $0.deletedAt == nil }
        }
        func split(_ arg: String) -> (Note, String)? {
            guard let eq = arg.firstIndex(of: "=") else { return nil }
            let path = String(arg[arg.index(after: eq)...])
            guard let n = note(String(arg[..<eq])), let html = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
            return (n, html)
        }
        // `-seedData "Title=/path/data.json"`: the app's own data ({values, collections}) for that note.
        if let arg = argument("-seedData"), let eq = arg.firstIndex(of: "="), let n = note(String(arg[..<eq])),
           let json = try? Data(contentsOf: URL(fileURLWithPath: String(arg[arg.index(after: eq)...]))) {
            NotePageDataStore.shared.set(n.id, NotePageData.decode(json))
        }
        let by = argument("-aiPageBy") ?? "Claude"
        if let arg = argument("-seedPage"), let (n, html) = split(arg) {
            NotePageStore.shared[n.id] = .init(html: html, by: by, at: .now.addingTimeInterval(-3600))
        }
        // `-aiPages "Title=/a.json,/b.json" -aiEvery 6`: an AI saves several versions in a row.
        if let arg = argument("-aiPages"), let eq = arg.firstIndex(of: "=") {
            let title = String(arg[..<eq]), paths = arg[arg.index(after: eq)...].split(separator: ",").map(String.init)
            let first = argument("-aiAfter").flatMap(Double.init) ?? 4, every = argument("-aiEvery").flatMap(Double.init) ?? 6
            for (i, path) in paths.enumerated() {
                DispatchQueue.main.asyncAfter(deadline: .now() + first + every * Double(i)) {
                    if let n = note(title), let html = try? String(contentsOfFile: path, encoding: .utf8) {
                        NotePageStore.shared[n.id] = .init(html: html, by: by, at: .now)
                    }
                }
            }
        }
        if let arg = argument("-aiPage") {
            let delay = argument("-aiAfter").flatMap(Double.init) ?? 2.5
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if let (n, html) = split(arg) { NotePageStore.shared[n.id] = .init(html: html, by: by, at: .now) }
            }
        }
        // `-aiDataRemove "Title=log:3"`: an AI removes the last 3 records of that collection
        // through MCP while the app is open. Arrives as the server's copy would after a pull (what
        // was here counts as synced first, as it would be after a push).
        if let arg = argument("-aiDataRemove"), let eq = arg.firstIndex(of: "="), let colon = arg.lastIndex(of: ":") {
            let title = String(arg[..<eq]), name = String(arg[arg.index(after: eq)..<colon]), count = Int(arg[arg.index(after: colon)...]) ?? 1
            let delay = argument("-aiAfter").flatMap(Double.init) ?? 6
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard let n = note(title) else { return }
                let store = NotePageDataStore.shared
                var doc = store.doc(n.id)
                store.pushed(n.id, NotePageData.encode(doc))
                var collections = doc["collections"] as? NotePageData.Doc ?? [:]
                var list = collections[name] as? [NotePageData.Doc] ?? []
                list.removeLast(min(count, list.count))
                collections[name] = list
                doc["collections"] = collections
                store.take(n.id, server: NotePageData.encode(doc), by: argument("-aiPageBy") ?? "Claude")
            }
        }
    }
}

extension Capture {
    /// A budget note with prose and three apps inside it: spending by month, adding an expense, and
    /// a savings goal kept in the app's own data.
    @MainActor static func budgetWithWidgets(_ context: ModelContext, pages: URL) {
        let parent = context.createNote(in: .all, body: "Budget 2026")
        parent.isPinned = true
        func app(_ body: String, _ file: String) -> Note {
            let n = context.createSubNote(of: parent, body: body)
            if !ProcessInfo.processInfo.arguments.contains("-widgetLinksOnly"), let html = try? String(contentsOf: pages.appending(path: file), encoding: .utf8) {
                NotePageStore.shared[n.id] = .init(html: html, by: "Claude", at: .now.addingTimeInterval(-3600))
            }
            return n
        }
        let months = ["January", "February", "March", "April", "May", "June", "July", "August", "September"]
        let spend = [(9200, 3100, 900, 600), (9200, 2900, 1400, 450), (9200, 3300, 700, 800), (9200, 2700, 2100, 500), (9200, 3000, 4800, 900),
                     (9200, 2600, 1200, 1500), (9200, 3400, 3900, 700), (9200, 2800, 800, 400), (9200, 2950, 1100, 650)]
        let chart = app("Spending by month\n\n| Month | Home | Food | Travel | Fun |\n| --- | --- | --- | --- | --- |\n"
            + zip(months, spend).map { "| \($0) | \($1.0) | \($1.1) | \($1.2) | \($1.3) |" }.joined(separator: "\n") + "\n", "spending-chart.html")
        let today = TypedTable.day(.now)
        let form = app("Add an expense\n\n| Date | Item | Category | Amount |\n| --- | --- | --- | --- |\n"
            + "| \(today) | Groceries | Food | 640 |\n| \(today) | Train card | Travel | 970 |\n| \(today) | Cinema | Fun | 290 |\n", "expense-form.html")
        let savings = app("Savings: Lisbon trip\n\nMoney put aside for Lisbon in May. The deposits are kept in the app.", "savings-goal.html")
        var data = NotePageData.empty()
        data["values"] = ["goal": 15000]
        let stamp = ISO8601DateFormatter()
        data["collections"] = ["deposits": [(1000, 40), (2500, 30), (1500, 21), (2000, 9), (1400, 2)].enumerated().map { i, d in
            ["id": "d\(i)", "amount": d.0, "created": stamp.string(from: .now.addingTimeInterval(-86400 * Double(d.1))), "updated": stamp.string(from: .now)] as [String: Any]
        }]
        NotePageDataStore.shared.set(savings.id, data)
        func link(_ n: Note) -> String { "[\(n.title)](pane-note:\(n.id.uuidString.lowercased()))" }
        parent.body = """
        Budget 2026

        The plan for the year: spend less on eating out, and save for Lisbon in May.

        ## Spending
        Rent is the same all year. Food is down from last year; travel spiked in May.
        \(link(chart))

        ## This month
        \(link(form))

        ## Saving
        \(link(savings))

        ## Notes
        - Rent goes up in January, check the new contract
        - Cancel the old gym membership
        """
        parent.touch()
        try? context.save()
    }
}

#if os(iOS)
/// Measurements only (`-uitest -frameProbe`): frame times from 5 s after launch, written each second
/// to Documents/frame-probe.txt as "frames hitches longest_ms" (a hitch: a frame over 1.5x the
/// display's interval).
@MainActor
final class FrameProbe: NSObject {
    static var shared: FrameProbe?
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var frames = 0, hitches = 0
    private var longest: CFTimeInterval = 0
    private let start = CACurrentMediaTime()
    private var written: CFTimeInterval = 0

    static func startFromArguments() {
        guard ProcessInfo.processInfo.arguments.contains("-frameProbe") else { return }
        let p = FrameProbe()
        p.link = CADisplayLink(target: p, selector: #selector(tick(_:)))
        p.link?.add(to: .main, forMode: .common)
        shared = p
    }

    @objc private func tick(_ l: CADisplayLink) {
        let now = l.timestamp
        defer { last = now }
        guard now - start > 5, last > 0 else { return }
        let dt = now - last, target = l.targetTimestamp - l.timestamp
        frames += 1
        longest = max(longest, dt)
        if dt > max(target, 1.0 / 120) * 1.5 { hitches += 1 }
        if now - written > 1 {
            written = now
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appending(path: "frame-probe.txt")
            try? "\(frames) \(hitches) \(String(format: "%.1f", longest * 1000))".write(to: url, atomically: true, encoding: .utf8)
        }
    }
}
#endif

extension Capture {
    /// Four notes that are apps, for the showcase recordings, and today's meetings in Calendar
    /// (`-seedCalendar`; demo events made by the app, for the simulator, which has none).
    @MainActor static func showcase(_ context: ModelContext, pages: URL) {
        func app(_ body: String, _ file: String, pinned: Bool = false) {
            let n = context.createNote(in: .all, body: body)
            n.isPinned = pinned
            if let html = try? String(contentsOf: pages.appending(path: file), encoding: .utf8) {
                NotePageStore.shared[n.id] = .init(html: html, by: "Claude", at: .now.addingTimeInterval(-3600))
            }
        }
        app(habitNote(), "habit-reminders.html", pinned: true)
        app("Meeting prep\n\nToday's meetings, from Calendar. Prep notes stay in the app until I save them.\n\n## Today\n", "meeting-prep.html")
        app("Lisbon trip log\n\nFour days in May. Places, photos and the weather are kept in the app.", "trip-log.html")
        app("Weather\n\nLisbon\n", "weather-key.html")
        try? context.save()
        if ProcessInfo.processInfo.arguments.contains("-seedCalendar") {
            Task { @MainActor in
                let store = EKEventStore()
                guard (try? await store.requestFullAccessToEvents()) == true, let cal = store.defaultCalendarForNewEvents else { return }
                let day = Calendar.current.startOfDay(for: .now)
                let existing = store.events(matching: store.predicateForEvents(withStart: day, end: day.addingTimeInterval(86400), calendars: nil))
                guard existing.isEmpty else { return }
                for (title, h, m, len, place) in [("Design review: new onboarding", 9, 30, 45, "Room 4"), ("1:1 with Sara", 11, 0, 30, "Video call"),
                                                  ("Lunch with Jonas", 12, 30, 60, "Time Out Market"), ("Q4 planning", 15, 0, 60, "Room 2")] {
                    let e = EKEvent(eventStore: store)
                    e.title = title
                    e.location = place
                    e.startDate = Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: day)!
                    e.endDate = e.startDate.addingTimeInterval(Double(len) * 60)
                    e.calendar = cal
                    try? store.save(e, span: .thisEvent)
                }
            }
        }
    }
}
