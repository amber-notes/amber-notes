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
        // Gone for good. (Before 2026-10-08 `context.delete(folder)` here was Library's delete, now
        // `trash`, which only moves a folder to Recently Deleted and marks it to go up: the old
        // account's folders stayed and were pushed into the next account, and back into their own.)
        context.wipeLocalLibrary(files: files)
        memoryKeys.forEach { defaults.removeObject(forKey: $0) }
        // The sync cursor was keyed with either spelling of the old id.
        for key in ["syncCursor.\(previous)", "syncCursor.\(previous.uppercased())"] { defaults.removeObject(forKey: key) }
        return true
    }

    /// Whether anything on this device hasn't reached the server yet.
    static func hasUnsynced(_ context: ModelContext) -> Bool {
        let notes = (try? context.fetchCount(FetchDescriptor<Note>(predicate: #Predicate { $0.dirty }))) ?? 0
        let folders = (try? context.fetchCount(FetchDescriptor<Folder>(predicate: #Predicate { $0.dirty }))) ?? 0
        let files = (try? context.fetchCount(FetchDescriptor<Attachment>(predicate: #Predicate { $0.dirty || !$0.uploaded }))) ?? 0
        return notes + folders + files > 0
    }

    /// This device was removed from the account's devices: its copy of the notes goes, with the
    /// memory of where sync was, so signing in again starts from an empty library.
    static func erase(context: ModelContext, defaults: UserDefaults = .standard, files: URL? = nil) {
        context.wipeLocalLibrary(files: files)
        memoryKeys.forEach { defaults.removeObject(forKey: $0) }
        if let owner = defaults.string(forKey: ownerKey) {
            for key in ["syncCursor.\(owner)", "syncCursor.\(owner.uppercased())"] { defaults.removeObject(forKey: key) }
        }
        defaults.removeObject(forKey: ownerKey)
    }
}
