#if SPARKLE
import Combine
import Sparkle
import SwiftUI

/// Updates for the Mac download (the Developer ID build, target PaneDirect). The App Store
/// and TestFlight builds don't compile this: they get updates from Apple.
///
/// Sparkle checks the appcast once a day (SUScheduledCheckInterval in the target's Info.plist)
/// and shows its standard window when a new version is out; "Check for Updates…" asks now.
@MainActor
final class Updater: ObservableObject {
    static let shared = Updater()

    let controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    @Published private(set) var canCheck = false

    private init() {
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
    }

    func checkForUpdates() { controller.checkForUpdates(nil) }
}

/// "Check for Updates…" under the app menu, right after About, where Mac apps keep it.
struct UpdaterCommands: Commands {
    @ObservedObject private var updater = Updater.shared

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Check for Updates…") { updater.checkForUpdates() }
                .disabled(!updater.canCheck)
        }
    }
}
#endif
