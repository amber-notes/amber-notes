#if os(macOS)
import AppKit
import Supabase
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Before and after pictures for the website design study, drawn offscreen with cacheDisplay.
/// `AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/DesignStudySnapshots`. Motion is written
/// as numbered frames under `frames/<name>/` with each frame's time in ms, for ffmpeg.
@MainActor @Suite(.serialized) struct DesignStudySnapshots {
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

    /// 1 and 2: an AI's edit lands on the open note. Before: the text just changes. After: the
    /// changed lines tint and fade, and a receipt says who did it.
    @Test(arguments: [false, true])
    func aiEditOnOpenNote(study: Bool) async throws {
        guard Self.dir != nil else { return }
        DesignStudy.on = study
        defer { DesignStudy.on = false }
        let c = try AppSnapshotTests.container()
        let tag = study ? "after" : "before"
        try await AppSnapshotTests.withLastNote(c, "Groceries") {
            let w = Self.window(Self.root(c), size: Self.size)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            try Self.snap(w, "01-ai-highlight-mac-\(tag)-start")
            DesignStudy.fakeAIEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            if study {
                try await Self.record(w, "ai-edit-mac", seconds: 8.5)
            } else {
                try? await Task.sleep(for: .seconds(1.2))
            }
            try Self.snap(w, "01-ai-highlight-mac-\(tag)-end")
        }
    }

    /// The resting tint and receipt, held still for a clean picture (light and dark).
    @Test(arguments: [false, true])
    func aiEditHeld(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        DesignStudy.on = true
        defer { DesignStudy.on = false }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Groceries") {
            let w = Self.window(Self.root(c), size: Self.size, dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            DesignStudy.fakeAIEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.6))
            try Self.snap(w, "01-ai-highlight-mac-after\(dark ? "-dark" : "")")
        }
    }

    /// 3: an AI edits a note you don't have open. After: an amber dot and "Edited by Claude" in the list.
    @Test(arguments: [false, true])
    func aiEditInList(study: Bool) async throws {
        guard Self.dir != nil else { return }
        DesignStudy.on = study
        defer { DesignStudy.on = false }
        let c = try AppSnapshotTests.container()
        try await AppSnapshotTests.withLastNote(c, "Evening tracker") {
            let w = Self.window(Self.root(c), size: Self.size)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1.2))
            DesignStudy.fakeAIEdit(c.mainContext, title: "Lisbon", scene: "lisbon", by: "Claude")
            DesignStudy.fakeAIEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
            try? await Task.sleep(for: .seconds(1.0))
            try Self.snap(w, "03-list-marker-mac-\(study ? "after" : "before")")
        }
    }

    /// 4: Connect an AI in Settings.
    @Test(arguments: [false, true])
    func connect(study: Bool) async throws {
        guard Self.dir != nil else { return }
        DesignStudy.on = study
        defer { DesignStudy.on = false }
        let client = SupabaseClientStub.make()
        let form = Form { ConnectAISection(client: client, preview: CaptureScreen.connections) }.formStyle(.grouped).frame(width: 520, height: 620)
        try await AppSnapshotTests.render(form, name: "04-connect-ai-mac-\(study ? "after" : "before")", dark: false, wait: 1.0)
    }

    /// 5: the Get set up card, at step 2 and step 3, in the real window.
    @Test(arguments: [false, true])
    func setup(study: Bool) async throws {
        guard Self.dir != nil else { return }
        DesignStudy.on = study
        defer { DesignStudy.on = false }
        let tag = study ? "after" : "before"
        let c = try AppSnapshotTests.container()
        for (step, p) in [("step2", SetupProgress(imported: true)), ("step3", SetupProgress(imported: true, connected: true))] {
            try await AppSnapshotTests.withLastNote(c, "Evening tracker") {
                let w = Self.window(Self.root(c, setup: p), size: Self.size)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1.2))
                try Self.snap(w, "05-setup-card-mac-\(step)-\(tag)")
                // The list sometimes draws late offscreen: a second look.
                w.contentView?.needsLayout = true
                try? await Task.sleep(for: .seconds(2.0))
                try Self.snap(w, "05-setup-card-mac-\(step)-\(tag)-late")
            }
            let card = SetupCard(progress: p, celebrating: false, onImport: {}, onStartFresh: {}, onConnect: {}, onHide: {})
                .frame(width: 330).padding(16).background(Color(nsColor: .windowBackgroundColor))
            try await AppSnapshotTests.render(card, name: "05-setup-card-mac-\(step)-\(tag)-card", dark: false)
        }
    }

    /// 6: sign in.
    @Test(arguments: [false, true])
    func signIn(study: Bool) async throws {
        guard Self.dir != nil else { return }
        DesignStudy.on = study
        defer { DesignStudy.on = false }
        try await AppSnapshotTests.shoot(SignInView(backend: Backend()).fixedSize().containerBackground(for: .window) { Backdrop() },
                                         name: "06-sign-in-mac-\(study ? "after" : "before")", size: CGSize(width: 380, height: 520), dark: false, toolbar: false)
    }
}

enum SupabaseClientStub {
    static func make() -> SupabaseClient { SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test") }
}
#endif
