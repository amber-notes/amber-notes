import SwiftData
import SwiftUI

/// Screenshots and recordings only (`-uitest`): an AI's edit played on a demo note, as if a
/// sync had just brought it.
///   `-aiEdit Groceries -aiScene paella -aiBy ChatGPT -aiAfter 2.5`
enum Capture {
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
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let title = argument("-aiEdit") else { return }
        let delay = argument("-aiAfter").flatMap(Double.init) ?? 2.5
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            aiEdit(context, title: title, scene: argument("-aiScene") ?? "paella", by: argument("-aiBy") ?? "ChatGPT")
        }
    }
}

#if os(macOS)
/// The website demo, captured from a real front window (so it looks focused):
///   `-uitest -demo -open Groceries -captureDemo <dir>`
/// The app sizes its window to 1180×560 pt with the site's column widths, then plays every
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
        w.setContentSize(NSSize(width: 1180, height: 560))
        w.center()
        NSApp.activate()
        w.makeKeyAndOrderFront(nil)
        await wait(1)
        split(in: w.contentView)?.setPosition(208, ofDividerAt: 0)
        split(in: w.contentView)?.setPosition(468, ofDividerAt: 1)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? "\(w.windowNumber)".write(to: dir.appending(path: "window-id"), atomically: true, encoding: .utf8)
        await wait(1)
        func shoot(_ name: String) async {
            // Something else may have come forward meanwhile (an install, a notification): take the front again.
            if !NSApp.isActive || !w.isKeyWindow {
                NSApp.activate()
                w.makeKeyAndOrderFront(nil)
                await wait(0.5)
            }
            try? "".write(to: dir.appending(path: "ready-\(name)"), atomically: true, encoding: .utf8)
            let done = dir.appending(path: "shot-\(name)")
            for _ in 0..<60 where !FileManager.default.fileExists(atPath: done.path) { await wait(0.05) }
        }
        // Nothing is focused until the caret frame, like the site's other frames.
        w.makeFirstResponder(nil)

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
        await wait(1.3)
        await shoot("scene1-tint")
        await wait(6.5)
        await shoot("scene1-faded")

        let old = note.body, oldAt = note.aiEditedAt
        note.body = DemoData.apply("bought", to: old)
        note.updatedAt = .now
        note.aiEditor = "ChatGPT"
        note.aiEditedAt = .now
        AIEdit.arrived(note, previousBody: old, previousEditAt: oldAt, quiet: false)
        await wait(1.3)
        await shoot("scene2-tint")
        await wait(6.5)
        await shoot("scene2-faded")

        // "What's still left to buy?" changes nothing: the lines it read are tinted, no receipt.
        guard let editor = editors(in: w.contentView).first(where: { $0.string.contains("Paella rice") }) else { return }
        editor.tintChanges(from: note.body.components(separatedBy: "\n").filter { !$0.hasPrefix("- [ ]") }.joined(separator: "\n"))
        await wait(1.3)
        await shoot("scene3-tint")
        await wait(4.5)
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
                              found.count, f.minX, 560 - f.maxY, f.width, f.height, c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent,
                              Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
            try? info.write(to: dir.appending(path: "caret.json"), atomically: true, encoding: .utf8)
        }
        try? "".write(to: dir.appending(path: "finished"), atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }
}
#endif
