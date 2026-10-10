import Foundation

/// Which app this is: Amber Notes, or Amber Notes Beta, the build on the staging backend
/// (Config/Beta.xcconfig, docs/Technical/staging.md). Read from Info.plist, which the build
/// settings fill; the defaults are Amber Notes' own.
enum AppIdentity {
    /// The app's URL scheme: ambernotes, or ambernotes-beta.
    static let scheme = info("PaneURLScheme") ?? "ambernotes"
    /// Keychain service names start with this: dev.emilwagman.pane, or dev.emilwagman.pane.beta, so
    /// Amber Notes Beta never reads or replaces the real app's session, keys or locks.
    static let keychainPrefix = info("PaneBundleID") ?? "dev.emilwagman.pane"
    /// The App Group the share extension hands items to the app through.
    static let appGroup = info("PaneAppGroup") ?? "group.dev.emilwagman.pane"
    /// Website hosts whose /open/… links the app handles: ambernotes.app, pintonotes.com (the new
    /// name, alongside; old links keep working), and the site the build shares to when that's
    /// another public one (the staging site).
    static let webHosts: Set<String> = {
        var hosts: Set<String> = ["ambernotes.app", "www.ambernotes.app", "pintonotes.com", "www.pintonotes.com"]
        if let s = info("PaneShareURL"), let u = URL(string: s), u.scheme == "https", let host = u.host?.lowercased() { hosts.insert(host) }
        return hosts
    }()

    private static func info(_ key: String) -> String? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: key) as? String, !s.isEmpty, !s.hasPrefix("$(") else { return nil }
        return s
    }
}
