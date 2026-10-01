import SwiftData
import SwiftUI
import Testing
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// The Evernote import sheet in each of its states (no files yet, files picked, importing, done),
/// light and dark, for the website's blog. Offscreen: nothing touches the screen. Runs only when
/// AMBER_HIG_SHOTS is set. Mac: `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh
/// PaneTests/EvernoteImportSnapshots`; iPhone: the same test on a simulator (see the test).
@MainActor @Suite(.serialized) struct EvernoteImportSnapshots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }

    /// A made-up export: three notebooks, about 1,500 notes.
    static let sources = [
        ENEXSource(url: URL(fileURLWithPath: "/demo/Recipes.enex"), name: "Recipes", notes: 188, bytes: 41_200_000),
        ENEXSource(url: URL(fileURLWithPath: "/demo/Work.enex"), name: "Work", notes: 1_204, bytes: 312_000_000),
        ENEXSource(url: URL(fileURLWithPath: "/demo/Travel journal.enex"), name: "Travel journal", notes: 97, bytes: 18_400_000),
    ]

    static var summary: EvernoteImportSummary {
        var s = EvernoteImportSummary()
        s.notes = 1_482
        s.attachments = 356
        s.alreadyImported = 4
        s.empty = 3
        s.filesMissing = 1
        s.encrypted = 2
        return s
    }

    static let states: [(name: String, phase: EvernoteImportView.Phase, sources: [ENEXSource])] = [
        ("empty", .choosing, []),
        ("files", .choosing, sources),
        ("progress", .importing(done: 642, total: 1_489), sources),
        ("summary", .finished(summary), sources),
    ]

    static func container() throws -> ModelContainer {
        let c = try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        for name in ["Notes", "Recipes", "Work"] { _ = c.mainContext.createFolder(named: name) }
        return c
    }

    static func sheet(_ state: (name: String, phase: EvernoteImportView.Phase, sources: [ENEXSource]), _ c: ModelContainer) -> some View {
        EvernoteImportView(sources: state.sources, phase: state.phase)
            .modelContainer(c)
            .tint(Color(PColor.paneAccent))
            .environment(\.locale, Locale(identifier: "en_US"))
    }

    #if os(macOS)
    @Test func macSheet() async throws {
        guard let dir = Self.dir else { return }
        let c = try Self.container()
        let size = CGSize(width: 540, height: EvernoteImportView.height)
        for state in Self.states {
            for dark in [false, true] {
                // A sheet draws on its window's background.
                let sheet = Self.sheet(state, c).frame(width: size.width, height: size.height).background(Color(nsColor: .windowBackgroundColor))
                try await VersionHistorySnapshots.shoot(sheet,
                                                        to: dir.appending(path: "mac-evernote-import-\(state.name)-\(dark ? "dark" : "light").png"),
                                                        size: size, dark: dark)
            }
        }
    }
    #endif

    #if os(iOS)
    /// On an iPhone simulator (no Simulator window needed):
    /// `TEST_RUNNER_AMBER_HIG_SHOTS=/path xcodebuild test -scheme Pane -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
    /// -only-testing:PaneTests/EvernoteImportSnapshots CODE_SIGNING_ALLOWED=NO`.
    @Test func iPhoneSheet() async throws {
        guard let dir = Self.dir else { return }
        let c = try Self.container()
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let size = CGSize(width: 402, height: 874)
        for state in Self.states {
            for dark in [false, true] {
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(origin: .zero, size: size)
                window.overrideUserInterfaceStyle = dark ? .dark : .light
                window.rootViewController = UIHostingController(rootView: Self.sheet(state, c))
                window.isHidden = false
                try? await Task.sleep(for: .seconds(1.0))
                let format = UIGraphicsImageRendererFormat()
                format.scale = 3
                let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
                    window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                }
                window.isHidden = true
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                try #require(image.pngData()).write(to: dir.appending(path: "iphone-evernote-import-\(state.name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
    #endif
}
