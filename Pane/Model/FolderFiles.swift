import Foundation
import SwiftData

/// Files kept in a folder on their own (PDFs, images, spreadsheets), listed with the folder's notes
/// and apps. Deleting one moves it to Recently Deleted for 30 days, like a note; deleting a folder
/// takes its files there too. The server does the same for every device (20261007165000).
@MainActor
extension ModelContext {
    /// Every file in a folder, live or in Recently Deleted.
    func folderFiles() -> [Attachment] {
        (try? fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.folderID != nil && $0.deletedAt == nil }))) ?? []
    }

    /// The live files in one folder.
    func files(in folderID: UUID) -> [Attachment] {
        let id: UUID? = folderID
        return ((try? fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.folderID == id && $0.deletedAt == nil }))) ?? [])
            .filter { $0.trashedAt == nil }
    }

    /// Copies files into a folder, on their own (not in a note).
    @discardableResult
    func addFiles(_ urls: [URL], to folder: Folder) -> [Attachment] {
        let made = urls.compactMap { try? FileStore.importFile(at: $0) }
        for a in made {
            a.folderID = folder.id
            a.modifiedAt = .now
            insert(a)
        }
        try? save()
        SyncSignal.changed()
        return made
    }

    /// The folder that "Add File" and drops use for a list scope: the folder, or the default one.
    func folderForFiles(_ scope: Scope) -> Folder {
        if case .folder(let id) = scope, let f = folder(id), f.deletedAt == nil { return f }
        return defaultFolder()
    }

    func trash(_ file: Attachment) {
        file.trashedAt = .now
        file.touch()
        try? save()
    }

    /// Back from Recently Deleted, into its folder, or the default one if that's gone.
    func restore(_ file: Attachment) {
        file.trashedAt = nil
        let home = file.folderID.flatMap { folder($0) }
        if home == nil || home?.deletedAt != nil { file.folderID = defaultFolder().id }
        file.touch()
        try? save()
    }

    /// Gone for good: sync removes the stored copy and the bytes on every device.
    func purge(_ file: Attachment) {
        file.deletedAt = .now
        file.touch()
        FileStore.remove(file)
        try? save()
    }

    /// Like notes: live files go to Recently Deleted, files already there are deleted for good.
    func remove(files: [Attachment]) {
        for f in files where f.deletedAt == nil {
            if f.trashedAt == nil { trash(f) } else { purge(f) }
        }
    }

    func move(_ file: Attachment, to folder: Folder) {
        guard file.folderID != folder.id || file.trashedAt != nil else { return }
        file.folderID = folder.id
        file.trashedAt = nil
        file.touch()
        try? save()
    }

    /// A new name, keeping the file's ending (it says what kind of file it is).
    func rename(_ file: Attachment, to typed: String) {
        let name = FolderFileName.keepingExtension(typed, of: file.filename)
        guard !name.isEmpty, name != file.filename else { return }
        FileStore.rename(file.id, from: file.filename, to: name)
        file.filename = name
        file.touch()
        try? save()
    }

    /// Recently Deleted keeps files for 30 days, like notes.
    func purgeExpiredTrashedFiles() {
        let cutoff = Date.now.addingTimeInterval(-30 * 24 * 3600)
        for f in folderFiles() where (f.trashedAt ?? .distantFuture) < cutoff { purge(f) }
    }
}

enum FolderFileName {
    /// What a rename keeps: the typed name, trimmed, with the old ending put back if it was left off.
    static func keepingExtension(_ typed: String, of old: String) -> String {
        let name = String(typed.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "/", with: "-").prefix(255))
        let ext = (old as NSString).pathExtension
        guard !name.isEmpty, !ext.isEmpty, (name as NSString).pathExtension.lowercased() != ext.lowercased() else { return name }
        return "\(name).\(ext)"
    }

    /// The name without its ending, for the rename field.
    static func stem(_ name: String) -> String { (name as NSString).deletingPathExtension }
}
