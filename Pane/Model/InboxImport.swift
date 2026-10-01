import Foundation
import SwiftData

@MainActor
extension ModelContext {
    /// Files everything shared into Amber Notes as notes. Returns the new notes.
    /// Evernote exports aren't filed: they wait in `EvernoteInbox` for the import sheet.
    @discardableResult
    func drainInbox() -> [Note] {
        var made: [Note] = []
        var exports: [URL] = []
        for (item, dir) in Inbox.pending() {
            let enex = item.files.filter { EvernoteInbox.isExport($0) }
            exports += enex.compactMap { EvernoteInbox.keep(dir.appending(path: $0)) }
            let rest = item.files.filter { !EvernoteInbox.isExport($0) }
            var body = item.markdown.trimmingCharacters(in: .whitespacesAndNewlines)
            if !enex.isEmpty, rest.isEmpty, body.isEmpty { Inbox.remove(dir); continue }
            let files = rest.compactMap { try? FileStore.importFile(at: dir.appending(path: $0)) }
            files.forEach(insert)
            if body.isEmpty, let f = files.first { body = (f.filename as NSString).deletingPathExtension }
            if !files.isEmpty { body += "\n\n" + files.map(\.markdown).joined(separator: "\n") }
            let note = createNote(in: .all, body: body + "\n")
            note.createdAt = item.createdAt
            made.append(note)
            Inbox.remove(dir)
        }
        if !made.isEmpty {
            try? save()
            // Notes shared into the app count as bringing your notes (setup step 1).
            NotificationCenter.default.post(name: .paneNotesBrought, object: nil)
            FeatureUse.mark(.shareExtension)
        }
        if !exports.isEmpty { EvernoteInbox.offer(exports) }
        return made
    }
}

/// Evernote exports that arrived from outside (the share sheet, Open in, a drop on the Dock icon),
/// waiting for the import sheet to open with them.
@MainActor
enum EvernoteInbox {
    static private(set) var files: [URL] = []

    static func isExport(_ name: String) -> Bool { (name as NSString).pathExtension.lowercased() == "enex" }

    /// Where waiting exports are kept until the sheet is done with them.
    static var dir: URL { FileManager.default.temporaryDirectory.appending(path: "EvernoteInbox", directoryHint: .isDirectory) }

    /// Moves a file here, out of the share inbox or the system's Open in folder.
    static func keep(_ url: URL) -> URL? {
        let folder = dir.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let dest = folder.appending(path: url.lastPathComponent)
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            if (try? FileManager.default.moveItem(at: url, to: dest)) == nil { try FileManager.default.copyItem(at: url, to: dest) }
            return dest
        } catch { return nil }
    }

    /// Asks the window to open the import sheet with these.
    static func offer(_ urls: [URL]) {
        files += urls
        NotificationCenter.default.post(name: .paneEvernoteOffered, object: nil)
    }

    /// The sheet took them (or was closed): forget them and their copies.
    static func clear() {
        for f in files where f.path.hasPrefix(dir.path) { try? FileManager.default.removeItem(at: f.deletingLastPathComponent()) }
        files = []
    }
}

extension Notification.Name {
    /// Evernote exports arrived from outside; the window opens the import sheet with them.
    static let paneEvernoteOffered = Notification.Name("pane.evernoteOffered")
}
