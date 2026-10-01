import CryptoKit
import Foundation
import SwiftData
import UniformTypeIdentifiers

extension UTType {
    /// An Evernote export. Evernote doesn't declare one, so Amber Notes does (see project.yml).
    static let enex = UTType(importedAs: "com.evernote.enex", conformingTo: .xml)
}

/// One .enex file picked for import: a notebook, which becomes a folder of the same name.
struct ENEXSource: Identifiable, Hashable, Sendable {
    var url: URL
    var id: URL { url }
    /// The notebook's name: Evernote names each export after it.
    var name: String
    var notes: Int
    var bytes: Int64
    /// Why the file can't be imported, if it can't.
    var problem: String?

    /// Looks a file over: is it an export, and how many notes does it hold.
    static func inspect(_ url: URL) -> ENEXSource {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let name = url.deletingPathExtension().lastPathComponent
        let bytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        do {
            return ENEXSource(url: url, name: name, notes: try ENEXReader.countNotes(in: url), bytes: bytes)
        } catch {
            return ENEXSource(url: url, name: name, notes: 0, bytes: bytes, problem: error.localizedDescription)
        }
    }
}

/// What an import did, for the summary.
struct EvernoteImportSummary: Equatable, Sendable {
    var notes = 0
    var attachments = 0
    /// Already in Amber Notes from an earlier import.
    var alreadyImported = 0
    /// No title, no text, no files.
    var empty = 0
    /// Longer than a note can be (the server takes 2 MB, sealed).
    var tooLong = 0
    /// Attachments over the 50 MB a file can be.
    var filesTooBig = 0
    /// Attachments the body names but the export doesn't hold (or whose bytes didn't decode).
    var filesMissing = 0
    /// Encrypted sections, each marked in its note.
    var encrypted = 0
    /// Files that couldn't be read, with why.
    var failedFiles: [String] = []
    /// Stopped before the end.
    var stopped = false
    var noteIDs: [UUID] = []

    var skipped: Int { alreadyImported + empty + tooLong }
}

/// Where imported notes go.
enum EvernoteDestination: Hashable, Sendable {
    /// A folder per notebook, named after it (an existing one of that name is used).
    case perNotebook
    case folder(UUID)
}

/// Creates notes from Evernote exports. Reading happens off the main thread, a few notes ahead;
/// notes, folders and files are made here as ordinary local changes, so sync seals and uploads
/// them like anything typed. Nothing goes to the server any other way.
@MainActor
final class EvernoteImporter {
    /// The server keeps at most 2 MB of sealed text per note; sealing and base64 add about a third.
    static let maxNoteBytes = 1_500_000
    /// The files bucket takes 50 MB per object, sealed (a few bytes more than the file).
    static let maxFileBytes = 50 * 1024 * 1024 - 1024

    private let context: ModelContext
    private(set) var summary = EvernoteImportSummary()
    /// Live notes by title and creation second, counted: an import already brought these.
    private var existing: [String: Int] = [:]
    private var folders: [String: Folder] = [:]

    init(context: ModelContext) {
        self.context = context
        let live = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.deletedAt == nil && $0.trashedAt == nil }
        for n in live { existing[Self.key(title: n.title, created: n.createdAt), default: 0] += 1 }
    }

    /// The same note again: the title it would have and its Evernote creation time, to the second.
    /// Synced notes keep both, so this holds on every device; a note edited since in Evernote
    /// still counts as the same note.
    static func key(title: String, created: Date) -> String {
        "\(title)\u{1F}\(Int(created.timeIntervalSinceReferenceDate.rounded()))"
    }

    /// Imports the files in order. `progress(done, total)` is called as notes are made;
    /// `shouldStop` is asked between notes.
    func run(_ sources: [ENEXSource], into destination: EvernoteDestination,
             progress: (Int, Int) -> Void = { _, _ in }, shouldStop: () -> Bool = { false }) async -> EvernoteImportSummary {
        let total = sources.reduce(0) { $0 + $1.notes }
        var done = 0
        let scratch = FileManager.default.temporaryDirectory.appending(path: "EvernoteImport-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: scratch) }
        progress(0, total)
        outer: for source in sources where source.problem == nil {
            let access = source.url.startAccessingSecurityScopedResource()
            defer { if access { source.url.stopAccessingSecurityScopedResource() } }
            let feed = ENEXFeed(url: source.url, scratch: scratch)
            do {
                for try await note in feed.notes {
                    if shouldStop() {
                        feed.stop()
                        Self.discard(note)
                        summary.stopped = true
                        break outer
                    }
                    add(note, from: source, to: destination)
                    Self.discard(note)
                    feed.taken()
                    done += 1
                    progress(min(done, total), total)
                    if done % 50 == 0 {
                        try? context.save()
                        await Task.yield()
                    }
                }
            } catch {
                summary.failedFiles.append("\(source.name): \(error.localizedDescription)")
            }
        }
        try? context.save()
        if !summary.noteIDs.isEmpty {
            SyncSignal.changed()
            NotificationCenter.default.post(name: .paneNotesBrought, object: nil)
        }
        return summary
    }

    /// Scratch copies of a note's files, once they've been moved in or skipped.
    private static func discard(_ note: ENEXNote) {
        for r in note.resources { if let f = r.file { try? FileManager.default.removeItem(at: f.deletingLastPathComponent()) } }
    }

    private func add(_ en: ENEXNote, from source: ENEXSource, to destination: EvernoteDestination) {
        let bodyEmpty = ENMLToMarkdown.plainText(en.content).isEmpty
        let rawTitle = en.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if rawTitle.isEmpty && bodyEmpty && en.resources.allSatisfy({ $0.file == nil }) {
            summary.empty += 1
            return
        }
        let titleLine = Self.titleLine(rawTitle.isEmpty ? "Untitled" : rawTitle)
        let title = NoteText.title(of: titleLine)
        let created = en.created ?? en.updated ?? .now
        let key = Self.key(title: title, created: created)
        if let n = existing[key], n > 0 {
            existing[key] = n - 1
            summary.alreadyImported += 1
            return
        }

        // Files first, so the body can place them.
        var files: [String: Attachment] = [:]
        var order: [String] = []
        for r in en.resources {
            guard let file = r.file, !r.hash.isEmpty else { summary.filesMissing += 1; continue }
            guard r.size <= Self.maxFileBytes else { summary.filesTooBig += 1; continue }
            guard files[r.hash] == nil, let a = Self.attachment(r, file: file) else { continue }
            files[r.hash] = a
            order.append(r.hash)
        }
        let converted = ENMLToMarkdown.convert(en.content) { files[$0]?.markdown }
        var body = converted.markdown
        // Evernote notes often repeat their title as the first line.
        if let first = body.split(separator: "\n", maxSplits: 1).first, NoteText.stripMarkup(String(first)) == title {
            body = String(body.dropFirst(first.count)).trimmingCharacters(in: .newlines)
        }
        var markdown = titleLine
        if !body.isEmpty { markdown += "\n" + body }
        // Files the body never placed (Evernote keeps some only as attachments) go at the end.
        let unplaced = order.filter { !converted.placed.contains($0) }.compactMap { files[$0]?.markdown }
        if !unplaced.isEmpty { markdown += "\n\n" + unplaced.joined(separator: "\n") }
        if let tags = Self.tagLine(en.tags) { markdown += "\n\n" + tags }

        guard markdown.utf8.count <= Self.maxNoteBytes else {
            for a in files.values { try? FileManager.default.removeItem(at: FileStore.url(for: a.id, filename: a.filename).deletingLastPathComponent()) }
            summary.tooLong += 1
            return
        }
        for a in files.values { context.insert(a) }
        let note = Note(body: markdown + "\n", folder: folder(for: source, destination))
        note.createdAt = created
        note.updatedAt = en.updated ?? created
        context.insert(note)
        summary.notes += 1
        summary.attachments += files.count
        summary.encrypted += converted.encrypted
        summary.filesMissing += converted.missing
        summary.noteIDs.append(note.id)
    }

    /// The title as the note's first line: escaped, so a title with `*` or `_` reads as written.
    static func titleLine(_ title: String) -> String {
        var t = RichTextToMarkdown.escape(title.replacingOccurrences(of: "\n", with: " "))
        // A title that starts like a heading, list or quote would stop being the title.
        if let c = t.first, "#>-+*".contains(c) || t.range(of: #"^\d+[.)] "#, options: .regularExpression) != nil { t = "\\" + t }
        return t
    }

    /// Evernote's tags as one last line of hashtags; a space inside a tag becomes a hyphen.
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

    /// Moves a decoded file into Amber Notes' own files. Not inserted yet.
    static func attachment(_ r: ENEXResource, file: URL) -> Attachment? {
        let type = UTType(mimeType: r.mime) ?? r.filename.flatMap { UTType(filenameExtension: ($0 as NSString).pathExtension) } ?? .data
        var name = (r.filename ?? "").replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
        if name.isEmpty {
            let base = type.conforms(to: .image) ? "Image" : type.conforms(to: .pdf) ? "Document" : "Attachment"
            name = type.preferredFilenameExtension.map { "\(base).\($0)" } ?? base
        } else if (name as NSString).pathExtension.isEmpty, let ext = type.preferredFilenameExtension {
            name += ".\(ext)"
        }
        let a = Attachment(filename: name, contentType: type.identifier, size: Int64(r.size))
        let dest = FileStore.url(for: a.id, filename: name)
        do {
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: file, to: dest)
        } catch { return nil }
        return a
    }

    private func folder(for source: ENEXSource, _ destination: EvernoteDestination) -> Folder {
        if case .folder(let id) = destination, let f = context.folder(id), f.deletedAt == nil { return f }
        let name = source.name.isEmpty ? "Evernote" : source.name
        if let f = folders[name] { return f }
        let f = context.allFolders().first { $0.name == name && $0.parent == nil } ?? context.createFolder(named: name)
        folders[name] = f
        return f
    }
}

/// Notes read from one file on a thread of their own, at most a few ahead of the importer, so
/// memory stays flat however big the export.
final class ENEXFeed: @unchecked Sendable {
    let notes: AsyncThrowingStream<ENEXNote, Error>
    private let gate = DispatchSemaphore(value: 4)
    private let lock = NSLock()
    private var stopped = false

    init(url: URL, scratch: URL) {
        let (notes, continuation) = AsyncThrowingStream<ENEXNote, Error>.makeStream()
        self.notes = notes
        let thread = Thread { [self] in
            let reader = ENEXReader(url: url, scratch: scratch) { note in
                self.gate.wait()
                if self.isStopped {
                    for r in note.resources { if let f = r.file { try? FileManager.default.removeItem(at: f.deletingLastPathComponent()) } }
                    return false
                }
                continuation.yield(note)
                return true
            }
            do {
                try reader.read()
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        thread.name = "ENEX reader"
        thread.stackSize = 4 << 20
        continuation.onTermination = { [weak self] _ in self?.stop() }
        thread.start()
    }

    private var isStopped: Bool { lock.withLock { stopped } }

    /// The importer is done with a note: the reader may read one more.
    func taken() { gate.signal() }

    func stop() {
        lock.withLock { stopped = true }
        // Wakes the reader if it's waiting, so it can see it should stop.
        for _ in 0..<8 { gate.signal() }
    }
}
