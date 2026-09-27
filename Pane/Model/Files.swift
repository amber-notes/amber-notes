import Foundation
import SwiftData
import UniformTypeIdentifiers

/// A file kept in Pane (PDF, spreadsheet, image…). Notes embed it with
/// `[name](pane-file:<id>)`; the bytes live in the app's container and in Storage.
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

/// A single-line embed in a note: a file, an image, or a link preview.
struct LineEmbed: Equatable {
    enum Kind: Equatable {
        case file(UUID, name: String)
        case image(UUID, name: String)
        case link(URL)
    }
    var kind: Kind
    /// The line, without its newline.
    var range: NSRange
    var index: Int

    private static let fileLine = try! NSRegularExpression(pattern: #"^[ \t]*(!?)\[([^\]]*)\]\(pane-file:([0-9a-fA-F-]{36})\)[ \t]*$"#)
    private static let linkLine = try! NSRegularExpression(pattern: #"^[ \t]*<?(https?://[^\s<>]+)>?[ \t]*$"#)

    static func find(in text: String) -> [LineEmbed] {
        let ns = text as NSString
        var out: [LineEmbed] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs, .substringNotRequired]) { _, r, _, _ in
            if let m = fileLine.firstMatch(in: text, range: r), let id = UUID(uuidString: ns.substring(with: m.range(at: 3))) {
                let name = ns.substring(with: m.range(at: 2))
                let image = m.range(at: 1).length > 0
                out.append(LineEmbed(kind: image ? .image(id, name: name) : .file(id, name: name), range: r, index: out.count))
            } else if let m = linkLine.firstMatch(in: text, range: r), let url = URL(string: ns.substring(with: m.range(at: 1))) {
                out.append(LineEmbed(kind: .link(url), range: r, index: out.count))
            }
        }
        return out
    }

    var height: CGFloat {
        switch kind {
        case .file: 60
        case .image: 220
        case .link: 76
        }
    }

    var key: String {
        switch kind {
        case .file(let id, _), .image(let id, _): "f\(id)"
        case .link(let u): "l\(index)\(u.absoluteString)"
        }
    }
}
