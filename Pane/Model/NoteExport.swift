import Foundation
import SwiftData
import ZIPFoundation

/// Export your notes: everything in the library as markdown files in your folders, with the files
/// they hold, in one zip.
///
/// It's made on the device, from the local library: the notes are end-to-end encrypted, so the
/// server can't read them to export them for you. Links between notes and to files point at the
/// exported copies, so the folder reads well in any markdown editor.
@MainActor
enum NoteExport {
    struct Result: Equatable {
        var zip: URL
        var notes: Int
        var files: Int
        /// Locked notes left out because they're locked right now.
        var skippedLocked: Int
        /// Files whose bytes aren't on this device and couldn't be fetched.
        var missingFiles: Int
    }

    /// Writes the export as a zip in a temporary folder. `fetch` brings a file's bytes to this
    /// device when they're only in the cloud (sync's download).
    static func make(_ context: ModelContext, vault: NoteVault? = nil, now: Date = .now,
                     fetch: @MainActor (Attachment) async -> Bool = { _ in false }) async throws -> Result {
        let vault = vault ?? NoteVault.shared
        let stamp = now.formatted(.iso8601.year().month().day())
        let work = FileManager.default.temporaryDirectory.appending(path: "Amber Notes export \(UUID().uuidString)", directoryHint: .isDirectory)
        let top = work.appending(path: "Amber Notes \(stamp)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: top, withIntermediateDirectories: true)

        let notes = ((try? context.fetch(FetchDescriptor<Note>())) ?? [])
            .filter { $0.trashedAt == nil && $0.deletedAt == nil }
            .sorted { $0.createdAt < $1.createdAt }
        var result = Result(zip: work.appending(path: "Amber Notes \(stamp).zip"), notes: 0, files: 0, skippedLocked: 0, missingFiles: 0)

        // Where each note goes, relative to the top: its folders, then a unique file name.
        var used = Set<String>()
        var paths: [UUID: String] = [:]
        var texts: [UUID: String] = [:]
        for n in notes {
            guard let text = vault.text(of: n) else { result.skippedLocked += 1; continue }
            let dir = folderPath(n.folder)
            paths[n.id] = unique(dir + [safeName(NoteText.title(of: text)) + ".md"], in: &used)
            texts[n.id] = text
        }

        // Files the exported notes embed, under Files/.
        var filePaths: [UUID: String] = [:]
        for n in notes {
            guard let text = texts[n.id] else { continue }
            for m in text.matches(of: /pane-file:([0-9a-fA-F-]{36})/) {
                guard let id = UUID(uuidString: String(m.1)), filePaths[id] == nil,
                      let a = context.attachment(id), a.deletedAt == nil else { continue }
                if !FileStore.exists(a), !(await fetch(a)) { result.missingFiles += 1; continue }
                let path = unique(["Files", safeName(a.filename)], in: &used)
                let dest = top.appending(path: path)
                try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: FileStore.url(for: a.id, filename: a.filename), to: dest)
                filePaths[id] = path
                result.files += 1
            }
        }

        for n in notes {
            guard let text = texts[n.id], let path = paths[n.id] else { continue }
            let url = top.appending(path: path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let up = String(repeating: "../", count: path.split(separator: "/").count - 1)
            try Data(relink(text, notes: paths, files: filePaths, up: up).utf8).write(to: url)
            try? FileManager.default.setAttributes([.modificationDate: n.updatedAt, .creationDate: n.createdAt], ofItemAtPath: url.path)
            result.notes += 1
        }

        try FileManager.default.zipItem(at: top, to: result.zip, shouldKeepParent: true)
        try? FileManager.default.removeItem(at: top)
        return result
    }

    /// `pane-note:` and `pane-file:` links pointed at the exported copies, relative to the note.
    static func relink(_ text: String, notes: [UUID: String], files: [UUID: String], up: String) -> String {
        text.replacing(/pane-(note|file):([0-9a-fA-F-]{36})/) { m in
            guard let id = UUID(uuidString: String(m.2)), let path = (m.1 == "note" ? notes[id] : files[id]) else { return String(m.0) }
            return up + (path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path)
        }
    }

    /// The folder names from the top down to `folder`.
    static func folderPath(_ folder: Folder?) -> [String] {
        var names: [String] = []
        var f = folder
        while let x = f, names.count < 32 {
            if x.deletedAt == nil { names.insert(safeName(x.name), at: 0) }
            f = x.parent
        }
        return names
    }

    /// A name that's safe as one path part on any system, and not too long.
    static func safeName(_ name: String) -> String {
        var s = String(name.unicodeScalars.map { c -> Character in
            if "/\\:*?\"<>|".unicodeScalars.contains(c) || c.properties.generalCategory == .control || c.properties.generalCategory == .format { return "-" }
            return Character(c)
        }).trimmingCharacters(in: .whitespaces)
        while s.hasPrefix(".") { s.removeFirst() }
        if s.isEmpty { s = "Untitled" }
        return String(s.prefix(100))
    }

    /// The path, with " 2", " 3"… before the extension when it's taken (compared without case).
    static func unique(_ parts: [String], in used: inout Set<String>) -> String {
        let path = parts.joined(separator: "/")
        let ext = (path as NSString).pathExtension
        let stem = ext.isEmpty ? path : String(path.dropLast(ext.count + 1))
        var candidate = path, i = 2
        while used.contains(candidate.lowercased()) {
            candidate = stem + " \(i)" + (ext.isEmpty ? "" : "." + ext)
            i += 1
        }
        used.insert(candidate.lowercased())
        return candidate
    }
}
