import Foundation
import SwiftData
import UniformTypeIdentifiers
import ZIPFoundation

/// Markdown and text notes from a folder or a .zip: what Obsidian, Notion, Bear, Joplin, Logseq,
/// Simplenote and Standard Notes export. Subfolders become folders; the title is the front
/// matter's, else the first heading, else the file name; images and files linked from the notes
/// (relative links, Notion's URL-encoded paths, Obsidian's `![[embeds]]`) come in as attachments;
/// front-matter tags become a last line of #tags; dates come from front matter, else the file.
@MainActor
final class MarkdownImporter {
    private let writer: ImportWriter

    init(context: ModelContext) {
        writer = ImportWriter(context: context)
    }

    nonisolated static let noteExtensions: Set<String> = ["md", "markdown", "mdown", "mkd", "txt", "text"]
    /// App settings and history that sit next to the notes.
    nonisolated static let skippedFolders: Set<String> = [".obsidian", ".git", ".github", "logseq", "__macosx", "node_modules", ".bear", ".stfolder"]
    /// Folders of deleted notes (Obsidian, Simplenote, Joplin): never imported.
    nonisolated static let trashFolders: Set<String> = [".trash", "trash", "trashed", "deleted"]

    // MARK: Looking a source over

    /// Counts the notes in a folder or .zip without reading them.
    nonisolated static func inspect(_ url: URL) -> ImportSource {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let isZip = url.pathExtension.lowercased() == "zip"
        let name = cleanName(url.deletingPathExtension().lastPathComponent)
        var notes = 0
        var bytes: Int64 = 0
        if isZip {
            bytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            guard let archive = try? Archive(url: url, accessMode: .read, pathEncoding: nil) else {
                return ImportSource(url: url, name: name, notes: 0, bytes: bytes, problem: "This .zip couldn't be opened.")
            }
            for entry in archive where entry.type == .file {
                if case .note = kind(of: entry.path.split(separator: "/").map(String.init)) { notes += 1 }
            }
        } else {
            for (path, file) in walk(url) {
                if case .note = kind(of: path), !looksLikeJSON(file) { notes += 1 }
            }
            bytes = folderSize(url)
        }
        let problem = notes == 0 ? "No Markdown or text notes in here." : nil
        return ImportSource(url: url, name: name, notes: notes, bytes: bytes, problem: problem)
    }

    enum PathKind: Equatable { case note, file, skipped, trashed }

    /// What a file at `path` (components from the source's top) is to the import.
    nonisolated static func kind(of path: [String]) -> PathKind {
        guard let last = path.last, !last.hasPrefix(".") else { return .skipped }
        let dirs = path.dropLast().map { $0.lowercased() }
        if dirs.contains(where: { skippedFolders.contains($0) || $0.hasPrefix(".") && !trashFolders.contains($0) }) { return .skipped }
        if dirs.contains(where: trashFolders.contains) { return .trashed }
        let ext = (last as NSString).pathExtension.lowercased()
        // A TextBundle (Bear) is a folder: its text is the note, its assets are files.
        if let i = dirs.lastIndex(where: { $0.hasSuffix(".textbundle") }) {
            return i == dirs.count - 1 && (last.lowercased().hasPrefix("text.") && noteExtensions.contains(ext)) ? .note : .file
        }
        return noteExtensions.contains(ext) ? .note : .file
    }

    /// Every file under `root` with its path from there.
    nonisolated static func walk(_ root: URL) -> [([String], URL)] {
        let base = root.standardizedFileURL.pathComponents.count
        guard let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: []) else { return [] }
        var out: [([String], URL)] = []
        for case let url as URL in e {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            out.append((Array(url.standardizedFileURL.pathComponents.dropFirst(base)), url))
        }
        return out.sorted { $0.0.joined(separator: "/").localizedStandardCompare($1.0.joined(separator: "/")) == .orderedAscending }
    }

    nonisolated static func folderSize(_ url: URL) -> Int64 {
        walk(url).reduce(0) { $0 + Int64((try? $1.1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }

    /// Notion adds a 32-character id to every page and folder name ("Trip 3f2a…"); it's dropped.
    nonisolated static func cleanName(_ name: String) -> String {
        let s = name.replacingOccurrences(of: #"\s+[0-9a-f]{32}$"#, with: "", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    // MARK: Importing

    func run(_ sources: [ImportSource], into destination: ImportDestination,
             progress: (Int, Int) -> Void = { _, _ in }, shouldStop: () -> Bool = { false }) async -> ImportSummary {
        let total = sources.reduce(0) { $0 + $1.notes }
        var done = 0
        progress(0, total)
        let scratch = FileManager.default.temporaryDirectory.appending(path: "MarkdownImport-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: scratch) }
        outer: for source in sources where source.problem == nil {
            let access = source.url.startAccessingSecurityScopedResource()
            defer { if access { source.url.stopAccessingSecurityScopedResource() } }
            var root = source.url
            if source.url.pathExtension.lowercased() == "zip" {
                let dest = scratch.appending(path: UUID().uuidString, directoryHint: .isDirectory)
                let url = source.url
                do {
                    try await Task.detached { try FileManager.default.unzipItem(at: url, to: dest) }.value
                } catch {
                    writer.summary.failedFiles.append("\(source.name): the .zip couldn't be opened.")
                    continue
                }
                root = dest
            }
            let tree = Tree(root: root)
            for note in tree.notes {
                if shouldStop() { writer.summary.stopped = true; break outer }
                add(note, in: tree, source: source, destination: destination)
                done += 1
                progress(min(done, total), total)
                if done % 25 == 0 { await Task.yield() }
            }
            writer.summary.trashed += tree.trashed
            writer.summary.notNotes += tree.files.keys.filter { !tree.used.contains($0) }.count
        }
        return writer.finish()
    }

    /// The files of one source, read once: notes, other files by path and by name (for Obsidian's
    /// embeds, which name a file anywhere in the vault).
    final class Tree {
        let root: URL
        var notes: [(path: [String], url: URL)] = []
        /// Files that aren't notes, by their standardized path.
        var files: [String: URL] = [:]
        var byName: [String: [URL]] = [:]
        var notesByName: [String: String] = [:]
        var used: Set<String> = []
        var trashed = 0
        /// Folders every note shares (an export's own top folder, Simplenote's `notes/`): not repeated as folders here.
        let commonPrefix: Int

        init(root: URL) {
            self.root = root.standardizedFileURL
            for (path, url) in MarkdownImporter.walk(root) {
                switch MarkdownImporter.kind(of: path) {
                case .note where MarkdownImporter.looksLikeJSON(url):
                    // Standard Notes' and others' backups end in .txt but are JSON.
                    files[url.standardizedFileURL.path] = url
                case .note:
                    notes.append((path, url))
                    let stem = (path.last! as NSString).deletingPathExtension
                    let title = path.dropLast().last.map { $0.lowercased().hasSuffix(".textbundle") } == true
                        ? (path[path.count - 2] as NSString).deletingPathExtension : stem
                    notesByName[title.lowercased()] = MarkdownImporter.cleanName(title)
                case .file:
                    files[url.standardizedFileURL.path] = url
                    // A TextBundle's own files (info.json) are part of its note, not left-overs.
                    if path.dropLast().contains(where: { $0.lowercased().hasSuffix(".textbundle") }) { used.insert(url.standardizedFileURL.path) }
                    byName[url.lastPathComponent.lowercased(), default: []].append(url)
                case .trashed: trashed += 1
                case .skipped: break
                }
            }
            var prefix = notes.first.map { Array($0.path.dropLast()) } ?? []
            for n in notes.dropFirst() {
                let dirs = Array(n.path.dropLast())
                var i = 0
                while i < prefix.count, i < dirs.count, prefix[i] == dirs[i] { i += 1 }
                prefix = Array(prefix.prefix(i))
            }
            commonPrefix = prefix.count
        }

        /// A file a note points at, if it's inside this source.
        func file(_ raw: String, from note: URL) -> URL? {
            var s = raw.trimmingCharacters(in: .whitespaces)
            if s.hasPrefix("<"), s.hasSuffix(">") { s = String(s.dropFirst().dropLast()) }
            if let q = s.firstIndex(where: { $0 == "?" || $0 == "#" }) { s = String(s[..<q]) }
            let decoded = s.removingPercentEncoding ?? s
            for candidate in [decoded, s] where !candidate.isEmpty {
                let url = URL(fileURLWithPath: candidate, relativeTo: note.deletingLastPathComponent()).standardizedFileURL
                if url.path.hasPrefix(root.path), let f = files[url.path] { return f }
                // Joplin and some others link from the export's top.
                let fromRoot = root.appending(path: candidate).standardizedFileURL
                if let f = files[fromRoot.path] { return f }
            }
            return byName[(decoded as NSString).lastPathComponent.lowercased()]?.first
        }

        /// The title of a note a link points at, by file name.
        func noteTitle(_ raw: String) -> String? {
            let s = (raw.removingPercentEncoding ?? raw)
            let stem = ((s as NSString).lastPathComponent as NSString).deletingPathExtension
            guard MarkdownImporter.noteExtensions.contains((s as NSString).pathExtension.lowercased()) || (s as NSString).pathExtension.isEmpty else { return nil }
            return notesByName[stem.lowercased()]
        }
    }

    private func add(_ note: (path: [String], url: URL), in tree: Tree, source: ImportSource, destination: ImportDestination) {
        let isBundle = note.path.count >= 2 && note.path[note.path.count - 2].lowercased().hasSuffix(".textbundle")
        let fileStem = isBundle ? (note.path[note.path.count - 2] as NSString).deletingPathExtension : (note.path.last! as NSString).deletingPathExtension
        guard let data = try? Data(contentsOf: note.url) else {
            writer.summary.failedFiles.append("\(note.path.joined(separator: "/")): couldn't be read.")
            return
        }
        let text = Self.decode(data)
        // Standard Notes and Simplenote keep a JSON backup next to the notes; it isn't one.
        if Self.isJSON(text) { writer.summary.notNotes += 1; return }
        let isText = ["txt", "text"].contains(note.url.pathExtension.lowercased())
        var parsed = MarkdownNote.parse(text, fileName: Self.cleanName(fileStem), notion: fileStem != Self.cleanName(fileStem), plainText: isText)

        // Links and embeds: files inside the export become attachments, other notes their titles.
        var files: [Attachment] = []
        parsed.body = MarkdownNote.rewriteLinks(parsed.body, file: { raw in
            guard let url = tree.file(raw, from: note.url) else { return nil }
            guard let a = self.writer.attachment(from: url, filename: url.lastPathComponent, type: nil, move: false) else { return nil }
            tree.used.insert(url.standardizedFileURL.path)
            files.append(a)
            return a.markdown
        }, noteTitle: tree.noteTitle, missing: { self.writer.summary.filesMissing += 1 })

        let body = parsed.body.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty && parsed.title == nil && files.isEmpty {
            writer.summary.empty += 1
            return
        }
        let titleLine = ImportWriter.titleLine(parsed.title ?? Self.cleanName(fileStem))
        let values = try? note.url.resourceValues(forKeys: [.creationDateKey, .contentModificationDateKey])
        let fileCreated = [values?.creationDate, values?.contentModificationDate].compactMap { $0 }.min()
        let created = parsed.created ?? fileCreated ?? .now
        let updated = parsed.updated ?? values?.contentModificationDate
        if writer.alreadyImported(titleLine: titleLine, created: created) { writer.discard(files); return }

        var markdown = titleLine
        let rest = ImportWriter.dropRepeatedTitle(body, title: titleLine)
        if !rest.isEmpty { markdown += "\n" + rest }
        if let tags = ImportWriter.tagLine(parsed.tags) { markdown += "\n\n" + tags }
        let dirs = Array(note.path.dropLast(isBundle ? 2 : 1).dropFirst(tree.commonPrefix)).map(Self.cleanName)
        let folder = writer.folder(source: source.name, path: dirs, destination)
        if writer.add(markdown: markdown, created: created, updated: updated, in: folder, files: files) {
            writer.summary.attachments += files.count
        }
    }

    nonisolated static func decode(_ data: Data) -> String {
        var s = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1252) ?? String(decoding: data, as: UTF8.self)
        if s.hasPrefix("\u{FEFF}") { s.removeFirst() }
        return s.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    }

    /// A .txt that's really JSON, judged from its first bytes, then parsed to be sure.
    nonisolated static func looksLikeJSON(_ url: URL) -> Bool {
        guard ["txt", "text"].contains(url.pathExtension.lowercased()),
              let h = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? h.close() }
        let head = String(decoding: (try? h.read(upToCount: 64)) ?? Data(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard head.hasPrefix("{") || head.hasPrefix("[") else { return false }
        return (try? Data(contentsOf: url)).map { isJSON(decode($0)) } ?? false
    }

    nonisolated static func isJSON(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.hasPrefix("{") || t.hasPrefix("[") else { return false }
        return (try? JSONSerialization.jsonObject(with: Data(t.utf8))) != nil
    }
}

/// One Markdown file taken apart: front matter (or Logseq's `key:: value` lines, or Notion's
/// property lines), title, dates, tags and body, with the other apps' syntax made plain Markdown.
struct MarkdownNote: Equatable {
    var title: String?
    var created: Date?
    var updated: Date?
    var tags: [String] = []
    var body: String

    static func parse(_ text: String, fileName: String, notion: Bool = false, plainText: Bool = false) -> MarkdownNote {
        var lines = text.components(separatedBy: "\n")
        var props: [String: [String]] = [:]

        // YAML front matter (Obsidian, Joplin, Bear, Hugo-style exports).
        if lines.first?.trimmingCharacters(in: .whitespaces) == "---",
           let end = lines.dropFirst().firstIndex(where: { ["---", "..."].contains($0.trimmingCharacters(in: .whitespaces)) }) {
            props = frontMatter(Array(lines[1..<end]))
            lines.removeSubrange(0...end)
        }
        // Logseq page properties: `title:: …`, `tags:: a, b` at the top.
        while let first = lines.first, let (k, v) = logseqProperty(first) {
            props[k, default: []] += list(v)
            lines.removeFirst()
        }
        while lines.first?.trimmingCharacters(in: .whitespaces).isEmpty == true { lines.removeFirst() }

        var note = MarkdownNote(body: "")
        note.title = props["title"]?.first.flatMap { $0.isEmpty ? nil : $0 }
        // The first heading is the title when the note starts with it.
        if !plainText, let first = lines.first, let r = first.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
            let heading = String(first[r.upperBound...]).trimmingCharacters(in: .whitespaces)
            if note.title == nil || note.title == heading { note.title = heading; lines.removeFirst() }
        }
        // Notion lists a page's properties under its title: "Created: …", "Tags: a, b". Dates and
        // tags are taken from there; other properties ("Author: …") stay in the note.
        if notion {
            while lines.first?.trimmingCharacters(in: .whitespaces).isEmpty == true { lines.removeFirst() }
            var i = 0
            var kept: [String] = []
            while i < lines.count, let colon = lines[i].range(of: ": "), lines[i].distance(from: lines[i].startIndex, to: colon.lowerBound) < 40,
                  !lines[i].hasPrefix("#"), !lines[i].hasPrefix("-"), !lines[i].hasPrefix("*") {
                let key = lines[i][..<colon.lowerBound].lowercased()
                let value = String(lines[i][colon.upperBound...])
                if notionKeys.contains(key) { props[key, default: []] += key.contains("tag") ? list(value) : [value] } else { kept.append(lines[i]) }
                i += 1
            }
            if i > 0 {
                lines.removeFirst(i)
                if kept.isEmpty { while lines.first?.trimmingCharacters(in: .whitespaces).isEmpty == true { lines.removeFirst() } }
                lines = kept + lines
            }
        }

        note.created = ["created", "date created", "created_at", "creation date", "date", "created time"].lazy.compactMap { props[$0]?.first.flatMap(Self.date) }.first
        note.updated = ["updated", "modified", "updated_at", "last modified", "last edited time", "last edited", "lastmod"].lazy.compactMap { props[$0]?.first.flatMap(Self.date) }.first
        note.tags = ["tags", "tag", "keywords", "labels"].flatMap { props[$0] ?? [] }
            .map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "#[]\"'")) }
            .filter { !$0.isEmpty }
        note.body = cleanBody(lines)
        return note
    }

    /// The Notion properties Amber Notes keeps as dates and tags.
    static let notionKeys: Set<String> = ["created", "created time", "date created", "last edited time", "last edited", "updated", "tags", "tag"]

    // MARK: Front matter

    static func frontMatter(_ lines: [String]) -> [String: [String]] {
        var out: [String: [String]] = [:]
        var key: String?
        for raw in lines {
            let line = raw.replacingOccurrences(of: "\t", with: "  ")
            if let k = key, let r = line.range(of: #"^\s+-\s*"#, options: .regularExpression) {
                out[k, default: []].append(unquote(String(line[r.upperBound...])))
                continue
            }
            guard let colon = line.firstIndex(of: ":"), !line.hasPrefix(" ") else { continue }
            let k = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let v = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            key = k
            if v.isEmpty { out[k] = out[k] ?? []; continue }
            out[k] = (k.contains("tag") || k == "keywords" || k == "aliases") ? list(v) : [unquote(v)]
        }
        return out
    }

    /// `[a, b]`, `a, b` or `a b` (tags written with #).
    static func list(_ v: String) -> [String] {
        var s = v.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("["), s.hasSuffix("]") { s = String(s.dropFirst().dropLast()) }
        let parts = s.contains(",") ? s.split(separator: ",") : (s.hasPrefix("#") ? s.split(separator: " ") : [Substring(s)])
        return parts.map { unquote(String($0).trimmingCharacters(in: .whitespaces)) }.filter { !$0.isEmpty }
    }

    static func unquote(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespaces)
        if t.count >= 2, (t.hasPrefix("\"") && t.hasSuffix("\"")) || (t.hasPrefix("'") && t.hasSuffix("'")) { t = String(t.dropFirst().dropLast()) }
        return t
    }

    static func logseqProperty(_ line: String) -> (String, String)? {
        guard let r = line.range(of: #"^([A-Za-z0-9_-]+)::\s?(.*)$"#, options: .regularExpression) else { return nil }
        let s = String(line[r])
        let parts = s.components(separatedBy: "::")
        return (parts[0].lowercased(), parts.dropFirst().joined(separator: "::").trimmingCharacters(in: .whitespaces))
    }

    // MARK: Dates

    /// The forms exports write dates in: ISO 8601 with or without time or zone, Joplin's
    /// "2023-04-11 10:24:32Z", Notion's "September 12, 2023 3:04 PM", Unix seconds.
    static func date(_ raw: String) -> Date? {
        let s = unquote(raw)
        guard !s.isEmpty else { return nil }
        if let n = Double(s), n > 100_000_000 { return Date(timeIntervalSince1970: n > 100_000_000_000 ? n / 1000 : n) }
        let iso = ISO8601DateFormatter()
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] {
            iso.formatOptions = options
            if let d = iso.date(from: s) { return d }
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        let zoned = ["yyyy-MM-dd HH:mm:ssXXXXX", "yyyy-MM-dd HH:mm:ssX", "yyyy-MM-dd'T'HH:mm:ssXXXXX"]
        for format in zoned + ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd",
                               "MMMM d, yyyy h:mm a", "MMMM d, yyyy", "yyyy/MM/dd HH:mm", "yyyy/MM/dd", "MMM d, yyyy"] {
            f.dateFormat = format
            if let d = f.date(from: s) { return d }
        }
        return nil
    }

    // MARK: Body

    /// Logseq's task words and block properties, outside code blocks.
    static func cleanBody(_ lines: [String]) -> String {
        var out: [String] = []
        var fence = false
        for line in lines {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") { fence.toggle(); out.append(line); continue }
            if fence { out.append(line); continue }
            // Logseq keeps block ids and folding as properties; they mean nothing here.
            if line.range(of: #"^\s*(id|collapsed|heading)::\s"#, options: .regularExpression) != nil { continue }
            if let r = line.range(of: #"^(\s*)- (TODO|DOING|NOW|LATER|WAITING|DONE|CANCELED|CANCELLED) "#, options: .regularExpression) {
                let indent = line[r].prefix { $0 == " " || $0 == "\t" }
                let word = line[r].trimmingCharacters(in: .whitespaces).dropFirst(2)
                let done = word.hasPrefix("DONE") || word.hasPrefix("CANCEL")
                out.append("\(indent)- [\(done ? "x" : " ")] " + line[r.upperBound...])
                continue
            }
            out.append(line)
        }
        while out.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { out.removeLast() }
        return out.joined(separator: "\n")
    }

    private static let wiki = try! NSRegularExpression(pattern: #"(!?)\[\[([^\]\n]+?)\]\]"#)
    private static let mdLink = try! NSRegularExpression(pattern: #"(!?)\[((?:[^\[\]\n]|\[[^\]\n]*\])*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)"#)
    private static let htmlImage = try! NSRegularExpression(pattern: #"<img\s[^>]*src="([^"]+)"[^>]*>"#, options: .caseInsensitive)

    /// Links and embeds made Amber Notes': a file inside the export becomes an attachment on a line
    /// of its own (`file` returns its markdown), a link to another note becomes its title, a wiki
    /// link `[[Page|Alias]]` its alias. Web links stay. Code blocks are left alone.
    static func rewriteLinks(_ body: String, file: (String) -> String?, noteTitle: (String) -> String?, missing: () -> Void) -> String {
        var out: [String] = []
        var fence = false
        for line in body.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") { fence.toggle(); out.append(line); continue }
            if fence { out.append(line); continue }
            var embeds: [String] = []
            var s = line
            s = replace(wiki, in: s) { m in
                let embed = !m[1].isEmpty
                let inner = m[2]
                let target = String(inner.split(separator: "|", maxSplits: 1).first ?? "").trimmingCharacters(in: .whitespaces)
                let alias = inner.contains("|") ? String(inner.split(separator: "|", maxSplits: 1)[1]) : nil
                let page = String(target.split(separator: "#", maxSplits: 1).first ?? "")
                if embed {
                    let ext = (page as NSString).pathExtension.lowercased()
                    if !ext.isEmpty, !noteExtensions.contains(ext) {
                        if let md = file(page) { embeds.append(md) } else { missing() }
                        return ""
                    }
                }
                // An image size (`![[pic.png|300]]`) isn't an alias.
                if let alias, Int(alias) == nil { return alias }
                return noteTitle(page) ?? MarkdownImporter.cleanName((page as NSString).lastPathComponent)
            }
            s = replace(htmlImage, in: s) { m in
                guard !isExternal(m[1]) else { return m[0] }
                if let md = file(m[1]) { embeds.append(md) } else { missing() }
                return ""
            }
            s = replace(mdLink, in: s) { m in
                let image = !m[1].isEmpty
                let text = m[2]
                let dest = m[3]
                guard !isExternal(dest) else { return m[0] }
                if let title = noteTitle(dest), !image { return text.isEmpty ? title : text }
                if let md = file(dest) { embeds.append(md); return image ? "" : text }
                if noteTitle(dest) == nil, !(dest as NSString).pathExtension.isEmpty, !noteExtensions.contains((dest as NSString).pathExtension.lowercased()) { missing() }
                return text
            }
            if s == line {
                out.append(s)
                continue
            }
            // Files show only on a line of their own; what was around them stays on its line, and
            // a line left with nothing but its list marker goes.
            let rest = s.trimmingCharacters(in: .whitespaces)
            if !rest.isEmpty, rest.range(of: #"^([-*+]|\d+[.)])( \[[ xX]\])?$"#, options: .regularExpression) == nil {
                out.append(String(line.prefix { $0 == " " || $0 == "\t" }) + rest)
            }
            out += embeds
        }
        return out.joined(separator: "\n")
    }

    private static let noteExtensions = MarkdownImporter.noteExtensions

    static func isExternal(_ dest: String) -> Bool {
        let d = dest.trimmingCharacters(in: CharacterSet(charactersIn: "<> "))
        return d.hasPrefix("#") || d.range(of: #"^[A-Za-z][A-Za-z0-9+.-]*:"#, options: .regularExpression) != nil
    }

    private static func replace(_ re: NSRegularExpression, in s: String, with make: ([String]) -> String) -> String {
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let groups = (0..<m.numberOfRanges).map { m.range(at: $0).location == NSNotFound ? "" : ns.substring(with: m.range(at: $0)) }
            out += make(groups)
            last = NSMaxRange(m.range)
        }
        return out + ns.substring(from: last)
    }
}
