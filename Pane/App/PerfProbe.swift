#if os(macOS)
import AppKit
import OSLog
import QuartzCore
import SwiftData

/// Timings of the real app on a real screen, for performance work (`-uitest` only):
///   `-uitest -perfProbe /tmp/probe.json [-perfNotes 2000]`
/// Seeds a library (the notes, a 5,000-line note and a note of tables and links), then plays
/// launch, opening notes, sidebar toggles, typing, search and folder switches the way the
/// app's own controls do them, never with synthetic input events. Every frame is timed on the
/// display link; the results go to the file as JSON and the app quits.
@MainActor
final class PerfProbe: NSObject {
    static var shared: PerfProbe?

    private let out: URL
    private let context: ModelContext
    private var link: CADisplayLink?
    /// Frame times since the current step began.
    private var frames: [CFTimeInterval] = []
    private var refresh: CFTimeInterval = 1.0 / 60
    private var results: [[String: Any]] = []
    /// Each step as an interval, for Instruments (Points of Interest).
    private let signposter = OSSignposter(subsystem: "dev.emilwagman.pane", category: .pointsOfInterest)

    static func startFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let path = Capture.argument("-perfProbe") else { return }
        let probe = PerfProbe(out: URL(fileURLWithPath: path), context: context)
        shared = probe
        Task { await probe.run() }
    }

    /// Seeded once the window is up: a library this size, made before the first scene, kept
    /// the window from opening when launched from a script.
    private func seed() {
        let context = self.context
        let count = Capture.argument("-perfNotes").flatMap(Int.init) ?? 2000
        let folders = (0..<6).map { context.createFolder(named: "Folder \($0)") }
        for i in 0..<count {
            let n = Note(body: "Note \(i)\n\nSome text for note \(i), with **bold** and a list:\n- one\n- two\n", folder: folders[i % folders.count])
            n.updatedAt = .now.addingTimeInterval(-Double(i) * 3600)
            context.insert(n)
        }
        let long = context.createNote(in: .folder(folders[0].id), body: Self.longNote())
        long.updatedAt = .now
        let blocks = context.createNote(in: .folder(folders[0].id), body: Self.blockyNote())
        blocks.updatedAt = .now.addingTimeInterval(-60)
        try? context.save()
    }

    private init(out: URL, context: ModelContext) {
        self.out = out
        self.context = context
    }

    // MARK: Scenarios

    private func run() async {
        // The window's first frame after launch.
        var waited = 0
        while window == nil {
            try? await Task.sleep(for: .milliseconds(5))
            waited += 1
            // Launched over ssh the app can start inactive, with its window not yet shown.
            if waited == 400 { NSApp.activate() }
            if waited % 400 == 0 { note(NSApp.windows.map { "\(type(of: $0)) \($0.frame) visible \($0.isVisible) \(type(of: $0.contentView as Any))" }.joined(separator: "; ")) }
        }
        startLink()
        while frames.isEmpty { try? await Task.sleep(for: .milliseconds(1)) }
        record("launch to first frame", ["ms": (frames[0] - Self.processStart) * 1000])
        try? await Task.sleep(for: .seconds(1))
        let seedStart = CACurrentMediaTime()
        frames = []
        seed()
        try? await Task.sleep(for: .seconds(2))
        summarize("library arrives", since: seedStart)
        try? await Task.sleep(for: .seconds(2))
        let memStart = Self.footprintMB()

        // `-perfOnly sidebar|typing|open|search|folders -perfRepeat N`: one scenario, N times
        // (default 1 pass of the usual counts), for a sampler to watch.
        let only = Capture.argument("-perfOnly")
        let times = Capture.argument("-perfRepeat").flatMap(Int.init) ?? 1
        func runs(_ name: String) -> Bool { only == nil || only == name }

        if runs("sidebar") {
            for title in only == nil ? ["Note 1", "Long note", "Blocks"] : [Capture.argument("-perfNote") ?? "Note 1"] {
                await step("open \(title)", settle: 0.6) { self.open(title) }
                try? await Task.sleep(for: .seconds(1.5))
                for i in 0..<(6 * times) {
                    await step("sidebar \(i % 2 == 0 ? "hide" : "show") [\(title)]", settle: 0.9, sidebar: true) {
                        NSApp.sendAction(#selector(NSSplitViewController.toggleSidebar(_:)), to: nil, from: nil)
                    }
                    try? await Task.sleep(for: .milliseconds(400))
                }
            }
        }

        if runs("open") {
            for i in 0..<(4 * times) {
                let title = ["Note 3", "Note 4", "Long note", "Note 5"][i % 4]
                await step("open \(title == "Long note" ? title : "a short note")", settle: 0.8) { self.open(title) }
            }
        }

        // What each write of the open note costs the rest of the window (the editor writes the
        // note every 0.35 s while you type): the note changes the way the editor changes it.
        // A note arriving from another device: inserted and saved, as sync does (`-perfOnly arrive`).
        if runs("arrive") {
            open("Note 1")
            try? await Task.sleep(for: .seconds(1.5))
            for i in 0..<(6 * times) {
                await step("a note arrives", settle: 0.6) {
                    _ = self.context.createNote(in: .all, body: "Arrived \(i)\n\nfrom sync")
                    try? self.context.save()
                }
            }
        }

        if runs("save") {
            open("Note 1")
            try? await Task.sleep(for: .seconds(1.5))
            let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
            if let note = notes.first(where: { $0.title == "Note 1" }) {
                for _ in 0..<(20 * times) {
                    await step("save the open note", settle: 0.35) {
                        note.body += "a"
                        note.touch()
                    }
                    // Signed in, the push that follows marks the note sent and saves.
                    await step("sync after the save", settle: 0.35) {
                        note.serverVersion += 1
                        note.dirty = false
                        try? self.context.save()
                    }
                }
            }
        }

        // What the sidebar's counts read from the store as notes are made, deleted and recovered,
        // before anything is saved (`-perfOnly counts`; not timed).
        if only == "counts" {
            try? await Task.sleep(for: .seconds(1))
            func counts() -> [Int] {
                [(try? context.fetchCount(FetchDescriptor<Note>(predicate: #Predicate { $0.deletedAt == nil && $0.trashedAt == nil }))) ?? -1,
                 (try? context.fetchCount(FetchDescriptor<Note>(predicate: #Predicate { $0.deletedAt == nil && $0.trashedAt != nil }))) ?? -1]
            }
            var seen: [String: Any] = ["start": counts()]
            let made = context.createNote(in: .all, body: "Counted\n\nNew")
            seen["made"] = counts()
            try? await Task.sleep(for: .seconds(0.6))
            made.trashedAt = .now
            seen["trashed"] = counts()
            try? await Task.sleep(for: .seconds(0.6))
            made.trashedAt = nil
            seen["restored"] = counts()
            record("counts", seen)
        }

        // Typing in the long note, one key every 120 ms: the frames show what each key and save cost.
        if runs("typing") {
            open("Long note")
            try? await Task.sleep(for: .seconds(1.5))
            if let text = editor {
                window?.makeFirstResponder(text)
                text.setSelectedRange(NSRange(location: (text.string as NSString).length / 2, length: 0))
                var keys: [Double] = []
                try? await Task.sleep(for: .milliseconds(500))
                frames = []
                let begin = CACurrentMediaTime()
                for _ in 0..<(25 * times) {
                    let t = CACurrentMediaTime()
                    text.insertText("a", replacementRange: text.selectedRange())
                    keys.append((CACurrentMediaTime() - t) * 1000)
                    try? await Task.sleep(for: .milliseconds(120))
                }
                try? await Task.sleep(for: .milliseconds(500))
                summarize("typing 25 keys [Long note]", since: begin, extra: ["keyMedianMs": keys.sorted()[keys.count / 2], "keyMaxMs": keys.max() ?? 0])
            }
        }

        // Search as you type, through the toolbar's search field.
        if runs("search"), let field = searchField, let w = window {
            for _ in 0..<times {
                w.makeFirstResponder(field)
                try? await Task.sleep(for: .milliseconds(300))
                frames = []
                let begin = CACurrentMediaTime()
                for ch in "note 12" {
                    (field.currentEditor() as? NSTextView)?.insertText(String(ch), replacementRange: NSRange(location: NSNotFound, length: 0))
                    try? await Task.sleep(for: .milliseconds(150))
                }
                try? await Task.sleep(for: .milliseconds(500))
                summarize("search 7 chars", since: begin)
                (field.currentEditor() as? NSTextView)?.selectAll(nil)
                (field.currentEditor() as? NSTextView)?.insertText("", replacementRange: NSRange(location: NSNotFound, length: 0))
                try? await Task.sleep(for: .seconds(1))
            }
        }

        // Switching folders in the sidebar.
        if runs("folders"), let outline = sidebarTable {
            for _ in 0..<times {
                for row in [2, 3, 1, 4, 0, 2] where row < outline.numberOfRows {
                    await step("folder switch", settle: 0.6) { outline.selectRowIndexes([row], byExtendingSelection: false) }
                    try? await Task.sleep(for: .milliseconds(300))
                }
            }
        }

        record("memory", ["startMB": memStart, "endMB": Self.footprintMB()])
        finish()
    }

    /// Runs an action and times the frames until things settle: the sidebar has stopped
    /// moving, or `settle` seconds have passed.
    private func step(_ name: String, settle: Double, sidebar: Bool = false, _ action: () -> Void) async {
        frames = []
        let interval = signposter.beginInterval("probe step", "\(name, privacy: .public)")
        defer { signposter.endInterval("probe step", interval) }
        let begin = CACurrentMediaTime()
        action()
        if sidebar {
            // Settled: the sidebar's width unchanged for 3 frames in a row.
            var last = -1.0, still = 0, settledAt = begin
            while CACurrentMediaTime() - begin < 2 {
                try? await Task.sleep(for: .milliseconds(4))
                let w = Double(sidebarWidth)
                if w == last { still += 1 } else { still = 0; settledAt = CACurrentMediaTime(); last = w }
                if still >= 3 && CACurrentMediaTime() - begin > 0.1 { break }
            }
            summarize(name, since: begin, extra: ["settledMs": (settledAt - begin) * 1000])
        } else {
            try? await Task.sleep(for: .seconds(settle))
            summarize(name, since: begin)
        }
    }

    private func summarize(_ name: String, since begin: CFTimeInterval, extra: [String: Any] = [:]) {
        var gaps: [Double] = []
        var prev = begin
        for f in frames { gaps.append((f - prev) * 1000); prev = f }
        let longest = gaps.max() ?? 0
        let hitches = gaps.filter { $0 > refresh * 1000 * 1.5 }
        var fields: [String: Any] = ["frames": frames.count, "longestFrameMs": longest,
                                     "hitches": hitches.count, "hitchMs": hitches.reduce(0) { $0 + $1 - refresh * 1000 },
                                     "firstFrameMs": gaps.first ?? 0]
        fields.merge(extra) { $1 }
        record(name, fields)
    }

    /// Progress, beside the results, for when a run doesn't finish.
    private func note(_ line: String) {
        let url = out.appendingPathExtension("log")
        let old = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (old + line + "\n").write(to: url, atomically: true, encoding: .utf8)
    }

    private func record(_ name: String, _ fields: [String: Any]) {
        var row = fields
        row["step"] = name
        results.append(row)
    }

    private func finish() {
        let doc: [String: Any] = ["refreshHz": (1 / refresh).rounded(), "notes": (try? context.fetchCount(FetchDescriptor<Note>())) ?? 0,
                                  "machine": Host.current().localizedName ?? "", "results": results]
        if let data = try? JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: out) }
        NSApp.terminate(nil)
    }

    // MARK: The window's parts

    private var window: NSWindow? {
        NSApp.windows.first { $0.isVisible && $0.contentView.flatMap { Self.find(NSSplitView.self, in: $0) } != nil }
    }

    /// Looked up once: walking the window's views every few milliseconds would show up in the timings.
    private lazy var split: NSSplitView? = window?.contentView.flatMap { Self.find(NSSplitView.self, in: $0) }

    private var sidebarWidth: CGFloat {
        guard let first = split?.arrangedSubviews.first else { return -1 }
        return first.isHidden ? 0 : first.frame.width
    }

    private var editor: PaneTextView? { window?.contentView.flatMap { Self.find(PaneTextView.self, in: $0) } }

    private var sidebarTable: NSTableView? {
        guard let split = window?.contentView.flatMap({ Self.find(NSSplitView.self, in: $0) }), let first = split.arrangedSubviews.first else { return nil }
        return Self.find(NSTableView.self, in: first)
    }

    private var searchField: NSSearchField? {
        guard let items = window?.toolbar?.items else { return nil }
        return items.compactMap { ($0 as? NSSearchToolbarItem)?.searchField }.first
    }

    private func open(_ title: String) {
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        if let n = notes.first(where: { $0.title == title }) { NoteOpener.shared.request = n.id }
    }

    private static func find<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
        if let v = view as? T { return v }
        for s in view.subviews { if let v = find(type, in: s) { return v } }
        return nil
    }

    // MARK: Clocks

    private func startLink() {
        guard let view = window?.contentView else { return }
        let l = view.displayLink(target: self, selector: #selector(tick(_:)))
        l.add(to: .main, forMode: .common)
        link = l
    }

    @objc private func tick(_ l: CADisplayLink) {
        refresh = max(1.0 / 240, l.targetTimestamp - l.timestamp)
        frames.append(CACurrentMediaTime())
    }

    /// When this process started, on the media clock.
    private static var processStart: CFTimeInterval {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        sysctl(&mib, 4, &info, &size, nil, 0)
        let start = info.kp_proc.p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1e6
        return CACurrentMediaTime() - (Date().timeIntervalSince1970 - started)
    }

    private static func footprintMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
    }

    // MARK: Notes

    /// The same shapes as the tests' PerfFixtures: headings, lists, checklists, links, quotes.
    private static func longNote(lines: Int = 5000) -> String {
        var out = ["Long note"]
        var i = 0
        while out.count < lines {
            switch i % 12 {
            case 0: out.append("## Section \(i / 12)")
            case 1: out.append("A paragraph with **bold**, *italic*, `code` and a [link](https://example.com/\(i)) in it, long enough to wrap on a narrow window.")
            case 2: out.append("- Bullet item \(i)")
            case 3: out.append("  - Nested item \(i)")
            case 4: out.append("- [ ] Open task \(i)")
            case 5: out.append("- [x] Done task \(i)")
            case 6: out.append("1. Numbered \(i)")
            case 7: out.append("> A quote \(i)")
            case 9: out.append("Plain line \(i) ~~struck~~ <u>underlined</u>")
            case 8, 10: out.append("")
            default: out.append("Another line of ordinary text for line \(i).")
            }
            i += 1
        }
        return out.joined(separator: "\n")
    }

    private static func blockyNote(tables: Int = 10, embeds: Int = 20) -> String {
        var out = ["Blocks", ""]
        for t in 0..<tables {
            out.append("Table \(t)")
            out.append("| Name | Value | Note |")
            out.append("| --- | --- | --- |")
            for r in 0..<6 { out.append("| Row \(r) | \(r * t) | something \(r) |") }
            out.append("")
            for e in 0..<(embeds / tables) {
                out.append("https://example.com/\(t)/\(e)")
                out.append("")
            }
        }
        return out.joined(separator: "\n")
    }
}
#endif
