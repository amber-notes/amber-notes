import SwiftData
import SwiftUI

@main
struct PaneApp: App {
    let container: ModelContainer
    @State private var backend: Backend
    @State private var sync: SyncEngine

    init() {
        let args = ProcessInfo.processInfo.arguments
        let inMemory = args.contains("-uitest") || args.contains("-synctest") || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if inMemory { UserDefaults.standard.removeObject(forKey: "lastScope") }
        let config = ModelConfiguration("Pane", isStoredInMemoryOnly: inMemory)
        container = try! ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: config)
        let backend = Backend()
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

    var body: some Scene {
        WindowGroup {
            AppGate(backend: backend, sync: sync)
                .tint(Color(PColor.paneAccent))
                .preferredColorScheme(Self.testScheme)
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
        .commands { PaneCommands() }
        #endif

        #if os(macOS)
        Settings {
            SettingsView(backend: backend, sync: sync)
        }
        #endif
    }
}

#if os(macOS)
import AppKit

/// Signed out, the window is just the sign-in card: small, glassy, no title bar.
/// Signed in, it becomes the normal three-column window.
private struct WindowShaper: NSViewRepresentable {
    let compact: Bool
    /// The sign-in card's own size; the compact window wraps it exactly.
    var cardSize: CGSize = .zero

    func makeNSView(context: Context) -> NSView { NSView() }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            guard !compact || cardSize.height > 0 else { return }
            let target = compact ? cardSize : CGSize(width: 1180, height: 760)
            // No system title bar or toolbar while signed out: just the card and the window buttons.
            window.toolbar?.isVisible = !compact
            // Notes' full-height toolbar with large buttons; compact only for the sign-in card.
            window.toolbarStyle = compact ? .unifiedCompact : .unified
            window.titlebarSeparatorStyle = compact ? .none : .automatic
            // Card mode keeps close and minimise; zoom makes no sense for a fixed-size card.
            window.standardWindowButton(.zoomButton)?.isEnabled = !compact
            window.contentMinSize = compact ? CGSize(width: 300, height: 300) : CGSize(width: 760, height: 520)
            // Compact: the card is the whole window, title-bar area included.
            var frame = compact ? CGRect(origin: .zero, size: target) : window.frameRect(forContentRect: CGRect(origin: .zero, size: target))
            guard abs(window.frame.width - frame.width) > 2 || abs(window.frame.height - frame.height) > 2 else { return }
            // Grow or shrink around the window's centre.
            frame.origin = CGPoint(x: window.frame.midX - frame.width / 2, y: window.frame.midY - frame.height / 2)
            if let screen = window.screen?.visibleFrame {
                frame.origin.x = min(max(frame.origin.x, screen.minX), screen.maxX - frame.width)
                frame.origin.y = min(max(frame.origin.y, screen.minY), screen.maxY - frame.height)
            }
            window.setFrame(frame, display: true, animate: true)
        }
    }
}
#endif

/// Sign-in when sync is on and you're signed out; the library otherwise.
struct AppGate: View {
    let backend: Backend
    let sync: SyncEngine
    @State private var cardSize: CGSize = .zero
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
                    .transition(.opacity)
            }
        }
        #if os(macOS)
        .background(WindowShaper(compact: backend.state == .signedOut, cardSize: cardSize))
        #endif
        .animation(.easeOut(duration: 0.25), value: backend.state)
        .task(id: backend.state) {
            guard case .signedIn = backend.state else { await sync.stop(); return }
            await sync.start()
            // Seed only when the server really has nothing, never after a failed sync.
            if sync.hasSynced {
                Seed.ensureLibrary(context, demo: false)
                sync.schedule()
            }
        }
        .onChange(of: phase) { _, p in
            if p == .active {
                context.drainInbox()
                sync.schedule()
            }
        }
        .onAppear { context.drainInbox() }
    }
}

@MainActor
enum Seed {
    static func ensureLibrary(_ context: ModelContext, demo: Bool) {
        context.purgeExpiredTrash()
        guard context.allFolders().isEmpty else { return }
        let notes = context.createFolder(named: "Notes")
        context.createNote(in: .folder(notes.id), body: welcome)
        if demo { DemoData.load(into: context, main: notes) }
    }

    static let welcome = """
    Welcome to Amber Notes

    Amber Notes is a place for notes. Write in **markdown** and it styles itself as you type, with the syntax hidden until you need it.

    ## The basics
    - [ ] Tap a circle to check it off
    - [x] Lists continue when you press Return
    - Press Return on an empty item to end a list

    > Quotes, `inline code`, ~~strikethrough~~ and [links](https://apple.com) all work.

    Keep details in a **sub-note**: choose Format → Sub-note and a whole note opens, linked from here.

    | Shortcut | Does |
    | --- | --- |
    | ⌘B | Bold |
    | ⌘⇧L | Checklist |
    """
}
