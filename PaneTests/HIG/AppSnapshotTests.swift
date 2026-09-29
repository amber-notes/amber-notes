#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Whole-app screenshots for the design pass: the real RootView (and other screens)
/// in an offscreen, titled window, drawn with cacheDisplay. Nothing touches the screen.
/// Runs only when AMBER_HIG_SHOTS is set: `AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/AppSnapshotTests`.
@MainActor @Suite(.serialized) struct AppSnapshotTests {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_HIG_SHOTS"].map { URL(fileURLWithPath: $0) } }

    /// A demo library in memory.
    static func container() throws -> ModelContainer {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        Seed.ensureLibrary(c.mainContext, demo: true)
        try? c.mainContext.save()
        return c
    }

    /// Draws `view` in a real titled window (toolbar included) and writes `name`.png.
    static func shoot(_ view: some View, name: String, size: CGSize, dark: Bool, toolbar: Bool = true, wait: Double = 0.8) async throws {
        guard let dir else { return }
        let window = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: size.width, height: size.height),
                              styleMask: toolbar ? [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView] : [.titled, .closable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentViewController = NSHostingController(rootView: view)
        window.setContentSize(size)
        window.setFrameOrigin(CGPoint(x: -30000, y: -30000))
        window.orderFrontRegardless()
        try? await Task.sleep(for: .seconds(wait))
        defer { window.orderOut(nil); window.close() }
        guard let frame = window.contentView?.superview else { return }
        let rect = frame.bounds
        let rep = try #require(frame.bitmapImageRepForCachingDisplay(in: rect))
        frame.cacheDisplay(in: rect, to: rep)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "\(name).png"))
    }

    /// Draws a view in a bare hosting view at its fitting size (forms and sheets).
    static func render(_ view: some View, name: String, dark: Bool, wait: Double = 0.5) async throws {
        guard let dir else { return }
        let host = NSHostingView(rootView: view.background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let window = NSWindow(contentRect: CGRect(x: -30000, y: -30000, width: 600, height: 900), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        host.frame = CGRect(origin: .zero, size: host.fittingSize)
        window.setContentSize(host.fittingSize)
        try? await Task.sleep(for: .seconds(wait))
        defer { window.close() }
        host.layoutSubtreeIfNeeded()
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "\(name).png"))
    }

    /// Opens `title` (via the remembered-note key), restoring the user's own value afterwards.
    static func withLastNote<T>(_ c: ModelContainer, _ title: String, _ body: () async throws -> T) async rethrows -> T {
        let d = UserDefaults.standard
        let keepNote = d.object(forKey: "lastNote"), keepScope = d.object(forKey: "lastScope")
        defer {
            if let keepNote { d.set(keepNote, forKey: "lastNote") } else { d.removeObject(forKey: "lastNote") }
            if let keepScope { d.set(keepScope, forKey: "lastScope") } else { d.removeObject(forKey: "lastScope") }
        }
        d.removeObject(forKey: "lastScope")
        let notes = (try? c.mainContext.fetch(FetchDescriptor<Note>())) ?? []
        if let n = notes.first(where: { $0.title == title }) { d.set(n.id.uuidString, forKey: "lastNote") }
        return try await body()
    }

    @Test(arguments: [false, true])
    func root(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let c = try Self.container()
        for (title, slug) in [("Welcome to Amber Notes", "welcome"), ("Evening tracker", "tracker"), ("Lisbon", "lisbon"), ("Trip documents", "files")] {
            try await Self.withLastNote(c, title) {
                try await Self.shoot(RootView().modelContainer(c), name: "mac-root-\(slug)-\(dark ? "dark" : "light")", size: CGSize(width: 1180, height: 760), dark: dark)
            }
        }
        try await Self.withLastNote(c, "Welcome to Amber Notes") {
            try await Self.shoot(RootView().modelContainer(c), name: "mac-root-narrow-\(dark ? "dark" : "light")", size: CGSize(width: 780, height: 600), dark: dark)
        }
    }

    @Test(arguments: [false, true])
    func screens(dark: Bool) async throws {
        guard Self.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let backend = Backend()
        try await Self.shoot(SignInView(backend: backend).fixedSize().containerBackground(for: .window) { Backdrop() }, name: "mac-signin-\(mode)", size: CGSize(width: 380, height: 470), dark: dark, toolbar: false)
        try await Self.render(SettingsView(backend: backend, sync: nil), name: "mac-settings-\(mode)", dark: dark)
        backend.showSignedInForPreview(email: "you@example.com")
        try await Self.render(SettingsView(backend: backend, sync: nil), name: "mac-settings-signedin-\(mode)", dark: dark)
    }
}
#endif

#if os(macOS)
extension AppSnapshotTests {
    /// The sidebar header alone, magnified, to judge the mark's size and baseline against the name.
    @Test(arguments: [false, true])
    func sidebarHeader(dark: Bool) throws {
        guard let dir = Self.dir else { return }
        let host = NSHostingView(rootView: SidebarHeader().frame(width: 240).background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        host.frame = CGRect(origin: .zero, size: host.fittingSize)
        host.layoutSubtreeIfNeeded()
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        rep.size = host.bounds.size
        host.cacheDisplay(in: host.bounds, to: rep)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "mac-sidebar-header-\(dark ? "dark" : "light").png"))
    }
}
#endif
