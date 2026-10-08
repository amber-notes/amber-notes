#if os(macOS)
import AppKit

/// The Mac download was "Amber Notes.app" until 1.2. A Sparkle update replaces what is inside the
/// bundle and keeps the file's name (the name-matching option is compiled out of Sparkle's own
/// builds, and the installer that runs is the old version's anyway), so the first launch of the
/// renamed app moves its own bundle to "Pinto Notes.app" beside it and opens that.
///
/// Only the file's name changes. The keychain items (found by the app's signature), the library
/// and the session (found by its bundle id) don't depend on where the app is.
enum BundleRename {
    static let oldName = "Amber Notes.app"
    static let newName = "Pinto Notes.app"

    /// Where this bundle should move, or nil to leave it: only a bundle still called
    /// "Amber Notes.app", never over an app already there (which is also the case when the app was
    /// opened through the link this leaves behind), and never where it can't be moved (the
    /// disk image, or the random read-only place Gatekeeper runs a quarantined app from).
    static func destination(for bundle: URL, exists: (URL) -> Bool) -> URL? {
        guard bundle.lastPathComponent == oldName else { return nil }
        guard !bundle.path.contains("/AppTranslocation/"), !bundle.path.hasPrefix("/Volumes/") else { return nil }
        let to = bundle.deletingLastPathComponent().appendingPathComponent(newName, isDirectory: true)
        return exists(to) ? nil : to
    }

    /// Call first thing at launch, before the library opens. When the bundle moves, the app
    /// opens again from the new name and this copy ends without having touched anything. When
    /// it can't move (no permission for the folder) or can't open again, it stays "Amber Notes.app"
    /// and runs as usual; the next launch tries again.
    static func moveAndReopenIfNeeded(bundle: URL = Bundle.main.bundleURL, files: FileManager = .default) {
        guard let to = destination(for: bundle, exists: { files.fileExists(atPath: $0.path) }) else { return }
        do { try files.moveItem(at: bundle, to: to) } catch { return }
        leaveLink(at: bundle, files: files)
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        let done = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var opened = false
        NSWorkspace.shared.openApplication(at: to, configuration: config) { app, _ in
            opened = app != nil
            done.signal()
        }
        if done.wait(timeout: .now() + 15) == .success, opened { exit(0) }
        // This copy keeps running, so it goes back to the path it was loaded from.
        try? files.removeItem(at: bundle)   // the link, never a folder: destination(for:) saw nothing else there
        try? files.moveItem(at: to, to: bundle)
    }

    /// A Dock icon or a Login Items entry made for "Amber Notes.app" holds that path (the update
    /// gave the bundle a new identity, so their bookmarks don't follow it). A hidden link at the
    /// old path, pointing to the new name beside it, keeps them opening the app. Finder doesn't
    /// show it, so there is still one app in the folder.
    static func leaveLink(at old: URL, files: FileManager = .default) {
        guard (try? files.createSymbolicLink(atPath: old.path, withDestinationPath: newName)) != nil else { return }
        _ = old.withUnsafeFileSystemRepresentation { lchflags($0, UInt32(UF_HIDDEN)) }
    }
}
#endif
