#if os(macOS)
import AppKit
import Supabase
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

    /// Draws `view` at `size` and writes `name`.png. The window is borderless, far off every
    /// screen (-20000, -20000) and never ordered front or made key: a titled window placed off
    /// screen gets pulled back onto the display, where it showed up on a developer's Mac.
    /// No window chrome is drawn. `card`: edge to edge, as the signed-out window shows it.
    /// `toolbar` is kept for the callers; nothing draws a toolbar any more.
    static func shoot(_ view: some View, name: String, size: CGSize, dark: Bool, toolbar: Bool = true, card: Bool = false, wait: Double = 0.8) async throws {
        guard let dir else { return }
        let window = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: size.width, height: size.height),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let host = NSHostingView(rootView: AnyView(card ? AnyView(view.ignoresSafeArea()) : AnyView(view)))
        host.appearance = window.appearance
        host.frame = CGRect(origin: .zero, size: size)
        window.contentView = host
        try? await Task.sleep(for: .seconds(wait))
        defer { window.close() }
        host.layoutSubtreeIfNeeded()
        let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try #require(rep.representation(using: .png, properties: [:])).write(to: dir.appending(path: "\(name).png"))
    }

    /// Draws a view in a bare hosting view at its fitting size (forms and sheets).
    static func render(_ view: some View, name: String, dark: Bool, wait: Double = 0.5) async throws {
        guard let dir else { return }
        let host = NSHostingView(rootView: view.background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let window = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 600, height: 900), styleMask: [.borderless], backing: .buffered, defer: false)
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
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        try await Self.render(Form { ConnectAISection(client: client) }.formStyle(.grouped).frame(width: 520, height: 520), name: "mac-connect-\(mode)", dark: dark, wait: 1.0)
        let r = ConnectRequest(id: UUID(), client_name: "ChatGPT", redirect_host: "chatgpt.com", loopback: false, wants_write: true)
        try await Self.render(ConsentSheet(client: client, requestID: r.id, initial: .asking(r), finish: { _ in }), name: "mac-consent-\(mode)", dark: dark)
        try await Self.shoot(SignInView(backend: backend).fixedSize().containerBackground(for: .window) { Backdrop() }, name: "mac-signin-\(mode)", size: CGSize(width: 380, height: 470), dark: dark, toolbar: false)
        // The email-first steps: an existing account, a new email, a Sign in with Apple account, and Forgot password?.
        for (name, step) in [("existing", EmailSignInFlow.Step.signIn(fallback: false)), ("new", .create), ("fallback", .signIn(fallback: true)), ("apple", .apple),
                             ("forgot", .forgot(sending: false)), ("forgot-sent", .forgotSent)] {
            let flow = EmailSignInFlow(step: step, email: "you@example.com", password: step == .create ? "correct horse battery" : "")
            try await Self.shoot(SignInView(backend: backend, flow: flow).fixedSize().containerBackground(for: .window) { Backdrop() }, name: "mac-signin-\(name)-\(mode)", size: CGSize(width: 380, height: 520), dark: dark, toolbar: false)
        }
        // The code boxes part typed and full, and after a wrong code.
        for (name, code) in [("confirm-typed", "704"), ("confirm-full", "704494")] {
            try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false), flow: EmailSignInFlow(step: .confirm, email: "sara@example.com", code: code)),
                                 name: "mac-welcome-\(name)-\(mode)", size: WelcomeFlow.size, dark: dark, toolbar: false, card: true)
        }
        try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false), flow: EmailSignInFlow(step: .confirm, email: "sara@example.com"),
                                         error: "That code didn't work. Check the newest email from Amber Notes, or press Resend code."),
                             name: "mac-welcome-confirm-wrong-\(mode)", size: WelcomeFlow.size, dark: dark, toolbar: false, card: true)
        // Email confirmation: Check your email, fresh and just after a code went out.
        for (name, sent) in [("confirm", nil), ("confirm-wait", Date.now)] as [(String, Date?)] {
            try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false), flow: EmailSignInFlow(step: .confirm, email: "sara@example.com", codeSentAt: sent)),
                                 name: "mac-welcome-\(name)-\(mode)", size: WelcomeFlow.size, dark: dark, toolbar: false, card: true)
        }
        try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false), flow: EmailSignInFlow(step: .create, email: "sara@example.com", password: "correct horse battery")),
                             name: "mac-welcome-signin-new-\(mode)", size: WelcomeFlow.size, dark: dark, toolbar: false, card: true)
        // Before the email is checked: neutral words.
        try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false)),
                             name: "mac-welcome-signin-start-\(mode)", size: WelcomeFlow.size, dark: dark, toolbar: false, card: true)
        // The heading once the email is known: an existing account.
        try await Self.shoot(WelcomeFlow(backend: backend, stage: .signIn(returning: false), flow: EmailSignInFlow(step: .signIn(fallback: false), email: "sara@example.com", password: "secret")),
                             name: "mac-welcome-signin-existing-\(mode)", size: WelcomeFlow.size, dark: dark, toolbar: false, card: true)
        // Open your notes on this Mac: why, the QR code and the code to type.
        try await Self.shoot(AddDeviceCapture(name: "new-device").frame(width: 520, height: 760).containerBackground(for: .window) { Backdrop() },
                             name: "mac-new-device-\(mode)", size: CGSize(width: 520, height: 760), dark: dark, toolbar: false, card: true, wait: 2.0)
        try await Self.render(SettingsView(backend: backend, sync: nil), name: "mac-settings-\(mode)", dark: dark)
        backend.showSignedInForPreview(email: "you@example.com")
        try await Self.render(SettingsView(backend: backend, sync: nil), name: "mac-settings-signedin-\(mode)", dark: dark)
        // With a name and photo: the profile header in Settings and the account row in the sidebar.
        let face = try ProfileImage.prepare(try #require(NSImage(named: "MarkTight")?.tiffRepresentation))
        ProfileStore.shared.showForPreview(name: "Emil Wagman", photo: NSImage(data: face))
        try await Self.render(SettingsView(backend: backend, sync: nil), name: "mac-settings-profile-\(mode)", dark: dark)
        try await Self.render(AccountButton(email: "you@example.com", backend: backend).frame(width: 240).padding(10), name: "mac-account-row-\(mode)", dark: dark)
        ProfileStore.shared.showForPreview(name: nil, photo: nil)
        try await Self.render(AccountButton(email: "you@example.com", backend: backend).frame(width: 240).padding(10), name: "mac-account-row-noname-\(mode)", dark: dark)
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
