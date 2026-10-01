import Foundation
import SwiftData
import UniformTypeIdentifiers
import ZIPFoundation

/// One note from a Google Takeout Keep folder: a .json file per note, its attachments beside it.
struct KeepNote: Decodable, Equatable {
    struct Item: Decodable, Equatable { var text: String?; var isChecked: Bool? }
    struct Label: Decodable, Equatable { var name: String }
    struct File: Decodable, Equatable { var filePath: String; var mimetype: String? }
    struct Link: Decodable, Equatable { var url: String?; var title: String? }

    var title: String?
    var textContent: String?
    var listContent: [Item]?
    var labels: [Label]?
    var attachments: [File]?
    var annotations: [Link]?
    var color: String?
    var isPinned: Bool?
    var isArchived: Bool?
    var isTrashed: Bool?
    var createdTimestampUsec: Int64?
    var userEditedTimestampUsec: Int64?
    /// What Keep has that Takeout writes but Amber Notes doesn't keep.
    var reminders: Bool = false
    var drawings: Bool = false

    enum CodingKeys: String, CodingKey {
        case title, textContent, listContent, labels, attachments, annotations, color, isPinned, isArchived, isTrashed
        case createdTimestampUsec, userEditedTimestampUsec
    }

    static func read(_ data: Data) -> KeepNote? {
        guard var note = try? JSONDecoder().decode(KeepNote.self, from: data),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        // A note has text, a list, a title or a timestamp; other JSON (Takeout's own) isn't one.
        guard note.textContent != nil || note.listContent != nil || note.title != nil || note.createdTimestampUsec != nil else { return nil }
        note.reminders = raw.keys.contains { $0.lowercased().contains("reminder") }
        note.drawings = raw.keys.contains { $0.lowercased().contains("drawing") }
            || (note.attachments ?? []).contains { ($0.mimetype ?? "").contains("drawing") || $0.filePath.lowercased().hasSuffix(".drawing") }
        return note
    }

    var created: Date? { createdTimestampUsec.map { Date(timeIntervalSince1970: Double($0) / 1_000_000) } }
    var edited: Date? { userEditedTimestampUsec.map { Date(timeIntervalSince1970: Double($0) / 1_000_000) } }
    var hasColor: Bool { (color ?? "DEFAULT").uppercased() != "DEFAULT" }
}

/// Notes from Google Keep, as Google Takeout exports them. Text and checklists come over, labels
/// become folders or #tags, pins stay, archived notes come only when asked (into Archive), notes
/// in the trash don't. Images come in as attachments. Colors, drawings and reminders don't exist
/// here, and the summary says how many notes had them.
@MainActor
final class KeepImporter {
    private let writer: ImportWriter
    private let options: ImportOptions

    init(context: ModelContext, options: ImportOptions = ImportOptions()) {
        writer = ImportWriter(context: context)
        self.options = options
    }

    /// The Keep folder inside what was picked: Takeout's top folder, its Keep folder, or a .zip of either.
    nonisolated static func keepFolder(in root: URL) -> URL {
        for candidate in [root.appending(path: "Keep"), root.appending(path: "Takeout/Keep")]
        where (try? candidate.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true { return candidate }
        return root
    }

    nonisolated static func isNoteJSON(_ path: String) -> Bool {
        let parts = path.split(separator: "/")
        guard let last = parts.last, last.lowercased().hasSuffix(".json"), !last.hasPrefix(".") else { return false }
        return parts.count == 1 || parts.dropLast().last?.lowercased() == "keep"
    }

    nonisolated static func inspect(_ url: URL) -> ImportSource {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        var notes = 0
        var bytes: Int64 = 0
        if url.pathExtension.lowercased() == "zip" {
            bytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            guard let archive = try? Archive(url: url, accessMode: .read, pathEncoding: nil) else {
                return ImportSource(url: url, name: "Google Keep", notes: 0, bytes: bytes, problem: "This .zip couldn't be opened.")
            }
            notes = archive.filter { $0.type == .file && $0.path.lowercased().contains("keep/") && isNoteJSON($0.path) }.count
        } else {
            let folder = keepFolder(in: url)
            let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey])) ?? []
            notes = files.filter { isNoteJSON($0.lastPathComponent) }.count
            bytes = files.reduce(0) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        }
        return ImportSource(url: url, name: "Google Keep", notes: notes, bytes: bytes,
                            problem: notes == 0 ? "No Keep notes in here. Choose the Takeout folder, its Keep folder, or the Takeout .zip." : nil)
    }

    func run(_ sources: [ImportSource], into destination: ImportDestination,
             progress: (Int, Int) -> Void = { _, _ in }, shouldStop: () -> Bool = { false }) async -> ImportSummary {
        let total = sources.reduce(0) { $0 + $1.notes }
        var done = 0
        var colors = 0, drawings = 0, reminders = 0
        progress(0, total)
        let scratch = FileManager.default.temporaryDirectory.appending(path: "KeepImport-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: scratch) }
        outer: for source in sources where source.problem == nil {
            let access = source.url.startAccessingSecurityScopedResource()
            defer { if access { source.url.stopAccessingSecurityScopedResource() } }
            var root = source.url
            if source.url.pathExtension.lowercased() == "zip" {
                let dest = scratch.appending(path: UUID().uuidString, directoryHint: .isDirectory)
                let url = source.url
                do { try await Task.detached { try FileManager.default.unzipItem(at: url, to: dest) }.value } catch {
                    writer.summary.failedFiles.append("\(source.name): the .zip couldn't be opened.")
                    continue
                }
                root = dest
            }
            let folder = Self.keepFolder(in: root)
            let files = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            let byName = Dictionary(files.map { ($0.lastPathComponent.lowercased(), $0) }, uniquingKeysWith: { a, _ in a })
            var used = Set<String>()
            for url in files where Self.isNoteJSON(url.lastPathComponent) {
                if shouldStop() { writer.summary.stopped = true; break outer }
                defer {
                    done += 1
                    progress(min(done, total), total)
                }
                if done % 25 == 0 { await Task.yield() }
                guard let data = try? Data(contentsOf: url), let note = KeepNote.read(data) else {
                    writer.summary.notNotes += 1
                    continue
                }
                if note.isTrashed == true { writer.summary.trashed += 1; continue }
                if note.isArchived == true, !options.includeArchived { writer.summary.archived += 1; continue }
                if add(note, files: byName, used: &used, source: source, destination: destination) {
                    if note.hasColor { colors += 1 }
                    if note.drawings { drawings += 1 }
                    if note.reminders { reminders += 1 }
                }
            }
            // Takeout writes an .html copy of each note and a Labels.txt; neither is left out on purpose.
            let quiet: Set<String> = ["html", "txt", "json"]
            writer.summary.notNotes += files.filter { !used.contains($0.lastPathComponent.lowercased()) && !quiet.contains($0.pathExtension.lowercased()) }.count
        }
        if colors > 0 { writer.summary.dropped.append("\(colors) \(colors == 1 ? "note had a color" : "notes had colors"), which Amber Notes doesn't have.") }
        if drawings > 0 { writer.summary.dropped.append("\(drawings) \(drawings == 1 ? "note had a drawing" : "notes had drawings"), which couldn't come over.") }
        if reminders > 0 { writer.summary.dropped.append("\(reminders) \(reminders == 1 ? "note had a reminder" : "notes had reminders"), which Amber Notes doesn't keep.") }
        return writer.finish()
    }

    /// The markdown for a note's text and checklist.
    static func body(_ note: KeepNote) -> String {
        var parts: [String] = []
        if let text = note.textContent?.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            parts.append(text)
        }
        if let items = note.listContent, !items.isEmpty {
            // Keep keeps ticked items under the rest, as Amber Notes does.
            let open = items.filter { $0.isChecked != true }, ticked = items.filter { $0.isChecked == true }
            parts.append((open + ticked).compactMap { item -> String? in
                let t = (item.text ?? "").replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                return t.isEmpty ? nil : "- [\(item.isChecked == true ? "x" : " ")] \(t)"
            }.joined(separator: "\n"))
        }
        let links = (note.annotations ?? []).compactMap { a -> String? in
            guard let url = a.url, !url.isEmpty else { return nil }
            let title = (a.title ?? "").trimmingCharacters(in: .whitespaces)
            return title.isEmpty || title == url ? url : "[\(RichTextToMarkdown.escape(title))](\(url))"
        }.filter { link in !parts.contains { $0.contains(link) } }
        if !links.isEmpty { parts.append(links.joined(separator: "\n")) }
        return parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    private func add(_ note: KeepNote, files byName: [String: URL], used: inout Set<String>, source: ImportSource, destination: ImportDestination) -> Bool {
        var body = Self.body(note)
        // Untitled Keep notes are named by their first line, as Keep shows them.
        var title = (note.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty, let first = body.split(separator: "\n", maxSplits: 1).first {
            title = String(first).replacingOccurrences(of: #"^- \[[ x]\] "#, with: "", options: .regularExpression)
            if !first.hasPrefix("- [") { body = String(body.dropFirst(first.count)).trimmingCharacters(in: .newlines) }
        }
        let attachments = note.attachments ?? []
        if title.isEmpty && body.isEmpty && attachments.isEmpty {
            writer.summary.empty += 1
            return false
        }
        let titleLine = ImportWriter.titleLine(title)
        let created = note.created ?? note.edited ?? .now
        if writer.alreadyImported(titleLine: titleLine, created: created) { return false }

        var made: [Attachment] = []
        for file in attachments {
            guard let url = Self.file(file.filePath, in: byName) else { writer.summary.filesMissing += 1; continue }
            guard let a = writer.attachment(from: url, filename: url.lastPathComponent, type: file.mimetype.flatMap { UTType(mimeType: $0) }, move: false) else { continue }
            used.insert(url.lastPathComponent.lowercased())
            made.append(a)
        }
        let labels = (note.labels ?? []).map(\.name).filter { !$0.isEmpty }
        var path: [String] = []
        var tags = labels
        if options.labelsAsFolders, let first = labels.first { path = [first]; tags = Array(labels.dropFirst()) }
        if note.isArchived == true { path = ["Archive"] + path }

        var markdown = titleLine
        let rest = ImportWriter.dropRepeatedTitle(body, title: titleLine)
        if !rest.isEmpty { markdown += "\n" + rest }
        if !made.isEmpty { markdown += "\n\n" + made.map(\.markdown).joined(separator: "\n") }
        if let line = ImportWriter.tagLine(tags) { markdown += "\n\n" + line }
        let folder = writer.folder(source: source.name, path: path, destination)
        guard writer.add(markdown: markdown, created: created, updated: note.edited, in: folder, files: made, pinned: note.isPinned == true) else { return false }
        writer.summary.attachments += made.count
        return true
    }

    /// An attachment's file. Takeout sometimes names it .jpeg in the JSON and .jpg on disk (or the
    /// other way), so the same name with another extension will do.
    static func file(_ path: String, in byName: [String: URL]) -> URL? {
        let name = (path as NSString).lastPathComponent.lowercased()
        if let f = byName[name] { return f }
        let stem = (name as NSString).deletingPathExtension
        return byName.first { ($0.key as NSString).deletingPathExtension == stem && !$0.key.hasSuffix(".json") && !$0.key.hasSuffix(".html") }?.value
    }
}
