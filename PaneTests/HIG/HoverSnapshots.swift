#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import Pane

/// What's under the pointer, before and after: the notes window at rest and with a folder and a
/// note hovered (the selection stays stronger), and the Get set up card at rest and with its
/// buttons hovered. A capture has no pointer, so `hoverPreview` draws the hover.
/// Runs only when AMBER_HIG_SHOTS is set: `TEST_RUNNER_AMBER_HIG_SHOTS=/path scripts/qa-test.sh PaneTests/HoverSnapshots`.
@MainActor @Suite(.serialized) struct HoverSnapshots {
    @Test(arguments: [false, true])
    func window(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let c = try AppSnapshotTests.container()
        let size = CGSize(width: 1180, height: 760)
        try await AppSnapshotTests.withLastNote(c, "Evening tracker") {
            try await AppSnapshotTests.shoot(RootView().modelContainer(c), name: "mac-hover-window-rest-\(mode)", size: size, dark: dark)
            try await AppSnapshotTests.shoot(RootView().environment(\.hoverPreview, ["Travel", "Groceries"]).modelContainer(c),
                                             name: "mac-hover-window-hover-\(mode)", size: size, dark: dark)
        }
    }

    /// The sidebar on its own: in the window its glass doesn't draw offscreen.
    @Test(arguments: [false, true])
    func sidebar(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        let c = try AppSnapshotTests.container()
        let travel = try #require(c.mainContext.allFolders().first { $0.name == "Ideas" })
        func sidebar(_ hover: Set<String>) -> some View {
            NavigationStack { SidebarView(scope: .constant(.folder(travel.id)), onNewNote: {}) }
                .environment(\.hoverPreview, hover)
                .frame(width: 260, height: 420)
                .modelContainer(c)
                .tint(Color(PColor.paneAccent))
        }
        try await AppSnapshotTests.render(sidebar([]), name: "mac-hover-sidebar-rest-\(mode)", dark: dark)
        try await AppSnapshotTests.render(sidebar(["Travel", "Q4 planning"]), name: "mac-hover-sidebar-hover-\(mode)", dark: dark)
    }

    @Test(arguments: [false, true])
    func setupCard(dark: Bool) async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let mode = dark ? "dark" : "light"
        func card(_ hover: Set<String>) -> some View {
            SetupCard(progress: SetupProgress(), celebrating: false, onImport: {}, onImportFrom: { _ in }, onStartFresh: {}, onConnect: {}, onHide: {})
                .environment(\.hoverPreview, hover)
                .frame(width: 320)
                .padding(16)
                .tint(Color(PColor.paneAccent))
        }
        try await AppSnapshotTests.render(card([]), name: "mac-hover-setup-rest-\(mode)", dark: dark)
        try await AppSnapshotTests.render(card(["*"]), name: "mac-hover-setup-hover-\(mode)", dark: dark)
    }
}
#endif
