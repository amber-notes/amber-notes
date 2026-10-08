#if os(macOS)
import AppKit
import Supabase
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// The Mac App Store screenshots' raw windows: the real app on the demo library, in off-screen
/// windows that `scripts/store-art/capture-mac.sh` photographs with `screencapture -l` (so the
/// sidebar and toolbar glass render; cacheDisplay can't draw them). Nothing appears on the display.
/// For each scene the test writes `ready-<scene>` (one `role window-number` per line) and waits for
/// the shell's `shot-<scene>`. Runs only when AMBER_STORE_FRAMES is set; the script sets it.
@MainActor @Suite(.serialized) struct MacStoreShots {
    static let main = CGSize(width: 1280, height: 800)

    static func window(_ view: some View, size: CGSize, dark: Bool) -> NSWindow {
        let w = KeyableWindow(contentRect: CGRect(x: -20000, y: -20000, width: size.width, height: size.height),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        // The test host is never the active app; draw controls as they look in your front window.
        w.contentViewController = NSHostingController(rootView: view.environment(\.controlActiveState, .key))
        w.setContentSize(size)
        w.setFrameOrigin(CGPoint(x: -20000, y: -20000))
        w.orderFrontRegardless()
        return w
    }

    static func root(_ c: ModelContainer, dark: Bool) -> NSWindow {
        window(RootView().modelContainer(c).environment(SetupStore()), size: main, dark: dark)
    }

    /// Sidebar and list widths that leave the note most of the window.
    static func columns(_ w: NSWindow) {
        if let split = AIEditSnapshots.splitView(in: w.contentView) {
            split.setPosition(220, ofDividerAt: 0)
            split.setPosition(540, ofDividerAt: 1)
        }
    }

    /// A small window of its own (the sheet's content), titled like a panel.
    static func panel(_ view: some View, size: CGSize, dark: Bool) -> NSWindow {
        window(view.frame(width: size.width, height: size.height).background(Color(nsColor: .windowBackgroundColor)), size: size, dark: dark)
    }

    static func shoot(_ dir: URL, _ scene: String, _ windows: [(String, NSWindow)]) async throws {
        for (_, w) in windows { w.makeKey() }
        try? await Task.sleep(for: .seconds(0.4))
        let lines = windows.map { "\($0.0) \($0.1.windowNumber)" }.joined(separator: "\n")
        try lines.write(to: dir.appending(path: "ready-\(scene)"), atomically: true, encoding: .utf8)
        let done = dir.appending(path: "shot-\(scene)")
        for _ in 0..<200 where !FileManager.default.fileExists(atPath: done.path) { try? await Task.sleep(for: .milliseconds(50)) }
        #expect(FileManager.default.fileExists(atPath: done.path), "the shell didn't capture \(scene)")
    }

    /// ChatGPT and Claude, both signed in (a token connection has no mark of its own).
    static let connections: [Connection] = [
        Connection(id: UUID(), name: "ChatGPT", kind: "oauth", can_write: true, created_at: .now.addingTimeInterval(-86400 * 3),
                   last_used_at: .now.addingTimeInterval(-720), revoked_at: nil, redirect_host: "chatgpt.com"),
        Connection(id: UUID(), name: "Claude", kind: "oauth", can_write: true, created_at: .now.addingTimeInterval(-86400),
                   last_used_at: .now.addingTimeInterval(-3 * 3600), revoked_at: nil, redirect_host: "claude.ai"),
    ]

    @Test func storeFrames() async throws {
        // Captured by window id from the shell, so on screen: CI only (AppSnapshotTests.onScreenAllowed).
        guard let dir = AppSnapshotTests.onScreenDir("AMBER_STORE_FRAMES") else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "capture")

        // 1: ChatGPT's change on the open note, tinted, with Undo on the receipt.
        do {
            let c = try AppSnapshotTests.container()
            try await AppSnapshotTests.withLastNote(c, "Groceries") {
                let w = Self.root(c, dark: false)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1))
                Self.columns(w)
                try? await Task.sleep(for: .seconds(1))
                Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
                try? await Task.sleep(for: .seconds(1.4))
                try await Self.shoot(dir, "1-ai-change", [("main", w)])
            }
        }

        // 2: Connect an AI, with ChatGPT and Claude Code connected, over the notes.
        do {
            let c = try AppSnapshotTests.container()
            try await AppSnapshotTests.withLastNote(c, "Lisbon") {
                let w = Self.root(c, dark: false)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1))
                Self.columns(w)
                let form = NavigationStack {
                    Form { ConnectAISection(client: client, preview: Self.connections) }
                        .formStyle(.grouped)
                        .navigationTitle("Connect an AI")
                }
                let p = Self.panel(form, size: CGSize(width: 560, height: 620), dark: false)
                defer { p.orderOut(nil); p.close() }
                try? await Task.sleep(for: .seconds(1.5))
                try await Self.shoot(dir, "2-connect", [("main", w), ("panel", p)])
            }
        }

        // 3: "Use this template", the site's real habit tracker, over the notes.
        do {
            let c = try AppSnapshotTests.container()
            try await AppSnapshotTests.withLastNote(c, "Evening tracker") {
                let w = Self.root(c, dark: false)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1))
                Self.columns(w)
                let template = try JSONDecoder().decode(NoteTemplate.self, from: Data(contentsOf: NoteSourceTests.habitTrackerFixture))
                let model = await NoteSourceCapture.model("template", context: c.mainContext, template: template)
                let p = Self.panel(NoteSourceSheet(model: model).modelContainer(c), size: CGSize(width: 520, height: 620), dark: false)
                defer { p.orderOut(nil); p.close() }
                try? await Task.sleep(for: .seconds(1.5))
                try await Self.shoot(dir, "3-template", [("main", w), ("panel", p)])
            }
        }

        // 4: Import from Apple Notes, the demo library of 1,284 notes, over the notes.
        do {
            AppleNotesBridge.forceDemo = true
            AppleNotesBridge.forceLarge = true
            defer { AppleNotesBridge.forceDemo = false; AppleNotesBridge.forceLarge = false }
            let c = try AppSnapshotTests.container()
            try await AppSnapshotTests.withLastNote(c, "Welcome to Pinto Notes") {
                let w = Self.root(c, dark: false)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1))
                Self.columns(w)
                // Short enough that only the demo's first, real-sounding names show.
                AppleNotesImportView.height = 470
                defer { AppleNotesImportView.height = 640 }
                let p = Self.panel(AppleNotesImportView().modelContainer(c), size: CGSize(width: 560, height: AppleNotesImportView.height), dark: false)
                defer { p.orderOut(nil); p.close() }
                try? await Task.sleep(for: .seconds(2))
                try await Self.shoot(dir, "4-import", [("main", w), ("panel", p)])
            }
        }

        // 5: Your notes, in dark mode: a trip plan open, and an amber dot on the note an AI edited.
        do {
            let c = try AppSnapshotTests.container()
            try await AppSnapshotTests.withLastNote(c, "Lisbon") {
                let w = Self.root(c, dark: true)
                defer { w.orderOut(nil); w.close() }
                try? await Task.sleep(for: .seconds(1))
                Self.columns(w)
                Capture.aiEdit(c.mainContext, title: "Groceries", scene: "paella", by: "ChatGPT")
                try? await Task.sleep(for: .seconds(1.5))
                try await Self.shoot(dir, "5-notes-dark", [("main", w)])
            }
        }
    }
}
#endif
