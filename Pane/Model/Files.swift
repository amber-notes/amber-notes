import Foundation
import SwiftData
import ImageIO
import UniformTypeIdentifiers

/// A file kept in Pane (PDF, spreadsheet, image…). Notes embed it with
/// `[name](pane-file:<id>)`, or it sits in a folder on its own, next to the folder's notes
/// (`folderID`). The bytes live in the app's container and, sealed with the account's key,
/// in Storage at `<user id>/<id>`.
@Model
final class Attachment {
    @Attribute(.unique) var id: UUID
    var filename: String
    /// A UTType identifier, e.g. "com.adobe.pdf".
    var contentType: String
    var size: Int64
    var createdAt: Date
    var deletedAt: Date?
    /// The bytes are in Storage.
    var uploaded: Bool = false
    /// Metadata changed here and not yet pushed.
    var dirty: Bool = true
    /// The folder it sits in on its own; nil for a file that only notes embed.
    var folderID: UUID?
    /// In Recently Deleted (a file in a folder). Deleted for good after 30 days.
    var trashedAt: Date?
    /// When its name, folder or state last changed; the list sorts files by it.
    var modifiedAt: Date?

    init(id: UUID = UUID(), filename: String, contentType: String, size: Int64) {
        self.id = id
        self.filename = filename
        self.contentType = contentType
        self.size = size
        createdAt = .now
    }

    var type: UTType { UTType(contentType) ?? .data }
    var isImage: Bool { type.conforms(to: .image) }
    var sizeText: String { ByteCountFormatter.string(fromByteCount: size, countStyle: .file) }
    var kindText: String { type.localizedDescription ?? (filename as NSString).pathExtension.uppercased() }
    var markdown: String { FileStore.markdown(id: id, filename: filename, image: isImage) }

    /// The date the list shows and sorts by.
    var listDate: Date { modifiedAt ?? createdAt }

    /// The icon for this kind of file, in the list and in a note.
    var symbol: String {
        let t = type
        if t.conforms(to: .pdf) { return "doc.richtext" }
        if t.conforms(to: .spreadsheet) || ["xlsx", "xls", "csv", "numbers"].contains(ext) { return "tablecells" }
        if t.conforms(to: .presentation) { return "rectangle.on.rectangle" }
        if t.conforms(to: .image) { return "photo" }
        if t.conforms(to: .audiovisualContent) { return "play.rectangle" }
        if t.conforms(to: .archive) { return "archivebox" }
        if t.conforms(to: .text) { return "doc.text" }
        return "doc"
    }

    private var ext: String { (filename as NSString).pathExtension.lowercased() }

    /// Marks a local change for sync.
    @MainActor func touch() {
        modifiedAt = .now
        dirty = true
        SyncSignal.changed()
    }
}

/// Where attachment bytes live on this device.
enum FileStore {
    static var root: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: ProcessInfo.processInfo.arguments.contains("-uitest") ? "Pane-test/Files" : "Pane/Files", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func url(for id: UUID, filename: String) -> URL {
        root.appending(path: id.uuidString, directoryHint: .isDirectory).appending(path: safe(filename))
    }

    static func exists(_ a: Attachment) -> Bool {
        FileManager.default.fileExists(atPath: url(for: a.id, filename: a.filename).path)
    }

    /// The local copy follows a rename (its name is part of its path here).
    static func rename(_ id: UUID, from old: String, to new: String) {
        let from = url(for: id, filename: old), to = url(for: id, filename: new)
        guard from != to, FileManager.default.fileExists(atPath: from.path) else { return }
        try? FileManager.default.removeItem(at: to)
        try? FileManager.default.moveItem(at: from, to: to)
    }

    /// Removes this device's copy of a file.
    static func remove(_ a: Attachment) {
        try? FileManager.default.removeItem(at: url(for: a.id, filename: a.filename).deletingLastPathComponent())
    }

    /// Copies a file into Pane and returns its record (not yet inserted).
    static func importFile(at source: URL) throws -> Attachment {
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let values = try? source.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey, .nameKey])
        let name = values?.name ?? source.lastPathComponent
        let type = values?.contentType ?? UTType(filenameExtension: source.pathExtension) ?? .data
        let a = Attachment(filename: name, contentType: type.identifier, size: Int64(values?.fileSize ?? 0))
        let dest = url(for: a.id, filename: name)
        try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: source, to: dest)
        if a.size == 0 { a.size = Int64((try? Data(contentsOf: dest).count) ?? 0) }
        return a
    }

    /// Saves raw data (a pasted image, a dropped item without a file URL).
    static func importData(_ data: Data, filename: String, type: UTType) throws -> Attachment {
        let a = Attachment(filename: filename, contentType: type.identifier, size: Int64(data.count))
        let dest = url(for: a.id, filename: filename)
        try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: dest, options: .atomic)
        return a
    }

    static func markdown(id: UUID, filename: String, image: Bool) -> String {
        let label = filename.replacingOccurrences(of: "]", with: ")").replacingOccurrences(of: "[", with: "(")
        return "\(image ? "!" : "")[\(label)](pane-file:\(id.uuidString.lowercased()))"
    }

    private static func safe(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        return cleaned.isEmpty ? "file" : cleaned
    }
}

/// Image heights from their real proportions, for the width images show at.
/// Sub-notes that are apps show in their parent as a live widget instead of a link (prototype;
/// see NotePage). Kept here, off the main actor, because embed heights are read while laying out.
enum NoteWidgets {
    nonisolated(unsafe) private static var apps: [UUID: CGFloat] = [:]
    #if os(iOS)
    static let standard: CGFloat = 300
    #else
    static let standard: CGFloat = 320
    #endif
    /// Wider than images and cards: an app uses the note's width.
    static let maxWidth: CGFloat = 920

    /// The widget's height for a sub-note that is an app, nil for any other note.
    static func height(_ id: UUID) -> CGFloat? { apps[id] }
    static func isApp(_ id: UUID) -> Bool { apps[id] != nil }

    /// A page can ask for its widget height with <meta name="amber-widget-height" content="260">,
    /// from 160 to 600 points.
    static func update(_ id: UUID, html: String?) {
        guard let html else { apps[id] = nil; return }
        var h = standard
        if let r = html.range(of: #"<meta[^>]*name=["']amber-widget-height["'][^>]*content=["']?(\d+)"#, options: .regularExpression),
           let n = html[r].split(whereSeparator: { !$0.isNumber }).last.flatMap({ Double($0) }) {
            h = min(max(CGFloat(n), 160), 600)
        }
        apps[id] = h + WidgetMetrics.header
    }
}

enum WidgetMetrics {
    /// The widget's title bar, above the app.
    static let header: CGFloat = 40
}

enum ImageSizes {
    nonisolated(unsafe) static var aspect: [UUID: CGFloat] = [:]
    static let maxWidth: CGFloat = 520

    static func height(for e: LineEmbed) -> CGFloat {
        guard case .image(let id, _) = e.kind, let a = aspect[id], a > 0 else { return 220 }
        return min(max(maxWidth / a, 80), 560)
    }

    /// Reads the image's pixel size once and remembers its aspect ratio.
    static func learn(_ id: UUID, url: URL) {
        guard aspect[id] == nil, let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? CGFloat, let h = props[kCGImagePropertyPixelHeight] as? CGFloat, h > 0 else { return }
        aspect[id] = w / h
    }
}

/// A single-line embed in a note: a file, an image, or a link preview.
struct LineEmbed: Equatable {
    enum Kind: Equatable {
        case file(UUID, name: String)
        case image(UUID, name: String)
        case link(URL)
        case note(UUID, name: String)
    }
    var kind: Kind
    /// The line, without its newline.
    var range: NSRange
    var index: Int

    private static let fileLine = try! NSRegularExpression(pattern: #"^[ \t]*(!?)\[([^\]]*)\]\(pane-file:([0-9a-fA-F-]{36})\)[ \t]*$"#)
    private static let linkLine = try! NSRegularExpression(pattern: #"^[ \t]*<?(https?://[^\s<>]+)>?[ \t]*$"#)
    private static let noteLine = try! NSRegularExpression(pattern: #"^[ \t]*\[([^\]]*)\]\(pane-note:([0-9a-fA-F-]{36})\)[ \t]*$"#)

    static func find(in text: String) -> [LineEmbed] {
        let ns = text as NSString
        var out: [LineEmbed] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in
            if let e = match(ns, line: r, index: out.count) { out.append(e) }
        }
        return out
    }

    /// The embed on one line, if it is one. Cheap for ordinary lines: only lines
    /// starting with `!`, `[`, `<` or `h` are tried against the patterns.
    static func match(_ ns: NSString, line r: NSRange, index: Int) -> LineEmbed? {
        var i = r.location
        while i < NSMaxRange(r), ns.character(at: i) == 0x20 || ns.character(at: i) == 0x09 { i += 1 }
        guard i < NSMaxRange(r) else { return nil }
        let first = ns.character(at: i)
        let text = ns as String
        if first == 0x21 || first == 0x5B { // ! [
            if let m = fileLine.firstMatch(in: text, range: r), let id = UUID(uuidString: ns.substring(with: m.range(at: 3))) {
                let name = ns.substring(with: m.range(at: 2))
                let image = m.range(at: 1).length > 0
                return LineEmbed(kind: image ? .image(id, name: name) : .file(id, name: name), range: r, index: index)
            }
            if let m = noteLine.firstMatch(in: text, range: r), let id = UUID(uuidString: ns.substring(with: m.range(at: 2))) {
                return LineEmbed(kind: .note(id, name: ns.substring(with: m.range(at: 1))), range: r, index: index)
            }
        } else if first == 0x68 || first == 0x3C { // h <
            if let m = linkLine.firstMatch(in: text, range: r), let url = URL(string: ns.substring(with: m.range(at: 1))) {
                return LineEmbed(kind: .link(url), range: r, index: index)
            }
        }
        return nil
    }

    var height: CGFloat {
        switch kind {
        case .file: 60
        case .image: ImageSizes.height(for: self)
        case .link: 76
        case .note(let id, _): NoteWidgets.height(id) ?? 58
        }
    }

    var key: String {
        switch kind {
        case .file(let id, _), .image(let id, _): "f\(id)"
        case .link(let u): "l\(index)\(u.absoluteString)"
        case .note(let id, _): "n\(id)"
        }
    }
}
