import SwiftData
import SwiftUI
import Testing
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// The import sheets (Evernote, Markdown…) in each of their states (no files yet, files picked, importing, done),
/// light and dark, for the website's blog. Offscreen: nothing touches the screen. Runs only when
/// AMBER_HIG_SHOTS is set. Mac: `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh
/// PaneTests/ImportSheetSnapshots`; iPhone: the same test on a simulator (see the test).
@MainActor @Suite(.serialized) struct ImportSheetSnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }

    /// Made-up exports for each kind: Evernote's three notebooks, about 1,500 notes; an Obsidian
    /// vault and a Notion export.
    static func sources(_ kind: ImportKind) -> [ImportSource] {
        switch kind {
        case .evernote: evernote
        case .keep: [ImportSource(url: URL(fileURLWithPath: "/demo/takeout-20260930T101500Z-001.zip"), name: "Google Keep", notes: 842, bytes: 61_400_000)]
        case .markdown: [
            ImportSource(url: URL(fileURLWithPath: "/demo/Second brain"), name: "Second brain", notes: 1_126, bytes: 88_300_000),
            ImportSource(url: URL(fileURLWithPath: "/demo/Notion export.zip"), name: "Notion export", notes: 363, bytes: 24_100_000),
        ]
        }
    }

    static let evernote = [
        ImportSource(url: URL(fileURLWithPath: "/demo/Recipes.enex"), name: "Recipes", notes: 188, bytes: 41_200_000),
        ImportSource(url: URL(fileURLWithPath: "/demo/Work.enex"), name: "Work", notes: 1_204, bytes: 312_000_000),
        ImportSource(url: URL(fileURLWithPath: "/demo/Travel journal.enex"), name: "Travel journal", notes: 97, bytes: 18_400_000),
    ]

    static var summary: ImportSummary {
        var s = ImportSummary()
        s.notes = 1_482
        s.attachments = 356
        s.alreadyImported = 4
        s.empty = 3
        s.filesMissing = 1
        s.encrypted = 2
        return s
    }

    static func states(_ kind: ImportKind) -> [(name: String, phase: ImportSheet.Phase, sources: [ImportSource])] {
        let s = sources(kind)
        var done = summary
        if kind == .markdown { done.encrypted = 0; done.notNotes = 41 }
        if kind == .keep {
            done.encrypted = 0
            done.filesMissing = 0
            done.archived = 37
            done.dropped = ["212 notes had colors, which Amber Notes doesn't have.", "3 notes had reminders, which Amber Notes doesn't keep."]
        }
        return [("empty", .choosing, []), ("files", .choosing, s), ("progress", .importing(done: 642, total: 1_489), s), ("summary", .finished(done), s)]
    }

    static func container() throws -> ModelContainer {
        let c = try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        for name in ["Notes", "Recipes", "Work"] { _ = c.mainContext.createFolder(named: name) }
        return c
    }

    static func sheet(_ kind: ImportKind, _ state: (name: String, phase: ImportSheet.Phase, sources: [ImportSource]), _ c: ModelContainer) -> some View {
        ImportSheet(kind, sources: state.sources, phase: state.phase)
            .modelContainer(c)
            .tint(Color(PColor.paneAccent))
            .environment(\.locale, Locale(identifier: "en_US"))
    }

    #if os(macOS)
    @Test func macSheet() async throws {
        guard let dir = Self.dir else { return }
        let c = try Self.container()
        let size = CGSize(width: 540, height: ImportSheet.height)
        for kind in ImportKind.allCases {
            for state in Self.states(kind) {
            for dark in [false, true] {
                // A sheet draws on its window's background.
                let sheet = Self.sheet(kind, state, c).frame(width: size.width, height: size.height).background(Color(nsColor: .windowBackgroundColor))
                try await VersionHistorySnapshots.shoot(sheet,
                                                        to: dir.appending(path: "mac-\(kind.rawValue)-import-\(state.name)-\(dark ? "dark" : "light").png"),
                                                        size: size, dark: dark)
            }
            }
        }
    }

    /// The setup card's first step: one choice of where your notes are.
    @Test func setupCardChoice() async throws {
        guard let dir = Self.dir else { return }
        let card = SetupCard(progress: SetupProgress(), celebrating: false, onImport: {}, onImportFrom: { _ in }, onStartFresh: {}, onConnect: {}, onHide: {})
            .tint(Color(PColor.paneAccent)).padding(16).frame(width: 340).background(Color(nsColor: .windowBackgroundColor))
        try await VersionHistorySnapshots.shoot(card, to: dir.appending(path: "mac-setup-bring.png"), size: CGSize(width: 340, height: 200), dark: false)
    }
    #endif

    #if os(iOS)
    /// On an iPhone simulator (no Simulator window needed):
    /// `TEST_RUNNER_AMBER_HIG_SHOTS=/path xcodebuild test -scheme Pane -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
    /// -only-testing:PaneTests/ImportSheetSnapshots CODE_SIGNING_ALLOWED=NO`.
    @Test func iPhoneSheet() async throws {
        guard let dir = Self.dir else { return }
        let c = try Self.container()
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let size = CGSize(width: 402, height: 874)
        for kind in ImportKind.allCases {
            for state in Self.states(kind) {
            for dark in [false, true] {
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(origin: .zero, size: size)
                window.overrideUserInterfaceStyle = dark ? .dark : .light
                window.rootViewController = UIHostingController(rootView: Self.sheet(kind, state, c))
                window.isHidden = false
                try? await Task.sleep(for: .seconds(1.0))
                let format = UIGraphicsImageRendererFormat()
                format.scale = 3
                let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                    window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                }
                window.isHidden = true
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try #require(image.pngData()).write(to: dir.appending(path: "iphone-\(kind.rawValue)-import-\(state.name)-\(dark ? "dark" : "light").png"))
            }
            }
        }
    }
    #endif
}
