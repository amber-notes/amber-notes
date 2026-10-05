import Supabase
import SwiftData
import SwiftUI

@main
struct PaneApp: App {
    let container: ModelContainer
    @State private var backend: Backend
    @State private var sync: SyncEngine
    /// Push tokens and the notification delegate at launch (Push.swift).
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PaneAppDelegate.self) private var appDelegate
    #else
    @NSApplicationDelegateAdaptor(PaneAppDelegate.self) private var appDelegate
    #endif

    /// Unit tests run inside the app. There it stays out of the way: no window,
    /// no Dock icon, never takes focus from whatever you're doing.
    static var isUnitTestHost: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil && !ProcessInfo.processInfo.arguments.contains("-uitest")
    }

    /// The library, for Shortcuts (NoteIntents), which run without a window.
    @MainActor static var sharedContainer: ModelContainer?

    init() {
        #if os(macOS)
        if Self.isUnitTestHost { NSApplication.shared.setActivationPolicy(.accessory) }
        #else
        Self.styleLargeTitles()
        #endif
        let args = ProcessInfo.processInfo.arguments
        let inMemory = args.contains("-uitest") || args.contains("-synctest") || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if inMemory { UserDefaults.standard.removeObject(forKey: "lastScope") }
        let config = ModelConfiguration("Pane", isStoredInMemoryOnly: inMemory)
        container = try! ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: config)
        Self.sharedContainer = container
        let backend = Backend()
        let context = container.mainContext
        backend.willSignIn = { user in AccountLibrary.adopt(user, context: context) }
        _backend = State(initialValue: backend)
        // Before sync: it hooks start fresh into this instance.
        AccountCrypto.shared = AccountCrypto(store: inMemory ? MemoryAccountKeyStore() : KeychainAccountKeyStore())
        // Which device this is, for the list of devices that hold the key: in a Keychain item that stays on it.
        DeviceIdentity.shared = DeviceIdentity(store: inMemory ? MemoryDeviceIdentityStore() : KeychainDeviceIdentityStore())
        KeyDevices.shared = KeyDevices()
        let sync = SyncEngine(backend: backend, context: container.mainContext)
        _sync = State(initialValue: sync)
        // "What's new" after a major update: decided before anything is drawn or seeded, while
        // the library still says whether this is a fresh install.
        if !inMemory {
            WhatsNewStore.shared.launch(running: WhatsNew.runningVersion, releases: WhatsNew.bundled,
                                        existingUser: WhatsNew.existingUser(defaults: .standard, context: context))
        }
        // With sync on, the library is seeded after the first pull so devices don't duplicate it.
        if backend.client == nil { Seed.ensureLibrary(container.mainContext, demo: args.contains("-demo")) }
        // Version history: the server's, or a made-up one for demos (`-demo -demoHistory`).
        let historyStore: NoteHistoryStore = args.contains("-demoHistory") ? DemoHistoryStore(context: context)
            : backend.client.map { SupabaseHistoryStore(client: $0) } ?? EmptyHistoryStore()
        NoteHistory.shared = NoteHistory(store: historyStore, context: context, sync: backend.client == nil ? nil : sync)
        // Locked notes: the key behind Face ID / Touch ID, except in tests and captures, which
        // also start with no notes password.
        NoteVault.shared = inMemory ? NoteVault(keyStore: MemoryKeyStore(), defaults: MemoryDefaults(), drivesSync: true)
            : NoteVault(keyStore: KeychainKeyStore(), drivesSync: true)
        Capture.lockedNotesFromArguments(container.mainContext)
        // "Did you know" tips; their counts go to the server when signed in.
        TipLog.client = backend.client
        FeatureUse.client = backend.client
        PaneTips.configure()
        Capture.scheduleFromArguments(container.mainContext)
        Capture.notePagesFromArguments(container.mainContext)
        #if os(iOS)
        FrameProbe.startFromArguments()
        #endif
        // Note pages: compile the sandbox's rules and start a web view now, not when a page opens.
        if !PaneApp.isUnitTestHost, !ProcessInfo.processInfo.arguments.contains("-noPagePrewarm") { NotePageSandbox.prewarm() }
        #if os(macOS)
        Capture.demoSequenceFromArguments(container.mainContext)
        Capture.importSequenceFromArguments()
        #endif
    }

    #if os(iOS)
    /// Large titles in the website's display type: heavy and tight, in the warm ink.
    private static func styleLargeTitles() {
        let size: CGFloat = 34
        let font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: .systemFont(ofSize: size, weight: .heavy))
        UINavigationBar.appearance().largeTitleTextAttributes = [.font: font, .kern: Palette.tracking(size), .foregroundColor: Palette.ink]
    }
    #endif

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
        // Test and capture runs always start with the notes window, whatever was saved last time.
        .defaultLaunchBehavior(ProcessInfo.processInfo.arguments.contains("-uitest") ? .presented : .automatic)
        .restorationBehavior(ProcessInfo.processInfo.arguments.contains("-uitest") ? .disabled : .automatic)
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
                // Change Password seals the library's locked notes again.
                .modelContainer(container)
        }

        // Connect ChatGPT or Claude: the steps float over the browser while you follow them.
        Window("Connect", id: ConnectPanel.windowID) {
            ConnectPanel(backend: backend)
                .tint(Color(PColor.paneAccent))
        }
        .windowLevel(.floating)
        .windowResizability(.contentSize)
        .restorationBehavior(.disabled)
        .defaultLaunchBehavior(.suppressed)
        .defaultWindowPlacement { content, context in
            let size = content.sizeThatFits(.unspecified)
            return WindowPlacement(ConnectPanel.placement(screen: context.defaultDisplay.visibleRect, size: size), size: size)
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
    /// "Enjoying Amber Notes?", once, after a week of use.
    @State private var shareAsk = ShareAskStore()
    /// Asks to approve an AI connection from a browser, while signed in with the key here.
    @State private var connectAsks: ConnectAsks?
    /// "Connected ChatGPT", "Your notes were deleted…": said once on each device.
    @State private var notices: AccountNotices?
    @State private var noticeProblem: String?
    /// This device was removed from another one, and hasn't said so yet.
    @AppStorage(DeviceRemoval.noticeFlag) private var removedHere = false
    /// Captures: `-captureConsent ChatGPT` shows the Allow sheet over the notes.
    @State private var consent = CaptureScreen.consentRequest
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var phase
    /// The account's key: the gate before the notes, while this device doesn't have it.
    private var crypto: AccountCrypto { AccountCrypto.shared }

    var body: some View {
        Group {
            if let screen = CaptureScreen.requested {
                CaptureScreen(name: screen, backend: backend)
            } else {
                gate
            }
        }
        .sheet(item: $consent) { r in
            ConsentSheet(client: CaptureScreen.client, requestID: r.id, initial: .asking(r), finish: { _ in })
        }
        .alert(PrivacyCopy.removedTitle, isPresented: $removedHere) {
            Button("OK", role: .cancel) { removedHere = false }
        } message: {
            Text(PrivacyCopy.removedMessage)
        }
    }

    /// Captures: `-captureSetupFlow` walks the setup card from step 1 to "You're all set", a few
    /// seconds a step, as if each thing had just happened.
    private func playSetupFlow() {
        Task { @MainActor in
            var p = SetupProgress()
            setup.apply(p)
            for change in [{ (q: inout SetupProgress) in q.imported = true }, { $0.connected = true }, { $0.aiEdits = 1 }] {
                try? await Task.sleep(for: .seconds(2.6))
                change(&p)
                setup.apply(p)
            }
        }
    }

    /// The notes stay closed until this device has the account's key; the first time it does,
    /// one screen says what that means. Just signed in, before the key check has started, it's
    /// the key screen too (the library flashed by for a few frames).
    private var keyGateShown: Bool {
        (crypto.phase != .ready && crypto.phase != .off) || crypto.needsWelcome
            || (backend.client != nil && crypto.account != backend.userID)
    }

    private var gate: some View {
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
            case .signedIn where keyGateShown:
                KeyGateView(crypto: crypto, backend: backend)
                    #if os(macOS)
                    .toolbar(removing: .title)
                    #endif
                    .transition(.opacity)
            case .disabled, .signedIn:
                RootView()
                    .environment(backend)
                    .environment(sync)
                    .environment(setup)
                    .shareAskSheet(shareAsk)
                    .task {
                        try? await Task.sleep(for: .seconds(1.2))
                        shareAsk.showIfForced()
                    }
                    .modifier(NoticeAlerts(notices: notices, crypto: crypto, problem: $noticeProblem))
                    .transition(.opacity)
            }
        }
        #if os(macOS)
        .background(WindowShaper(compact: backend.state == .signedOut, cardSize: cardSize))
        #endif
        .animation(.easeOut(duration: 0.25), value: backend.state)
        .onAppear {
            if let p = CaptureScreen.setupProgress { setup.apply(p) }
            if CaptureScreen.setupFlow { playSetupFlow() }
        }
        .task(id: backend.state) {
            // A removal of this device that was cut short (the app was killed midway) is finished
            // before anything else: the key is already gone, the notes follow.
            if UserDefaults.standard.string(forKey: DeviceRemoval.pendingFlag) != nil {
                KeyDevices.shared.attach(account: backend.userID, server: backend.client.map { SupabaseKeyDevices(client: $0) })
                await removal.resumeIfInterrupted()
            }
            guard case .signedIn = backend.state, let client = backend.client else {
                setup.attach(account: nil, service: nil)
                shareAsk.attach(account: nil, service: nil)
                if backend.state == .disabled { NoteVault.shared.attach(account: nil, remote: nil) } else { NoteVault.shared.lockNow() }
                AccountCrypto.shared.signedOut()
                KeyDevices.shared.attach(account: nil, server: nil)
                PushRegistration.shared.detach()
                await sync.stop()
                await connectAsks?.stop()
                connectAsks = nil
                await notices?.stop()
                notices = nil
                // A sign-out that was offline removes this device's push token now. Signed in,
                // registering does it first (PushRegistration.attach).
                if let client = backend.client { await PushRegistration.shared.retryPendingForget(service: SupabasePushTokens(client: client)) }
                return
            }
            setup.attach(account: backend.userID, service: SupabaseSetup(client: client))
            shareAsk.attach(account: backend.userID, service: SupabaseShareAsk(client: client))
            NoteVault.shared.attach(account: backend.userID, remote: SupabaseLockRemote(client: client))
            KeyDevices.shared.attach(account: backend.userID, server: SupabaseKeyDevices(client: client))
            KeyDevices.shared.removedHere = { await removedFromDevices() }
            await SignedInStartup(
                refreshLock: { await NoteVault.shared.refresh() },
                checkKey: { await AccountCrypto.shared.attach(account: backend.userID, server: SupabaseAccountKeys(client: client)) }
            ).run()
            // Without the key the gate asks for it; the library starts when it's open (below).
            guard AccountCrypto.shared.allowsSync else { return }
            await openLibrary(client)
        }
        .onChange(of: crypto.phase) { old, new in
            guard new == .ready, old != .ready, case .signedIn = backend.state, let client = backend.client else { return }
            Task { await openLibrary(client) }
        }
        // What's new waits while an ask or an alert is up.
        .onChange(of: somethingAsking, initial: true) { _, asking in WhatsNewStore.shared.held = asking }
        // Each sync may have brought an AI's edit or a new connection: the card looks again.
        .onChange(of: sync.status) { _, _ in Task { await setup.refresh() } }

        .onReceive(NotificationCenter.default.publisher(for: .paneNotesBrought)) { _ in
            Task { await setup.mark("imported"); await PaneTips.imported.donate() }
        }
        // Tips wait until the Get set up card has gone; an import on any device counts.
        .onChange(of: setup.visible, initial: true) { _, visible in PaneTips.setupVisible = visible }
        .onChange(of: setup.progress?.imported == true, initial: true) { _, imported in
            if imported { Task { await PaneTips.importedOnce() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .paneShowSetupGuide)) { _ in
            Task { await setup.reset() }
        }
        #if os(macOS)
        // The Mac sleeping, its screen locking, the screen saver starting or a switch to another
        // user locks them too.
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.willSleepNotification)) { _ in
            NoteVault.shared.lockNow()
        }
        .onReceive(NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.sessionDidResignActiveNotification)) { _ in
            NoteVault.shared.lockNow()
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("com.apple.screenIsLocked"))) { _ in
            NoteVault.shared.lockNow()
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("com.apple.screensaver.didstart"))) { _ in
            NoteVault.shared.lockNow()
        }
        #endif
        .onChange(of: phase) { _, p in
            sync.setActive(p == .active)
            // Locked notes lock again when the app goes to the background.
            if p == .background { NoteVault.shared.lockNow() }
            if p == .active {
                Task { await PaneTips.appOpened() }
                Task { await setup.refresh() }
                if shareAsk.decided != true { Task { await shareAsk.refresh() } }
                askToShareSoon()
                Task { await NoteVault.shared.refresh() }
                // A browser's ask that came while the app was away (pushed or not) is picked up here.
                if let connectAsks { Task { await connectAsks.refresh() } }
                connectAsks?.setForeground(true)
                if let notices { Task { await notices.refresh() } }
                // The account's key never changes; if another device started fresh, this one
                // finds out here and gets the new key.
                Task {
                    await AccountCrypto.shared.recheck()
                    // This device says it holds the key, or learns it was removed.
                    await KeyDevices.shared.refresh(AccountCrypto.shared)
                }
                context.drainInbox()
                sync.schedule()
            } else {
                connectAsks?.setForeground(false)
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
        .onReceive(NotificationCenter.default.publisher(for: .paneNoteClosed)) { _ in askToShareSoon() }
        .onAppear { context.drainInbox() }
    }

    /// The share ask, a notice or the recovery key alert is on screen.
    private var somethingAsking: Bool {
        shareAsk.visible || notices?.current != nil || crypto.recoveryKeyChangeNeedsSaying
    }

    /// Another device with the key removed this one: its copy of the notes and of the key go,
    /// and it signs out. Said once on the sign-in screen.
    private func removedFromDevices() async {
        guard let account = backend.userID else { return }
        await removal.run(account: account)
    }

    /// The steps of this device's removal, in the order `DeviceRemoval` runs them.
    private var removal: DeviceRemoval {
        DeviceRemoval(
            push: {
                // Edits that never reached the server would be erased with the rest: they go up
                // first. The wait ends with the push, whose requests have their own timeouts; a
                // push that fails leaves the removal to go ahead.
                guard AccountLibrary.hasUnsynced(context) else { return }
                _ = try? await AccountCrypto.within(DeviceRemoval.pushLimit, sleep: { try await Task.sleep(for: $0) }) { @MainActor in
                    await sync.sync(pulling: false)
                }
            },
            dropKey: { AccountCrypto.shared.forgetLocalKey(of: $0) },
            erase: {
                await sync.stop()
                AccountLibrary.erase(context: context)
            },
            forget: { await KeyDevices.shared.removalDone(account: $0) },
            signOut: { await backend.signOut() })
    }

    /// The account's key is open here (or it isn't encrypted): sync, then everything that reads the library.
    private func openLibrary(_ client: SupabaseClient) async {
        // This device lists itself among the ones that hold the key (and obeys its removal).
        Task { await KeyDevices.shared.refresh(crypto) }
        // A browser can ask this device to approve an AI connection once it has the key.
        if connectAsks == nil, let user = backend.userID {
            let asks = ConnectAsks(client: client, user: user)
            connectAsks = asks
            Task { await asks.start() }
            asks.setForeground(phase == .active)
            // Pushes for asks, while the app isn't running.
            Task { await PushRegistration.shared.attach(account: user, service: SupabasePushTokens(client: client)) }
        }
        if notices == nil, let user = backend.userID {
            let n = AccountNotices(client: client, user: user)
            notices = n
            Task { await n.start() }
        }
        await sync.start()
        // Seed only when the server really has nothing, never after a failed sync. A real
        // account starts with an empty Notes folder: the setup card is its welcome.
        if sync.hasSynced {
            Seed.ensureLibrary(context, demo: false, welcome: false)
            sync.schedule()
        }
        await setup.refresh(force: true)
        // Tips wait for this: never a tip for something this account has used anywhere.
        await FeatureUse.refresh()
        await shareAsk.refresh()
        await InstallID.report(client)
    }

    /// A quiet moment: once things have settled, the share ask may come (see `ShareAsk`).
    private func askToShareSoon() {
        guard backend.state != .signedOut else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard backend.state != .signedOut, phase == .active else { return }
            shareAsk.moment(setupVisible: setup.visible || WhatsNewStore.shared.card != nil, tipShowing: PaneTips.all.contains { $0.shouldDisplay })
        }
    }
}

@MainActor
enum Seed {
    static func ensureLibrary(_ context: ModelContext, demo: Bool, welcome: Bool = true) {
        context.purgeExpiredTrash()
        guard context.allFolders().isEmpty else { return }
        let notes = context.createFolder(named: "Notes")
        // The imported-library capture shows exactly the imported counts, with no welcome note.
        if (welcome || demo) && !DemoData.importedLibrary { context.createNote(in: .folder(notes.id), body: Self.welcome) }
        if demo { DemoData.load(into: context, main: notes) }
        // A note that is already an app, next to the welcome note, so the first day shows what
        // your AI can make of a note.
        if welcome, !demo, !DemoData.importedLibrary, let url = Bundle.main.url(forResource: "sample-habit-tracker", withExtension: "html"),
           let html = try? String(contentsOf: url, encoding: .utf8) {
            let habits = context.createNote(in: .folder(notes.id), body: Capture.habitNote().replacingOccurrences(
                of: "Small things, most days. A ✓ means done.",
                with: "Small things, most days. A ✓ means done. This note is also an app, made by AI: switch between App and Text at the top."))
            habits.updatedAt = .now.addingTimeInterval(-60)
            NotePageStore.shared.setHere(habits.id, .init(html: html, by: "Amber Notes", at: .now))
        }
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

/// Captures only (`-uitest`): one screen on its own, or the setup card at a given step, so the
/// iPhone simulator can show them without anyone tapping through.
///   `-captureScreen connect`, `connect-chatgpt`, `connect-claude`, `connected-chatgpt`, `connect-incredible`, `settings`, `template`, `template-added`, `copy`, `signin`, `new-device`, `add-device` (the sheet as this device opens it), `add-device-type`, `add-device-confirm`, `add-device-done`, `key-kept`, `key-kept-unconfirmed`, `key-kept-only`, `key-checking` or `device-added-notice`; `-captureSetup 1…4` (4: the moment after your AI's first edit).
struct CaptureScreen: View {
    let name: String
    let backend: Backend

    static var requested: String? {
        ProcessInfo.processInfo.arguments.contains("-uitest") ? Capture.argument("-captureScreen") : nil
    }

    static var setupFlow: Bool {
        ProcessInfo.processInfo.arguments.contains("-uitest") && ProcessInfo.processInfo.arguments.contains("-captureSetupFlow")
    }

    static var setupProgress: SetupProgress? {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let n = Capture.argument("-captureSetup").flatMap(Int.init) else { return nil }
        // 4: your AI's first edit just landed ("That was your AI.").
        return SetupProgress(imported: n > 1, connected: n > 2, aiEdits: n > 3 ? 1 : 0)
    }

    static let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "capture")

    static var consentRequest: ConnectRequest? {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let name = Capture.argument("-captureConsent") else { return nil }
        let host = name.lowercased().contains("claude") ? "claude.ai" : "chatgpt.com"
        return ConnectRequest(id: UUID(), client_name: name, redirect_host: host, loopback: false, wants_write: true)
    }

    static let connections: [Connection] = [
        Connection(id: UUID(), name: "ChatGPT", kind: "oauth", can_write: true, created_at: .now.addingTimeInterval(-86400 * 3),
                   last_used_at: .now.addingTimeInterval(-720), revoked_at: nil, redirect_host: "chatgpt.com"),
        Connection(id: UUID(), name: "Claude Code", kind: "token", can_write: true, created_at: .now.addingTimeInterval(-86400),
                   last_used_at: .now.addingTimeInterval(-3 * 3600), revoked_at: nil, redirect_host: nil),
    ]

    var body: some View {
        switch name {
        case "connect":
            NavigationStack {
                Form {
                    ConnectAISection(client: SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "capture"), preview: Self.connections)
                }
                .formStyle(.grouped)
                .navigationTitle("Connect an AI")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
            }
        case "connect-incredible", "connected-incredible":
            NavigationStack {
                Form { IncredibleGuide(client: Self.client, connected: name.hasPrefix("connected-")) }
                    .formStyle(.grouped)
                    .navigationTitle("Connect Incredible")
                    #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                    #endif
            }
        case let guide where guide.hasPrefix("connect-") || guide.hasPrefix("connected-"):
            // Connect ChatGPT or Claude, as the guide sheet shows it, or just after Allow.
            if let plan = WebConnectPlan.forAI(guide.hasSuffix("claude") ? "Claude" : "ChatGPT") {
                NavigationStack {
                    Form { WebConnectGuide(plan: plan, client: Self.client, connected: guide.hasPrefix("connected-")) }
                        .formStyle(.grouped)
                        .navigationTitle("Connect \(plan.ai)")
                        #if os(iOS)
                        .navigationBarTitleDisplayMode(.inline)
                        #endif
                }
            }
        case "settings":
            // Settings as a signed-in account sees it (connections can't load here).
            SettingsView(backend: Backend(testClient: Self.client, email: "appreview@norditech.se"), sync: nil)
        case "template", "template-added", "copy":
            // "Use this template" ready to add, just added, and "Use this note".
            NoteSourceCapture(name: name)
        case let screen where screen.hasPrefix("add-device") || screen == "new-device" || screen == "key-checking" || screen.hasPrefix("key-kept") || screen == "device-added-notice":
            AddDeviceCapture(name: screen)
        default:
            SignInView(backend: backend)
        }
    }
}

/// The account's notices and "your recovery key changed", each a plain alert, one at a time. AI
/// connections that came together are one alert. Disconnect is a plain button there; the red one
/// is on the confirmation after it.
private struct NoticeAlerts: ViewModifier {
    let notices: AccountNotices?
    let crypto: AccountCrypto
    @Binding var problem: String?
    /// Disconnect was chosen on a notice: asked once more, in red.
    @State private var disconnecting: AccountNotice?

    func body(content: Content) -> some View {
        let notice = notices?.current
        content
            .modifier(noticeAlert)
            .modifier(confirmDisconnect(over: notice))
            .alert(PrivacyCopy.recoveryChangedTitle, isPresented: Binding(get: { notice == nil && disconnecting == nil && crypto.recoveryKeyChangeNeedsSaying },
                                                                         set: { if !$0 { crypto.recoveryKeyChangeShown() } })) {
                Button("OK", role: .cancel) { crypto.recoveryKeyChangeShown() }
            } message: {
                Text(PrivacyCopy.recoveryChangedAlert)
            }
            .alert("Couldn't disconnect", isPresented: Binding(get: { problem != nil && notice == nil }, set: { if !$0 { problem = nil } })) {
                Button("OK", role: .cancel) { problem = nil }
            } message: {
                Text(problem ?? "")
            }
    }

    /// The notice showing: one, or the AI connections that came together.
    private var noticeAlert: NoticeAlert {
        NoticeAlert(notices: notices, disconnect: { disconnecting = $0 })
    }

    private func confirmDisconnect(over notice: AccountNotice?) -> ConfirmDisconnect {
        ConfirmDisconnect(disconnecting: $disconnecting, blocked: notice != nil) { n in
            do { try await notices?.disconnect(n) } catch { problem = "Couldn't disconnect it. Try again in Settings \u{203A} Connect an AI." }
        }
    }
}

private struct NoticeAlert: ViewModifier {
    let notices: AccountNotices?
    let disconnect: (AccountNotice) -> Void

    func body(content: Content) -> some View {
        let notice = notices?.current
        let group = notices?.group ?? []
        let text = group.text
        let canDisconnect = group.count == 1 && notice?.kind == .aiConnected && notice?.grant_id != nil
        return content
            .alert(text.title, isPresented: Binding(get: { notice != nil }, set: { if !$0, notices?.current == notice { notices?.dismiss() } }),
                   presenting: notice) { n in
                if canDisconnect {
                    Button("Disconnect\u{2026}") {
                        disconnect(n)
                        notices?.dismiss()
                    }
                    .accessibilityIdentifier("notice.disconnect")
                }
                Button("OK", role: .cancel) { notices?.dismiss() }
                    .accessibilityIdentifier("notice.ok")
            } message: { _ in
                Text(text.message)
            }
    }
}

/// Disconnect, asked once more: the red button is here.
private struct ConfirmDisconnect: ViewModifier {
    @Binding var disconnecting: AccountNotice?
    /// Another alert is up.
    let blocked: Bool
    let run: (AccountNotice) async -> Void

    func body(content: Content) -> some View {
        let n = disconnecting
        return content
            .alert("Disconnect \(n?.name ?? "this AI")?", isPresented: Binding(get: { n != nil && !blocked }, set: { if !$0 { disconnecting = nil } }),
                   presenting: n) { n in
                Button("Disconnect", role: .destructive) {
                    disconnecting = nil
                    Task { await run(n) }
                }
                .accessibilityIdentifier("notice.confirmDisconnect")
                Button("Cancel", role: .cancel) { disconnecting = nil }
            } message: { _ in
                Text("It loses access to your notes right away.")
            }
    }
}

/// Just signed in, the key gate waits on the key check alone: its fetch gives up after a few
/// seconds and says the server can't be reached. The note lock's setup is fetched alongside it,
/// never ahead of it, since that request waits as long as the network lets it.
@MainActor
struct SignedInStartup {
    var refreshLock: @MainActor () async -> Void
    var checkKey: @MainActor () async -> Void

    func run() async {
        Task { await refreshLock() }
        await checkKey()
    }
}
