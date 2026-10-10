import SwiftData
import SwiftUI
import Testing
@testable import Pane
#if os(iOS)
import UIKit
#endif

/// iPhone pictures of the screens fixed after the 1.1.1 TestFlight review: note previews, the
/// Running log table, Settings and each of its pages, and the sign-in card at the password
/// step, light and dark. On a simulator (no Simulator window needed):
/// `TEST_RUNNER_AMBER_HIG_SHOTS=/path xcodebuild test -scheme Pane -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
/// -only-testing:PaneTests/ListLayoutSnapshots CODE_SIGNING_ALLOWED=NO`.
@MainActor @Suite(.serialized) struct ListLayoutSnapshots {
    #if os(iOS)
    static var dir: URL? { ImportSheetSnapshots.dir }
    static let size = CGSize(width: 402, height: 874)

    /// The review account's notes with tables (scripts/review-account.py).
    static let runningLog = "Running log\n\n<!-- pane-table: Date=date; Distance km=number; Minutes=number; Feel=scale 1-5 -->\n| Date | Distance km | Minutes | Feel |\n| --- | --- | --- | --- |\n| 2026-09-22 | 5 | 27 | 4 |\n| 2026-09-24 | 7.5 | 42 | 3 |\n| 2026-09-27 | 10 | 56 | 5 |\n"
    static let hiring = "Hiring: product designer\n\n<!-- pane-table: Name=text; Date=date; Verdict=choice Hire|Maybe|No -->\n| Name | Date | Verdict |\n| --- | --- | --- |\n| Sara Lind | 2026-09-15 | Maybe |\n| Jonas Berg | 2026-09-18 | Hire |\n\nNext step: portfolio review with Jonas on Monday.\n"

    static func container() throws -> (ModelContainer, [Note]) {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let personal = ctx.createFolder(named: "Personal")
        let notes = [Self.runningLog, Self.hiring, "Groceries\n\n- [ ] Oat milk\n- [ ] Eggs\n- [x] Coffee beans\n"].map { ctx.createNote(in: .folder(personal.id), body: $0) }
        return (c, notes)
    }

    /// Draws `view` in a window of the iPhone's size; `scroll` moves its first scroll view down first.
    static func shoot(_ view: some View, _ name: String, dark: Bool, scroll: CGFloat = 0, wait: Double = 1.0) async throws {
        guard let dir else { return }
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = UIHostingController(rootView: view.tint(Color(PColor.paneAccent)))
        window.isHidden = false
        try? await Task.sleep(for: .seconds(wait))
        if scroll > 0, let s = firstScrollView(in: window) {
            s.setContentOffset(CGPoint(x: 0, y: scroll - s.adjustedContentInset.top), animated: false)
            try? await Task.sleep(for: .seconds(0.6))
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: dir.appending(path: "iphone-\(name)-\(dark ? "dark" : "light").png"))
    }

    static func firstScrollView(in view: UIView) -> UIScrollView? {
        if let s = view as? UIScrollView, s.isScrollEnabled, s.contentSize.height > s.bounds.height { return s }
        for sub in view.subviews { if let s = firstScrollView(in: sub) { return s } }
        return nil
    }

    @Test(arguments: [false, true]) func notePreviews(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let (c, notes) = try Self.container()
        let list = NavigationStack {
            List { ForEach(notes) { NoteRow(note: $0, showFolder: true) }.listRowBackground(Color(Palette.row)) }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color(Palette.listGround).ignoresSafeArea())
                .navigationTitle("Personal")
        }
        .modelContainer(c)
        try await Self.shoot(list, "note-previews", dark: dark)
    }

    @Test(arguments: [false, true]) func runningLogTable(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let (c, notes) = try Self.container()
        let detail = NavigationStack {
            NoteDetailView(note: notes[0], controller: EditorController(), onNewNote: {})
        }
        .modelContainer(c)
        try await Self.shoot(detail, "running-log", dark: dark, wait: 1.5)
    }

    /// Settings: the first screen (you, then a row per page) and each page, opened the way a
    /// link opens it.
    @Test(arguments: [false, true]) func settingsPages(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let backend = Backend(testClient: CaptureScreen.client, email: "sara@example.com")
        ProfileStore.shared.showForPreview(name: "Sara Lind", photo: nil)
        defer { ProfileStore.shared.showForPreview(name: nil, photo: nil) }
        StorageStore.shared.usage = StorageUsage(used: 1_240_000_000, limit: 2_147_483_648, notes: 41_000_000, files: 900_000_000, apps: 12_000_000,
                                                 deleted: 230_000_000, versions: 64_000_000)
        let crypto = try await AddDeviceSnapshots.ready(backedUp: true, recoverySaved: true)
        defer { crypto.signedOut() }
        let devices = AddDeviceSnapshots.devices([AddDeviceSnapshots.added, AddDeviceSnapshots.stale])
        func settings(at tab: SettingsTab?) -> SettingsView {
            let route = SettingsRoute(defaults: UserDefaults(suiteName: "settings-shots-\(UUID())")!)
            if let tab { route.open(tab) }
            return SettingsView(backend: backend, sync: nil, crypto: crypto, devices: devices, connections: CaptureScreen.connections, route: route)
        }
        #expect(settings(at: nil).tabs == SettingsTab.allCases)
        try await Self.shoot(settings(at: nil), "settings", dark: dark)
        for tab in SettingsTab.allCases {
            try await Self.shoot(settings(at: tab), "settings-\(tab.rawValue)", dark: dark, wait: 1.5)
        }
    }

    @Test(arguments: [false, true]) func signInPassword(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        var flow = EmailSignInFlow(email: "appreview@norditech.se")
        _ = flow.beginCheck()
        flow.finishCheck(.password)
        try await Self.shoot(SignInView(backend: Backend(), flow: flow), "signin-password", dark: dark)
    }
    #endif
}
