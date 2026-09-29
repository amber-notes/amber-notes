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

    @Test func setup() async throws {
        guard Self.dir != nil else { return }
        for (step, p) in [("step2", SetupProgress(imported: true)), ("step3", SetupProgress(imported: true, connected: true))] {
            let card = SetupCard(progress: p, celebrating: false, onImport: {}, onStartFresh: {}, onConnect: {}, onHide: {})
                .frame(width: 330).padding(16).background(Color(nsColor: .windowBackgroundColor))
            try await AppSnapshotTests.render(card, name: "05-setup-card-mac-\(step)", dark: false)
        }
    }

    @Test func signIn() async throws {
        guard Self.dir != nil else { return }
        try await AppSnapshotTests.shoot(SignInView(backend: Backend()).fixedSize().containerBackground(for: .window) { Backdrop() },
                                         name: "06-sign-in-mac", size: CGSize(width: 380, height: 520), dark: false, toolbar: false)
    }
}
#endif
