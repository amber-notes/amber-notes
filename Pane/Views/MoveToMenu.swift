import SwiftUI
#if os(macOS)
import AppKit

/// Whether a menu is open. A toolbar's menus are built with the toolbar and again whenever it
/// changes, items and all; what is long (a button per folder) waits for this instead.
@MainActor
@Observable
final class MenuTracking {
    static let shared = MenuTracking()

    /// True from the moment a menu opens until a moment after it closes (the chosen item's
    /// action runs after the menu has closed, and must still be there).
    private(set) var open = false
    @ObservationIgnored private var closing: Task<Void, Never>?

    private init() {
        let center = NotificationCenter.default
        center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil) { _ in
            guard Thread.isMainThread else { return }
            MainActor.assumeIsolated { MenuTracking.shared.began() }
        }
        center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: nil) { _ in
            guard Thread.isMainThread else { return }
            MainActor.assumeIsolated { MenuTracking.shared.ended() }
        }
    }

    private func began() {
        closing?.cancel()
        closing = nil
        if !open { open = true }
    }

    private func ended() {
        closing?.cancel()
        closing = Task {
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { self.open = false }
        }
    }
}
#endif

/// "Move to" in a toolbar's menu: a button per folder, listed when a menu opens. Listed with the
/// toolbar, 150 folders were half of a 1.5 s block at launch (SwiftUI building 150 menu items
/// before the first frame, and again with each change to the toolbar).
struct MoveToMenu: View {
    /// Read when the folders are listed.
    let folders: () -> [Folder]
    /// The folder the item is in: its button is off.
    let current: UUID?
    let move: (Folder) -> Void

    /// How many times the folders were listed (tests).
    nonisolated(unsafe) static var listed = 0

    var body: some View {
        Menu("Move to", systemImage: "folder") {
            #if os(macOS)
            if MenuTracking.shared.open { items }
            #else
            items
            #endif
        }
    }

    private var items: some View {
        Self.listed += 1
        return ForEach(folders()) { f in
            Button(f.name) { move(f) }.disabled(current == f.id)
        }
    }
}
