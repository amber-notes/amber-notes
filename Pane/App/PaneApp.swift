import SwiftData
import SwiftUI

@main
struct PaneApp: App {
    let container: ModelContainer

    init() {
        let args = ProcessInfo.processInfo.arguments
        let inMemory = args.contains("-uitest") || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if inMemory { UserDefaults.standard.removeObject(forKey: "lastScope") }
        let config = ModelConfiguration("Pane", isStoredInMemoryOnly: inMemory)
        container = try! ModelContainer(for: Folder.self, Note.self, configurations: config)
        Seed.ensureLibrary(container.mainContext, demo: args.contains("-demo"))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
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
    Welcome to Pane

    Pane is a place for notes. Write in **markdown** and it styles itself as you type, with the syntax hidden until you need it.

    ## The basics
    - [ ] Tap a circle to check it off
    - [x] Lists continue when you press Return
    - Press Return on an empty item to end a list

    > Quotes, `inline code`, ~~strikethrough~~ and [links](https://apple.com) all work.

    | Shortcut | Does |
    | --- | --- |
    | ⌘B | Bold |
    | ⌘⇧L | Checklist |
    """
}
