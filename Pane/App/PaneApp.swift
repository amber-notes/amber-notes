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

    var body: some Scene {
        WindowGroup {
            AppGate(backend: backend, sync: sync)
                .tint(Color(PColor.paneAccent))
        }
        .modelContainer(container)
        #if os(macOS)
        .defaultSize(width: 1180, height: 760)
        .windowToolbarStyle(.unified)
        .commands { PaneCommands() }
        #endif
    }
}

/// Sign-in when sync is on and you're signed out; the library otherwise.
struct AppGate: View {
    let backend: Backend
    let sync: SyncEngine
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            switch backend.state {
            case .signedOut:
                SignInView(backend: backend)
                    .transition(.opacity)
            case .disabled, .signedIn:
                RootView()
                    .environment(backend)
                    .environment(sync)
                    .transition(.opacity)
            }
        }
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
        .onChange(of: phase) { _, p in if p == .active { sync.schedule() } }
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

    <details>
    <summary>Cards hold the details</summary>

    Tuck extra information into a card. Tap it to open, and it scrolls on its own.

    - [ ] Tap the circle inside a card
    - Use **Edit Card** to change what's in it

    </details>

    | Shortcut | Does |
    | --- | --- |
    | ⌘B | Bold |
    | ⌘⇧L | Checklist |
    """
}
