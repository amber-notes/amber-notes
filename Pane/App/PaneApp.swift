import SwiftData
import SwiftUI

@main
struct PaneApp: App {
    let container: ModelContainer
    @State private var backend: Backend
    @State private var sync: SyncEngine

    /// Unit tests run inside the app. There it stays out of the way: no window,
    /// no Dock icon, never takes focus from whatever you're doing.
    static var isUnitTestHost: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil && !ProcessInfo.processInfo.arguments.contains("-uitest")
    }

    init() {
        #if os(macOS)
        if Self.isUnitTestHost { NSApplication.shared.setActivationPolicy(.accessory) }
        #endif
        let args = ProcessInfo.processInfo.arguments
        let inMemory = args.contains("-uitest") || args.contains("-synctest") || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if inMemory { UserDefaults.standard.removeObject(forKey: "lastScope") }
        let config = ModelConfiguration("Pane", isStoredInMemoryOnly: inMemory)
        container = try! ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: config)
        let backend = Backend()
        let context = container.mainContext
        backend.willSignIn = { user in AccountLibrary.adopt(user, context: context) }
        _backend = State(initialValue: backend)
        _sync = State(initialValue: SyncEngine(backend: backend, context: container.mainContext))
        // With sync on, the library is seeded after the first pull so devices don't duplicate it.
        if backend.client == nil { Seed.ensureLibrary(container.mainContext, demo: args.contains("-demo")) }
    }

    /// Test runs can pin an appearance: `-uitest -scheme light`. Otherwise the system decides.
    private static var testScheme: ColorScheme? {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-scheme"), args.indices.contains(i + 1) else { return nil }
        return args[i + 1] == "light" ? .light : args[i + 1] == "dark" ? .dark : nil
    }

    /// The notes window's scene id (the menu bar panel opens it by this).
    static let mainWindowID = "main"

    #if os(macOS)
    @AppStorage(MenuBarSettings.key) private var showInMenuBar = true
    #endif

    var body: some Scene {
        WindowGroup(id: Self.mainWindowID) {
            if Self.isUnitTestHost {
                UnitTestHostView()
            } else {
                AppGate(backend: backend, sync: sync)
                    .connectHandler(backend: backend)
                    .tint(Color(PColor.paneAccent))
                    .preferredColorScheme(Self.testScheme)
            }
        }
        .modelContainer(container)
        #if os(macOS)
        .defaultSize(width: 1180, height: 760)
        .defaultWindowPlacement { _, context in
            // Open at a comfortable size, centred, whatever screen is showing.
            let screen = context.defaultDisplay.visibleRect
            // Test runs can ask for a width: `-uitest -width 820`.
            let args = ProcessInfo.processInfo.arguments
            let asked = args.contains("-uitest") ? args.firstIndex(of: "-width").flatMap { args.indices.contains($0 + 1) ? Double(args[$0 + 1]) : nil } : nil
            let size = CGSize(width: min(asked ?? 1180, screen.width - 80), height: min(760, screen.height - 80))
            return WindowPlacement(CGPoint(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2), size: size)
        }
        .windowResizability(.contentMinSize)
        .windowToolbarStyle(.unified)
        .commands {
            PaneCommands()
            // The standard View › Sidebar and Edit › Find, Spelling and Substitutions items.
            SidebarCommands()
            TextEditingCommands()
            #if SPARKLE
            UpdaterCommands()
            #endif
        }
        #endif

        #if os(macOS)
        Settings {
            SettingsView(backend: backend, sync: sync)
        }

        // Amber Notes in the menu bar: quick capture, search, pinned and recent notes.
        MenuBarExtra(isInserted: Binding(get: { showInMenuBar && MenuBarSettings.allowed }, set: { if MenuBarSettings.allowed { showInMenuBar = $0 } })) {
            MenuBarPanel(backend: backend, sync: sync)
                .modelContainer(container)
                .tint(Color(PColor.paneAccent))
        } label: {
            Image("MenuBarIcon").accessibilityLabel("Amber Notes")
        }
        .menuBarExtraStyle(.window)
        #endif
    }
}

#if os(macOS)
import AppKit

/// Where the notes window was, so it reopens there like Notes: size, position and screen.
/// The sign-in card is never remembered.
enum WindowFrameMemory {
    static let key = "notesWindowFrame"
    static let defaultSize = CGSize(width: 1180, height: 760)
    /// The notes window's smallest size (its contentMinSize, plus the title bar).
    static let minimum = CGSize(width: 760, height: 520)

    /// The saved frame if enough of it is on a screen you still have; otherwise the default, centred.
    static func frame(saved: CGRect?, screens: [CGRect], main: CGRect) -> CGRect {
        // Anything smaller than the notes window's minimum is the sign-in card, never a real choice.
        if let saved, saved.width >= minimum.width, saved.height >= minimum.height,
           let screen = screens.max(by: { area($0.intersection(saved)) < area($1.intersection(saved)) }),
           area(screen.intersection(saved)) >= min(area(saved) * 0.5, 200 * 150),
           // The title bar has to be reachable, or you couldn't move the window back.
           screen.intersects(CGRect(x: saved.minX, y: saved.maxY - 28, width: saved.width, height: 28)) {
            return saved
        }
        let size = CGSize(width: min(defaultSize.width, main.width - 80), height: min(defaultSize.height, main.height - 80))
        return CGRect(x: main.midX - size.width / 2, y: main.midY - size.height / 2, width: size.width, height: size.height)
    }

    private static func area(_ r: CGRect) -> CGFloat { r.isNull ? 0 : r.width * r.height }

    static var saved: CGRect? {
        guard let s = UserDefaults.standard.string(forKey: key) else { return nil }
        let r = NSRectFromString(s)
        return r.isEmpty ? nil : r
    }

    /// Only real notes-window frames: while signing in or out the window is briefly card-sized.
    static func save(_ frame: CGRect) {
        guard frame.width >= minimum.width, frame.height >= minimum.height else { return }
        UserDefaults.standard.set(NSStringFromRect(frame), forKey: key)
    }

    /// Test runs place the window themselves (`-uitest -width 820`) and never touch the saved frame.
    static var enabled: Bool { !ProcessInfo.processInfo.arguments.contains("-uitest") }
}

/// Signed out, the window is just the sign-in card: small, no title bar.
/// Signed in, it becomes the normal three-column window, back where you left it.
private struct WindowShaper: NSViewRepresentable {
    let compact: Bool
    /// The sign-in card's own size; the compact window wraps it exactly.
    var cardSize: CGSize = .zero

    final class Coordinator {
        /// The shape last applied; the window is only reshaped when this changes.
        var applied: Bool?
        var observers: [NSObjectProtocol] = []
        var remembering = false
        /// The card size the window was last fitted to. The window is refitted only when the
        /// card itself changes size (e.g. an error line appears), never on other updates.
        var fittedCard: CGSize?
        let created = Date()
        deinit { observers.forEach(NotificationCenter.default.removeObserver) }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        let coordinator = context.coordinator
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            guard !compact || cardSize.height > 0 else { return }
            remember(window, coordinator)
            // Shape only when switching between the card and the notes window, never on
            // ordinary updates: resizing it yourself must stick.
            guard coordinator.applied != compact else {
                if compact { fitCard(window, coordinator) }
                return
            }
            // At launch (including a signed-in launch that briefly looked signed out) the window
            // just appears in place; only a real sign-in or sign-out animates.
            let animate = Date().timeIntervalSince(coordinator.created) > 1.5
            coordinator.applied = compact
            coordinator.remembering = false
            // No system title bar or toolbar while signed out: just the card and the window buttons.
            window.toolbar?.isVisible = !compact
            // Notes' full-height toolbar with large buttons; compact only for the sign-in card.
            window.toolbarStyle = compact ? .unifiedCompact : .unified
            window.titlebarSeparatorStyle = compact ? .none : .automatic
            // The card runs under a see-through title bar: one surface, just the window buttons on it.
            window.titlebarAppearsTransparent = compact
            if compact { window.styleMask.insert(.fullSizeContentView) }
            // Card mode keeps close and minimise; zoom makes no sense for a fixed-size card.
            window.standardWindowButton(.zoomButton)?.isEnabled = !compact
            window.contentMinSize = compact ? CGSize(width: 300, height: 300) : CGSize(width: 760, height: 520)
            if compact {
                coordinator.fittedCard = nil
                fitCard(window, coordinator, placeOnScreen: true)
            } else if WindowFrameMemory.enabled {
                let frame = WindowFrameMemory.frame(saved: WindowFrameMemory.saved,
                                                    screens: NSScreen.screens.map(\.visibleFrame),
                                                    main: (window.screen ?? NSScreen.main)?.visibleFrame ?? window.frame)
                window.setFrame(frame, display: true, animate: animate)
                coordinator.remembering = true
            }
        }
    }

    /// The card is the whole window, title-bar area included.
    ///
    /// It's fitted only when the card's own size changes, and never while you're dragging the
    /// window: moving it (across screens too) is left entirely to macOS. A size change keeps the
    /// top edge and centre-x where they are, so the window grows or shrinks downward in place.
    /// Only the first fit after switching to the card keeps it on screen.
    private func fitCard(_ window: NSWindow, _ coordinator: Coordinator, placeOnScreen: Bool = false) {
        guard cardSize.width > 0, cardSize.height > 0 else { return }
        if let last = coordinator.fittedCard, abs(last.width - cardSize.width) < 1, abs(last.height - cardSize.height) < 1 { return }
        if NSEvent.pressedMouseButtons != 0 { return } // mid-drag: try again on the next update
        coordinator.fittedCard = cardSize
        var frame = CGRect(x: window.frame.midX - cardSize.width / 2, y: window.frame.maxY - cardSize.height,
                           width: cardSize.width, height: cardSize.height)
        if placeOnScreen, let screen = window.screen?.visibleFrame {
            frame.origin.x = min(max(frame.origin.x, screen.minX), screen.maxX - frame.width)
            frame.origin.y = min(max(frame.origin.y, screen.minY), screen.maxY - frame.height)
        }
        guard abs(window.frame.width - frame.width) > 0.5 || abs(window.frame.height - frame.height) > 0.5 else { return }
        window.setFrame(frame, display: true, animate: !placeOnScreen)
    }

    /// Saves the notes window's frame whenever you move or resize it (never the card's).
    private func remember(_ window: NSWindow, _ coordinator: Coordinator) {
        guard coordinator.observers.isEmpty, WindowFrameMemory.enabled else { return }
        let save: (Notification) -> Void = { [weak window, weak coordinator] _ in
            guard let window, let coordinator, coordinator.remembering, coordinator.applied == false else { return }
            WindowFrameMemory.save(window.frame)
        }
        let nc = NotificationCenter.default
        for name in [NSWindow.didMoveNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didResizeNotification, NSWindow.willCloseNotification] {
            coordinator.observers.append(nc.addObserver(forName: name, object: window, queue: .main, using: save))
        }
    }
}
#endif

/// Sign-in when sync is on and you're signed out; the library otherwise.
struct AppGate: View {
    let backend: Backend
    let sync: SyncEngine
    @State private var cardSize: CGSize = .zero
    /// The first-run "Get set up" card's state, for the signed-in account.
    @State private var setup = SetupStore()
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            switch backend.state {
            case .signedOut:
                SignInView(backend: backend)
                    #if os(macOS)
                    .fixedSize()
                    .onGeometryChange(for: CGSize.self, of: \.size) { cardSize = $0 }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea()
                    .containerBackground(for: .window) { Backdrop() }
                    .toolbar(removing: .title)
                    #endif
                    .transition(.opacity)
            case .disabled, .signedIn:
                RootView()
                    .environment(backend)
                    .environment(sync)
                    .environment(setup)
                    .transition(.opacity)
            }
        }
        #if os(macOS)
        .background(WindowShaper(compact: backend.state == .signedOut, cardSize: cardSize))
        #endif
        .animation(.easeOut(duration: 0.25), value: backend.state)
        .task(id: backend.state) {
            guard case .signedIn = backend.state, let client = backend.client else {
                setup.attach(account: nil, service: nil)
                await sync.stop()
                return
            }
            setup.attach(account: backend.userID, service: SupabaseSetup(client: client))
            await sync.start()
            // Seed only when the server really has nothing, never after a failed sync. A real
            // account starts with an empty Notes folder: the setup card is its welcome.
            if sync.hasSynced {
                Seed.ensureLibrary(context, demo: false, welcome: false)
                sync.schedule()
            }
            await setup.refresh(force: true)
            await InstallID.report(client)
        }
        // Each sync may have brought an AI's edit or a new connection: the card looks again.
        .onChange(of: sync.status) { _, _ in Task { await setup.refresh() } }
        .onReceive(NotificationCenter.default.publisher(for: .paneNotesBrought)) { _ in
            Task { await setup.mark("imported") }
        }
        .onChange(of: phase) { _, p in
            if p == .active {
                Task { await setup.refresh() }
                context.drainInbox()
                sync.schedule()
            } else {
                // Leaving the app: whatever you just typed is written and synced.
                DebouncedSave.flushAll()
                sync.schedule()
            }
        }
        #if os(macOS)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
            DebouncedSave.flushAll()
            try? context.save()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
            DebouncedSave.flushAll()
        }
        #endif
        .onAppear { context.drainInbox() }
    }
}

@MainActor
enum Seed {
    static func ensureLibrary(_ context: ModelContext, demo: Bool, welcome: Bool = true) {
        context.purgeExpiredTrash()
        guard context.allFolders().isEmpty else { return }
        let notes = context.createFolder(named: "Notes")
        if welcome || demo { context.createNote(in: .folder(notes.id), body: Self.welcome) }
        if demo { DemoData.load(into: context, main: notes) }
    }

    static let welcome = """
    Welcome to Amber Notes

    Amber Notes is a place for notes. Write in **markdown** and it styles itself as you type, with the syntax hidden until you need it.

    ## The basics
    - [ ] Tap a circle to check it off
    - [x] Lists continue when you press Return
    * Press Return on an empty item to end a list
    - Start a line with * for bullets or - for dashes

    > Quotes, `inline code`, ~~strikethrough~~ and [links](https://apple.com) all work.

    Keep details in a **sub-note**: choose Format → Sub-note and a whole note opens, linked from here.

    | Shortcut | Does |
    | --- | --- |
    | ⌘B | Bold |
    | ⌘⇧L | Checklist |
    """
}

/// What the app shows while hosting unit tests: nothing, and its window closes itself.
private struct UnitTestHostView: View {
    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            #if os(macOS)
            .background(WindowCloser())
            #endif
    }
}

#if os(macOS)
private struct WindowCloser: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { v.window?.orderOut(nil) }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}
#endif
