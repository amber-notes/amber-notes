#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Note apps (prototype), the best-apps set on the Mac: each app in the real app, in an off-screen
/// window at a typical size, light and dark. Photographed by `scripts/best-apps-mac.sh` with
/// `screencapture -l`. Nothing appears on the display. Runs only when AMBER_BEST_MAC is set.
@MainActor @Suite(.serialized) struct BestAppsMacShots {
    static let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "demo/note-pages/best")

    static func open(_ title: String, size: CGSize, dark: Bool) async throws -> NSWindow {
        let c = try AppSnapshotTests.container()
        Capture.bestApps(c.mainContext, dir: dir)
        // As if the forecast's host had been allowed once already (the iPhone recording shows the question).
        if let rome = ((try? c.mainContext.fetch(FetchDescriptor<Note>())) ?? []).first(where: { $0.title == "Rome" }) {
            NotePageNetLog.shared.approve("api.open-meteo.com", for: rome.id)
        }
        let w = await AppSnapshotTests.withLastNote(c, title) {
            let w = MacStoreShots.window(RootView().modelContainer(c).environment(SetupStore()), size: size, dark: dark)
            try? await Task.sleep(for: .seconds(1))
            if let split = AIEditSnapshots.splitView(in: w.contentView) {
                // The app gets the room: the sidebar and the list are folded in to their narrowest.
                split.setPosition(0, ofDividerAt: 0)
                split.setPosition(0, ofDividerAt: 1)
            }
            return w
        }
        // Maps, covers and the forecast arrive after the first frame.
        try? await Task.sleep(for: .seconds(4))
        return w
    }

    @Test func frames() async throws {
        guard let out = ProcessInfo.processInfo.environment["AMBER_BEST_MAC"].map({ URL(fileURLWithPath: $0) }) else { return }
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let only = ProcessInfo.processInfo.environment["AMBER_BEST_ONLY"].flatMap { $0.isEmpty ? nil : $0 }.map { Set($0.split(separator: ",").map(String.init)) }
        let apps = [("habits", "Habits"), ("money", "Money"), ("training", "Training"), ("reading", "Reading"),
                    ("trip", "Rome"), ("people", "People"), ("kitchen", "Kitchen"), ("study", "Biology: the cell")]
        for (name, title) in apps where only?.contains(name) ?? true {
            for dark in [false, true] {
                let w = try await Self.open(title, size: CGSize(width: 1440, height: 920), dark: dark)
                defer { w.orderOut(nil); w.close() }
                try await MacStoreShots.shoot(out, "\(name)-mac-\(dark ? "dark" : "light")", [("main", w)])
            }
        }
    }
}
#endif
