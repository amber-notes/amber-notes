#if os(macOS)
import AppKit
import Supabase
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Pictures of an AI's edit arriving (tint, receipt, list marker) and of the screens that came
/// from the website, drawn offscreen with cacheDisplay.
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/AIEditSnapshots`. Motion is
/// written as numbered frames under `frames/<name>/` with each frame's time in ms, for ffmpeg.
@MainActor @Suite(.serialized) struct AIEditSnapshots {
    static var dir: URL? { AppSnapshotTests.dir }

    static func window(_ view: some View, size: CGSize, dark: Bool = false) -> NSWindow {
        let window = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: size.width, height: size.height),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentViewController = NSHostingController(rootView: view)
        window.setContentSize(size)
        window.setFrameOrigin(CGPoint(x: -30000, y: -30000))
        window.orderFrontRegardless()
        return window
    }

    static func snap(_ window: NSWindow, to url: URL) throws {
        guard let frame = window.contentView?.superview else { return }
        let rep = try #require(frame.bitmapImageRepForCachingDisplay(in: frame.bounds))
        frame.cacheDisplay(in: frame.bounds, to: rep)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: url)
    }

    static func snap(_ window: NSWindow, _ name: String) throws {
        guard let dir else { return }
        try snap(window, to: dir.appending(path: "\(name).png"))
    }

    /// Frames for `seconds`, as fast as cacheDisplay allows; each file is named by its time.
    static func record(_ window: NSWindow, _ name: String, seconds: Double) async throws {
        guard let dir else { return }
        let start = Date.now
        var i = 0
        while Date.now.timeIntervalSince(start) < seconds {
            let ms = Int(Date.now.timeIntervalSince(start) * 1000)
            try snap(window, to: dir.appending(path: "frames/\(name)/\(String(format: "%04d", i))-\(ms).png"))
            i += 1
            try? await Task.sleep(for: .milliseconds(25))
        }
    }

    static func root(_ c: ModelContainer, setup: SetupProgress? = nil) -> some View {
        RootView().modelContainer(c).environment(SetupStore(progress: setup))
    }

    static let size = CGSize(width: 1180, height: 760)

    /// The tint and receipt arriving on the open note, recorded in slow motion.
    @Test func aiEditOnOpenNote() async throws {
        guard Self.dir != nil else { return }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Groceries") {
            let w = Self.window(Self.root(c), size: Self.size)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            try Self.snap(w, "01-ai-highlight-mac-start")
            ChangeTint.slowMotion = 5
            defer { ChangeTint.slowMotion = 1 }
            try await Self.record(w, "ai-edit-mac-lead", seconds: 0.6)
            Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try await Self.record(w, "ai-edit-mac", seconds: 8.5 * 5)
            try Self.snap(w, "01-ai-highlight-mac-end")
        }
    }

    /// The resting tint and receipt, held still for a clean picture (light and dark).
    @Test(arguments: [false, true])
    func aiEditHeld(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Groceries") {
            let w = Self.window(Self.root(c), size: Self.size, dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.6))
            try Self.snap(w, "01-ai-highlight-mac\(dark ? "-dark" : "")")
        }
    }

    /// AI edits to notes that aren't open: an amber dot and "Edited by Claude" in the list.
    @Test func aiEditInList() async throws {
        guard Self.dir != nil else { return }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Evening tracker") {
            let w = Self.window(Self.root(c), size: Self.size)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            Capture.aiEdit(c.mainContext, title: "Lisbon", scene: "lisbon", by: "Claude")
            Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.0))
            try Self.snap(w, "03-list-marker-mac")
        }
    }

    @Test func connect() async throws {
        guard Self.dir != nil else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        let form = Form { ConnectAISection(client: client, preview: CaptureScreen.connections) }.formStyle(.grouped).frame(width: 520, height: 540)
        try await AppSnapshotTests.render(form, name: "04-connect-ai-mac", dark: false, wait: 1.0)
    }

    /// The Get set up card at each step and after your AI's first edit, light and dark, at the
    /// list's width, in a key window so the prominent button shows its colour.
    @Test(arguments: [false, true])
    func setup(dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        let states: [(String, SetupProgress, Bool)] = [
            ("step1", SetupProgress(), false),
            ("step2", SetupProgress(imported: true), false),
            ("step3", SetupProgress(imported: true, connected: true), false),
            ("done", SetupProgress(imported: true, connected: true, aiEdits: 1), true),
        ]
        for (name, p, celebrating) in states {
            let card = SetupCard(progress: p, celebrating: celebrating, onImport: {}, onStartFresh: {}, onConnect: {}, onHide: {})
                .tint(Color(PColor.paneAccent))
                // The test host never becomes the active app; draw controls as they look in your front window.
                .environment(\.controlActiveState, .key)
                .frame(width: 290)
                .padding(10)
                .background(Color(nsColor: .textBackgroundColor))
            let host = NSHostingView(rootView: card)
            host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            let w = KeyableWindow(contentRect: CGRect(x: -30000, y: -30000, width: 310, height: 300), styleMask: [.borderless], backing: .buffered, defer: false)
            w.isReleasedWhenClosed = false
            w.contentView = host
            host.frame = CGRect(origin: .zero, size: host.fittingSize)
            w.setContentSize(host.fittingSize)
            w.orderFrontRegardless()
            w.makeKey()
            try? await Task.sleep(for: .seconds(0.6))
            defer { w.orderOut(nil); w.close() }
            let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: rep)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "setup-a-mac-\(name)-\(dark ? "dark" : "light").png"))
        }
    }

    @Test func signIn() async throws {
        guard Self.dir != nil else { return }
        try await AppSnapshotTests.shoot(SignInView(backend: Backend()).fixedSize().containerBackground(for: .window) { Backdrop() },
                                         name: "06-sign-in-mac", size: CGSize(width: 380, height: 520), dark: false, toolbar: false)
    }

    // MARK: Website demo frames

    /// The website's demo frames, captured by `screencapture -l` from the shell so the sidebar
    /// and toolbar glass render (cacheDisplay can't draw them). The window sits far off every
    /// screen; nothing appears on the display. The test writes `window-id`, then for each frame
    /// a `ready-<name>` file, and waits for the shell to write `shot-<name>`.
    /// `TEST_RUNNER_AMBER_DEMO_FRAMES=/path scripts/qa-test.sh 'PaneTests/AIEditSnapshots/demoFrames()'`
    @Test func demoFrames() async throws {
        guard let dir = ProcessInfo.processInfo.environment["AMBER_DEMO_FRAMES"].map({ URL(fileURLWithPath: $0) }) else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Groceries") {
            let w = Self.window(Self.root(c), size: CGSize(width: 1180, height: 720))
            defer { w.orderOut(nil); w.close() }
            try "\(w.windowNumber)".write(to: dir.appending(path: "window-id"), atomically: true, encoding: .utf8)
            // The columns of the website's existing captures: sidebar 208 pt, list to 468 pt.
            try? await Task.sleep(for: .seconds(1))
            if let split = Self.splitView(in: w.contentView) {
                split.setPosition(208, ofDividerAt: 0)
                split.setPosition(468, ofDividerAt: 1)
            }
            func shoot(_ name: String) async throws {
                try "".write(to: dir.appending(path: "ready-\(name)"), atomically: true, encoding: .utf8)
                let done = dir.appending(path: "shot-\(name)")
                for _ in 0..<60 where !FileManager.default.fileExists(atPath: done.path) { try? await Task.sleep(for: .milliseconds(50)) }
            }
            try? await Task.sleep(for: .seconds(2))
            try await shoot("scene0-before")
            let note = try #require(((try? c.mainContext.fetch(FetchDescriptor<Note>())) ?? []).first { $0.title == "Groceries" })

            // 1: ChatGPT adds what Sunday's paella needs.
            Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.3))
            try await shoot("scene1-tint")
            try? await Task.sleep(for: .seconds(6.5))
            try await shoot("scene1-faded")

            // 2: it ticks off the lemons and coffee (ticked items sit with the others that are done).
            let bought = note.body.replacingOccurrences(of: "- [ ] Lemons\n- [ ] Coffee beans\n", with: "")
                .replacingOccurrences(of: "- [x] Sourdough", with: "- [x] Lemons\n- [x] Coffee beans\n- [x] Sourdough")
            let old = note.body, oldAt = note.aiEditedAt
            note.body = bought
            note.updatedAt = .now
            note.aiEditor = "ChatGPT"
            note.aiEditedAt = .now
            AIEdit.arrived(note, previousBody: old, previousEditAt: oldAt, quiet: false)
            try? await Task.sleep(for: .seconds(1.3))
            try await shoot("scene2-tint")
            try? await Task.sleep(for: .seconds(6.5))
            try await shoot("scene2-faded")

            // 3: "What's still left to buy?" changes nothing; the lines it read are tinted, with no receipt.
            let editor = try #require(Self.textViews(in: w.contentView).first { $0.string.contains("Paella rice") })
            let left = note.body.components(separatedBy: "\n").filter { !$0.hasPrefix("- [ ]") }.joined(separator: "\n")
            editor.tintChanges(from: left)
            #expect(!editor.core.layoutDelegate.tint.ranges.isEmpty)
            try? await Task.sleep(for: .seconds(1.3))
            try await shoot("scene3-tint")
            try? await Task.sleep(for: .seconds(4.5))
            try await shoot("scene3-faded")
        }
        // The receipt on its own, on a clear ground with room for its shadow.
        for (name, lines) in [("receipt-scene1", 5), ("receipt-scene2", 2)] {
            let r = AIEdit.Receipt(noteID: UUID(), by: "ChatGPT", at: .now, previous: "", lines: lines)
            let host = NSHostingView(rootView: AIReceipt(receipt: r, undo: {}).padding(24).fixedSize())
            host.appearance = NSAppearance(named: .aqua)
            let win = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: 400, height: 100), styleMask: [.borderless], backing: .buffered, defer: false)
            win.isReleasedWhenClosed = false
            win.isOpaque = false
            win.backgroundColor = .clear
            win.contentView = host
            host.frame = CGRect(origin: .zero, size: host.fittingSize)
            win.setContentSize(host.fittingSize)
            try? await Task.sleep(for: .seconds(0.4))
            defer { win.close() }
            let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: rep)
            try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "\(name).png"))
        }
    }

    static func textViews(in view: NSView?) -> [PaneTextView] {
        guard let view else { return [] }
        return (view as? PaneTextView).map { [$0] } ?? view.subviews.flatMap { textViews(in: $0) }
    }

    static func splitView(in view: NSView?) -> NSSplitView? {
        guard let view else { return nil }
        if let s = view as? NSSplitView { return s }
        for v in view.subviews { if let s = splitView(in: v) { return s } }
        return nil
    }
}
#endif
