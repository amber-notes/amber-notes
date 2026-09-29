import Foundation
import SwiftData

/// This device's library belongs to one account at a time.
///
/// When a different account signs in, the old library (and its unsynced edits) must never be
/// shown or pushed into the new one. It's cleared before the app reports sign-in, so the
/// note list never flashes someone else's notes, and the "reopen where you were" memory goes
/// with it, so the app never opens a note from another account.
@MainActor
enum AccountLibrary {
    static let ownerKey = "syncOwner"
    /// Per-account memories of where you were (RootView, the menu bar panel).
    static let memoryKeys = ["lastNote", "lastScope"]

    /// Records `user` as this device's account. Returns true when it replaced another
    /// account's library. The first account ever (nothing recorded) keeps the local library,
    /// so notes written before signing in are synced up.
    @discardableResult
    static func adopt(_ user: UUID, context: ModelContext, defaults: UserDefaults = .standard, files: URL? = nil) -> Bool {
        let id = user.uuidString.lowercased()
        let previous = defaults.string(forKey: ownerKey)
        defaults.set(id, forKey: ownerKey)
        guard let previous, previous != id else { return false }
        for n in (try? context.fetch(FetchDescriptor<Note>())) ?? [] { context.delete(n) }
        for f in (try? context.fetch(FetchDescriptor<Folder>())) ?? [] { context.delete(f) }
        for a in (try? context.fetch(FetchDescriptor<Attachment>())) ?? [] { context.delete(a) }
        try? context.save()
        try? FileManager.default.removeItem(at: files ?? FileStore.root)
        memoryKeys.forEach { defaults.removeObject(forKey: $0) }
        // The sync cursor was keyed with either spelling of the old id.
        for key in ["syncCursor.\(previous)", "syncCursor.\(previous.uppercased())"] { defaults.removeObject(forKey: key) }
        return true
    }
}
