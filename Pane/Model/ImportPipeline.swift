import Foundation
import SwiftData
import UniformTypeIdentifiers

/// One thing picked for an import: an Evernote notebook, a folder or .zip of Markdown, a Google
/// Keep Takeout folder. It becomes a folder of the same name unless the notes go into one you pick.
struct ImportSource: Identifiable, Hashable, Sendable {
    var url: URL
    var id: URL { url }
    var name: String
    var notes: Int
    var bytes: Int64
    /// Why it can't be imported, if it can't.
    var problem: String?
}

/// Where imported notes go.
enum ImportDestination: Hashable, Sendable {
    /// A folder per source, named after it (an existing top-level one of that name is used).
    case perSource
    case folder(UUID)
}

/// What an import did, for the summary.
struct ImportSummary: Equatable, Sendable {
    var notes = 0
    var attachments = 0
    /// Already in Amber Notes from an earlier import.
    var alreadyImported = 0
    /// No title, no text, no files.
    var empty = 0
    /// Longer than a note can be (the server takes 2 MB, sealed).
    var tooLong = 0
    /// In the trash where they came from.
    var trashed = 0
    /// Attachments over the 50 MB a file can be.
    var filesTooBig = 0
    /// Attachments a note names but the export doesn't hold.
    var filesMissing = 0
    /// Files in the export that aren't notes and no note uses (CSV, JSON, settings…).
    var notNotes = 0
    /// Encrypted sections, each marked in its note.
    var encrypted = 0
    /// What the other app had that Amber Notes doesn't keep ("12 notes had a colour"), one line each.
    var dropped: [String] = []
    /// Files or folders that couldn't be read, with why.
    var failedFiles: [String] = []
    /// Stopped before the end.
    var stopped = false
    var noteIDs: [UUID] = []

    var skipped: Int { alreadyImported + empty + tooLong + trashed }
}

/// Makes notes, folders and files for an import, the same way for every source: as ordinary local
/// changes, so sync seals and uploads them like anything typed. Nothing goes to the server any
/// other way. It also keeps the rules every import shares: a note already brought in is skipped,
/// and notes and files over the server's limits are left out and counted.
@MainActor
final class ImportWriter {
    /// The server keeps at most 2 MB of sealed text per note; sealing and base64 add about a third.
    static let maxNoteBytes = 1_500_000
    /// The files bucket takes 50 MB per object, sealed (a few bytes more than the file).
    static let maxFileBytes = 50 * 1024 * 1024 - 1024

    let context: ModelContext
    var summary = ImportSummary()
    /// Live notes by title and creation second, counted: an import already brought these.
    private var existing: [String: Int] = [:]
    private var folders: [String: Folder] = [:]

    init(context: ModelContext) {
        self.context = context
        let live = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.deletedAt == nil && $0.trashedAt == nil }
        for n in live { existing[Self.key(title: n.title, created: n.createdAt), default: 0] += 1 }
    }

    /// The same note again: the title it would have and its creation time, to the second. Synced
    /// notes keep both, so this holds on every device; a note edited since still counts as the same.
    static func key(title: String, created: Date) -> String {
        "\(title)\u{1F}\(Int(created.timeIntervalSinceReferenceDate.rounded()))"
    }

    /// True (and counted) when this note was imported before. Two alike in one export both come in.
    func alreadyImported(titleLine: String, created: Date) -> Bool {
        let key = Self.key(title: NoteText.title(of: titleLine), created: created)
        guard let n = existing[key], n > 0 else { return false }
        existing[key] = n - 1
        summary.alreadyImported += 1
        return true
    }

    /// A file's bytes as an attachment (moved when `move`, else copied). Not inserted until a note
    /// uses it. nil, and counted, when it's too big or can't be read.
    func attachment(from file: URL, filename: String?, type: UTType?, move: Bool) -> Attachment? {
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= Self.maxFileBytes else { summary.filesTooBig += 1; return nil }
        let t = type ?? UTType(filenameExtension: file.pathExtension) ?? filename.flatMap { UTType(filenameExtension: ($0 as NSString).pathExtension) } ?? .data
        var name = (filename ?? "").replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
        if name.isEmpty {
            let base = t.conforms(to: .image) ? "Image" : t.conforms(to: .pdf) ? "Document" : "Attachment"
            name = t.preferredFilenameExtension.map { "\(base).\($0)" } ?? base
        } else if (name as NSString).pathExtension.isEmpty, let ext = t.preferredFilenameExtension {
            name += ".\(ext)"
        }
        let a = Attachment(filename: name, contentType: t.identifier, size: Int64(size))
        let dest = FileStore.url(for: a.id, filename: name)
        do {
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            if move { try FileManager.default.moveItem(at: file, to: dest) } else { try FileManager.default.copyItem(at: file, to: dest) }
        } catch {
            summary.filesMissing += 1
            return nil
        }
        return a
    }

    /// Forgets files made for a note that won't be added.
    func discard(_ files: [Attachment]) {
        for a in files { try? FileManager.default.removeItem(at: FileStore.url(for: a.id, filename: a.filename).deletingLastPathComponent()) }
    }

    /// Adds a note: its first line is the title. False (and counted) when it's too long; its
    /// files are then dropped too.
    @discardableResult
    func add(markdown: String, created: Date, updated: Date?, in folder: Folder, files: [Attachment], pinned: Bool = false) -> Bool {
        guard markdown.utf8.count <= Self.maxNoteBytes else {
            discard(files)
            summary.tooLong += 1
            return false
        }
        for a in files where a.modelContext == nil { context.insert(a) }
        let note = Note(body: markdown + "\n", folder: folder)
        note.createdAt = created
        note.updatedAt = max(updated ?? created, created)
        note.isPinned = pinned
        context.insert(note)
        summary.notes += 1
        summary.noteIDs.append(note.id)
        if summary.notes % 50 == 0 { try? context.save() }
        return true
    }

    /// The folder for `path` (folder names from the top), under the source's own folder or the
    /// one picked. Made the first time a note needs it, so empty folders never appear.
    func folder(source: String, path: [String] = [], _ destination: ImportDestination) -> Folder {
        var parent: Folder
        if case .folder(let id) = destination, let f = context.folder(id), f.deletedAt == nil {
            parent = f
        } else {
            let name = source.isEmpty ? "Imported" : source
            if let f = folders[name] { parent = f } else {
                let f = context.allFolders().first { $0.name == name && $0.parent == nil } ?? context.createFolder(named: name)
                folders[name] = f
                parent = f
            }
        }
        var key = "\(parent.id)"
        for name in path where !name.isEmpty {
            key += "/" + name
            if let f = folders[key] { parent = f; continue }
            let under = parent
            let f = under.liveChildren.first { $0.name == name } ?? context.createFolder(named: name, parent: under)
            folders[key] = f
            parent = f
        }
        return parent
    }

    /// Writes everything out and tells the app notes arrived.
    func finish() -> ImportSummary {
        try? context.save()
        if !summary.noteIDs.isEmpty {
            SyncSignal.changed()
            NotificationCenter.default.post(name: .paneNotesBrought, object: nil)
        }
        return summary
    }

    /// The title as a note's first line: escaped, so a title with `*` or `_` reads as written,
    /// and one that starts like a heading, list or quote stays the title.
    static func titleLine(_ title: String) -> String {
        var t = RichTextToMarkdown.escape(title.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces))
        if let c = t.first, "#>-+*".contains(c) || t.range(of: #"^\d+[.)] "#, options: .regularExpression) != nil { t = "\\" + t }
        return t.isEmpty ? "Untitled" : t
    }

    /// Tags as one last line of hashtags; a space inside a tag becomes a hyphen.
    static func tagLine(_ tags: [String]) -> String? {
        let cleaned = tags.map { tag in
            tag.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: "#", with: "")
                .components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: "-")
        }.filter { !$0.isEmpty }
        var seen = Set<String>()
        let unique = cleaned.filter { seen.insert($0.lowercased()).inserted }
        return unique.isEmpty ? nil : unique.map { "#" + $0 }.joined(separator: " ")
    }

    /// The body without a first line that only repeats the title.
    static func dropRepeatedTitle(_ body: String, title: String) -> String {
        guard let first = body.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first,
              NoteText.stripMarkup(String(first)) == NoteText.title(of: title) else { return body }
        return String(body.dropFirst(first.count)).trimmingCharacters(in: .newlines)
    }
}
