import Foundation
import OSLog
import Supabase
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Push for AI connection asks (APNs).
//
// While signed in with the account's key, the iPhone and Mac apps register for remote
// notifications and put this device's token in public.device_tokens (register_device_token).
// When a browser asks the account's devices to approve a connection, the MCP function sends a
// push that says only "an app asks" and the request's id. The push is never trusted for anything
// but "look now": tapping it opens the ask the same way a local notification does, and the app
// fetches the ask itself and runs the full check (snapshot, commit, typed number).
//
// Signing out deletes this device's row while the session can still do it, then stops
// registering. Deleting the account removes every row on the server (cascade).

/// Which APNs server this build's tokens belong to.
enum APNsEnvironment: String, Equatable, Sendable {
    case sandbox, production

    /// Read from the embedded provisioning profile. TestFlight and App Store builds are
    /// production (their profiles say `aps-environment` = production); builds installed from
    /// Xcode with a development profile are sandbox.
    static var current: APNsEnvironment {
        resolve(profile: profileURL.flatMap { try? Data(contentsOf: $0) })
    }

    /// The profile's answer, or, without one (or one that doesn't say): sandbox for debug
    /// builds, production otherwise.
    static func resolve(profile: Data?) -> APNsEnvironment {
        if let profile, let env = fromProfile(profile) { return env }
        #if DEBUG
        return .sandbox
        #else
        return .production
        #endif
    }

    /// A provisioning profile is a signed CMS blob with the plist inside, between "<?xml" and
    /// "</plist>". Its Entitlements say `aps-environment` (iOS) or
    /// `com.apple.developer.aps-environment` (Mac): development → sandbox, production → production.
    static func fromProfile(_ data: Data) -> APNsEnvironment? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound ..< data.endIndex) else { return nil }
        let plist = data.subdata(in: start.lowerBound ..< end.upperBound)
        guard let dict = try? PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any],
              let entitlements = dict["Entitlements"] as? [String: Any],
              let value = (entitlements["aps-environment"] ?? entitlements["com.apple.developer.aps-environment"]) as? String
        else { return nil }
        switch value {
        case "development": return .sandbox
        case "production": return .production
        default: return nil
        }
    }

    /// iOS: embedded.mobileprovision in the app; Mac: Contents/embedded.provisionprofile.
    private static var profileURL: URL? {
        #if os(macOS)
        let url = Bundle.main.bundleURL.appending(path: "Contents/embedded.provisionprofile")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
        #else
        return Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
        #endif
    }
}

/// What register_device_token takes.
struct PushTokenParams: Encodable, Equatable, Sendable {
    var p_device: String
    var p_platform: String
    var p_token: String
    var p_environment: String
}

/// Where this device's token goes; tests answer for it.
@MainActor
protocol PushTokenService: AnyObject {
    func register(_ params: PushTokenParams) async throws
    /// Deletes this device's row (the account's own, by RLS).
    func remove(device: UUID) async throws
}

@MainActor
final class SupabasePushTokens: PushTokenService {
    private let client: SupabaseClient
    init(client: SupabaseClient) { self.client = client }

    func register(_ params: PushTokenParams) async throws {
        try await client.rpc("register_device_token", params: params).execute()
    }

    func remove(device: UUID) async throws {
        try await client.from("device_tokens").delete().eq("device_id", value: device.uuidString.lowercased()).execute()
    }
}

/// Registers this device for pushes while an account is signed in, and keeps its token row current.
@MainActor
final class PushRegistration {
    static let shared = PushRegistration()

    /// Asking the system for a token, and stopping; tests answer for it.
    struct System {
        var register: @MainActor () -> Void
        var unregister: @MainActor () -> Void

        static let live = System(
            register: {
                #if os(macOS)
                NSApplication.shared.registerForRemoteNotifications()
                #else
                UIApplication.shared.registerForRemoteNotifications()
                #endif
            },
            unregister: {
                #if os(macOS)
                NSApplication.shared.unregisterForRemoteNotifications()
                #else
                UIApplication.shared.unregisterForRemoteNotifications()
                #endif
            }
        )
    }

    private struct Sent: Equatable {
        var account: UUID
        var params: PushTokenParams
    }

    private let device: () -> UUID
    private let environment: () -> APNsEnvironment
    private let system: System
    /// The APNs token, lowercase hex, once the system has given one.
    private(set) var token: String?
    private var account: UUID?
    private var service: PushTokenService?
    /// The last registration the server took; the same one isn't sent again.
    private var sent: Sent?
    private(set) var registered = false

    /// The device id is the one the app uses for pane_devices (InstallID).
    init(device: @escaping () -> UUID = { InstallID.value },
         environment: @escaping () -> APNsEnvironment = { APNsEnvironment.current },
         system: System = .live) {
        self.device = device
        self.environment = environment
        self.system = system
    }

    /// Signed in (with the key open): register, and send the token for this account. Another
    /// account than before sends it again.
    func attach(account: UUID, service: PushTokenService) async {
        if self.account != account { sent = nil }
        self.account = account
        self.service = service
        if !registered {
            registered = true
            system.register()
        }
        await send()
    }

    /// Signed out: no more pushes to this device.
    func detach() {
        account = nil
        service = nil
        sent = nil
        guard registered else { return }
        registered = false
        system.unregister()
    }

    /// The system's token (on every launch, and whenever it changes).
    func received(token data: Data) async {
        token = Self.hex(data)
        await send()
    }

    /// Sign-out: this device's row is deleted while the session can still do it, then it stops.
    func signingOut() async {
        if let service {
            do { try await service.remove(device: device()) } catch {
                pushLog.error("removing the device token failed: \(String(describing: error), privacy: .public)")
            }
        }
        detach()
    }

    /// The account is gone (the server removed its rows with it): just stop here.
    func accountDeleted() { detach() }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    static var platform: String { InstallID.platform }

    private func send() async {
        guard let account, let service, let token else { return }
        let params = PushTokenParams(p_device: device().uuidString.lowercased(), p_platform: Self.platform,
                                     p_token: token, p_environment: environment().rawValue)
        let next = Sent(account: account, params: params)
        guard sent != next else { return }
        do {
            try await service.register(params)
            // Still the same account (not signed out or switched meanwhile).
            if self.account == account { sent = next }
        } catch {
            pushLog.error("registering the device token failed: \(String(describing: error), privacy: .public)")
        }
    }
}

let pushLog = Logger(subsystem: "dev.emilwagman.pane", category: "push")

// MARK: App delegate

#if os(iOS)
/// Remote-notification callbacks, and the notification delegate installed before launch finishes
/// (so a launch from tapping a push reaches it).
final class PaneAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if !PaneApp.isUnitTestHost { ConnectCenter.shared.installNotifications() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushRegistration.shared.received(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        pushLog.error("no push token: \(String(describing: error), privacy: .public)")
    }
}
#else
final class PaneAppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        if !PaneApp.isUnitTestHost { ConnectCenter.shared.installNotifications() }
    }

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushRegistration.shared.received(token: deviceToken) }
    }

    /// Builds without the push entitlement (ad-hoc, the Developer ID download) end up here.
    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        pushLog.error("no push token: \(String(describing: error), privacy: .public)")
    }
}
#endif
