import Foundation
import Network
import Observation

/// Whether this device has a way onto the network, as the system sees it (NWPathMonitor): airplane
/// mode, or no Wi-Fi and no cellular, is down. It can't tell that a plane's Wi-Fi lets nothing
/// through until you pay; a sync that fails says that (`SyncEngine.reach`).
///
/// While it's down nothing polls (sync's fallback poll and minute pull, the key check, AI
/// connection asks), and the moment it's back everything syncs, instead of waiting for the next
/// poll. Edits are never held back by it: they're saved here and go up when a sync gets through.
@MainActor
@Observable
final class NetworkPath {
    static let shared = NetworkPath()

    private(set) var isUp = true
    @ObservationIgnored private var monitor: NWPathMonitor?
    @ObservationIgnored private var watchers: [UUID: @MainActor (Bool) -> Void] = [:]

    /// Starts following the system's network path (the app, once at launch).
    func start() {
        guard monitor == nil else { return }
        let m = NWPathMonitor()
        m.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.systemSays(up) }
        }
        m.start(queue: DispatchQueue(label: "dev.emilwagman.pane.network-path"))
        monitor = m
        #if DEBUG || QA
        DebugOffline.listen()
        if NetFault.config.offline { force(down: true) }
        #endif
    }

    @ObservationIgnored private var systemUp = true
    /// Debug builds: offline on purpose (`-netOffline`, or the toggle in DebugOffline).
    @ObservationIgnored private var forcedDown = false

    private func systemSays(_ up: Bool) {
        systemUp = up
        update()
    }

    /// Tests, and the debug toggle: the network is down (or back) whatever the system says.
    func force(down: Bool) {
        forcedDown = down
        update()
    }

    private func update() {
        let up = systemUp && !forcedDown
        guard up != isUp else { return }
        isUp = up
        for w in watchers.values { w(up) }
    }

    /// `change` runs each time the path goes down or comes back. Keep the token; dropping it
    /// (`forget`) stops the calls.
    @discardableResult
    func watch(_ change: @escaping @MainActor (Bool) -> Void) -> UUID {
        let id = UUID()
        watchers[id] = change
        return id
    }

    func forget(_ token: UUID) { watchers[token] = nil }
}

#if DEBUG || QA
/// Debug builds: going offline and back while the app runs, from outside it, so the simulator can
/// be tried offline without touching the Mac's network:
///
///     xcrun simctl spawn booted notifyutil -p dev.emilwagman.pane.debug.offline
///     xcrun simctl spawn booted notifyutil -p dev.emilwagman.pane.debug.online
///
/// Every request then fails as not connected (NetFault, which the app's session goes through
/// with `-netToggle`), realtime disconnects, and NetworkPath says down.
enum DebugOffline {
    static let offlineName = "dev.emilwagman.pane.debug.offline"
    static let onlineName = "dev.emilwagman.pane.debug.online"
    /// Realtime's socket doesn't go through NetFault: the app disconnects and reconnects it.
    @MainActor static var realtime: (_ up: Bool) -> Void = { _ in }

    static func listen() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        for name in [offlineName, onlineName] {
            CFNotificationCenterAddObserver(center, nil, { _, _, name, _, _ in
                let offline = (name?.rawValue as String?) == DebugOffline.offlineName
                Task { @MainActor in DebugOffline.set(offline: offline) }
            }, name as CFString, nil, .deliverImmediately)
        }
    }

    @MainActor static func set(offline: Bool) {
        var c = NetFault.config
        c.offline = offline
        NetFault.config = c
        realtime(!offline)
        NetworkPath.shared.force(down: offline)
    }
}
#endif
