import CryptoKit
import Foundation

/// One note from an Evernote export (.enex), as written there.
struct ENEXNote: Sendable {
    var title = ""
    /// The body: ENML, Evernote's XHTML.
    var content = ""
    var created: Date?
    var updated: Date?
    var tags: [String] = []
    var resources: [ENEXResource] = []
}

/// A file in an Evernote note. The body places it with `<en-media hash="…">`, the MD5 of its bytes.
struct ENEXResource: Sendable {
    var hash = ""
    var mime = ""
    var filename: String?
    /// The decoded bytes, in a scratch folder; nil when the export had none or they didn't decode.
    var file: URL?
    var size = 0
}

/// Reads an .enex file one note at a time with XMLParser on a stream, so a 500 MB export never
/// sits in memory: a note's text is held until the note ends, and attachments are decoded from
/// base64 straight into scratch files as they arrive.
final class ENEXReader: NSObject, XMLParserDelegate {
    enum Failure: LocalizedError, Equatable {
        case notAnExport
        case unreadable(String)
        var errorDescription: String? {
            switch self {
            case .notAnExport: "This file isn't an Evernote export (.enex)."
            case .unreadable(let why): "The file couldn't be read: \(why)"
            }
        }
    }

    private let url: URL
    private let scratch: URL
    /// Called at the end of each note; return false to stop reading.
    private let onNote: (ENEXNote) -> Bool

    private var path: [String] = []
    private var note: ENEXNote?
    private var resource: ENEXResource?
    private var text = ""
    private var sink: Base64Sink?
    private var sawExport = false
    private var stopped = false

    init(url: URL, scratch: URL, onNote: @escaping (ENEXNote) -> Bool) {
        self.url = url
        self.scratch = scratch
        self.onNote = onNote
    }

    /// Reads to the end (or until `onNote` says stop).
    func read() throws {
        guard let stream = InputStream(url: url) else { throw Failure.unreadable("it couldn't be opened.") }
        let parser = XMLParser(stream: stream)
        parser.delegate = self
        parser.shouldResolveExternalEntities = false
        let ok = parser.parse()
        sink?.close()
        if stopped { return }
        if !sawExport { throw Failure.notAnExport }
        if !ok { throw Failure.unreadable(parser.parserError?.localizedDescription ?? "it isn't well-formed XML.") }
    }

    // MARK: Counting

    /// How many notes a file holds, found by scanning its bytes for `<note>` (base64 never has a
    /// `<`, and note bodies are CDATA without one). Fast, and reads 1 MB at a time.
    static func countNotes(in url: URL) throws -> Int {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let needle = Array("<note>".utf8)
        var count = 0
        var carry: [UInt8] = []
        var first = true
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            var bytes = carry
            bytes.append(contentsOf: chunk)
            if first {
                first = false
                guard String(decoding: bytes.prefix(4096), as: UTF8.self).contains("<en-export") else { throw Failure.notAnExport }
            }
            bytes.withUnsafeBufferPointer { b in
                var i = 0
                let end = b.count - needle.count
                while i <= end {
                    if b[i] == 0x3C, b[i + 1] == 0x6E, b[i + 2] == 0x6F, b[i + 3] == 0x74, b[i + 4] == 0x65, b[i + 5] == 0x3E { count += 1; i += 6 } else { i += 1 }
                }
            }
            carry = Array(bytes.suffix(needle.count - 1))
        }
        if first { throw Failure.notAnExport }
        return count
    }

    // MARK: XMLParserDelegate

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        path.append(name)
        text = ""
        switch name {
        case "en-export": sawExport = true
        case "note" where path.count == 2: note = ENEXNote()
        case "resource" where note != nil: resource = ENEXResource()
        case "data" where resource != nil && path.dropLast().last == "resource":
            let dir = scratch.appending(path: UUID().uuidString, directoryHint: .isDirectory)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            sink = Base64Sink(file: dir.appending(path: "data"))
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if sink != nil { sink?.feed(string); return }
        // Only short fields and the body are kept; recognition data and the like are skipped.
        if wantsText { text += string }
    }

    func parser(_ parser: XMLParser, foundCDATA block: Data) {
        if sink != nil { sink?.feed(String(decoding: block, as: UTF8.self)); return }
        if wantsText { text += String(decoding: block, as: UTF8.self) }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        defer { path.removeLast(); text = "" }
        let parent = path.dropLast().last
        if var r = resource {
            switch (parent, name) {
            case ("resource", "data"):
                if var s = sink {
                    sink = nil
                    if let (hash, size) = s.finish(), size > 0 {
                        r.file = s.file
                        r.size = size
                        // The body names a file by the hash of its bytes; the export's own hash is
                        // only a hint, so it's worked out here.
                        r.hash = hash
                    } else {
                        try? FileManager.default.removeItem(at: s.file.deletingLastPathComponent())
                    }
                }
            case ("resource", "mime"): r.mime = trimmed
            case ("resource-attributes", "file-name"): r.filename = trimmed.isEmpty ? nil : trimmed
            case (_, "resource"):
                note?.resources.append(r)
                resource = nil
                return
            default: break
            }
            resource = r
            return
        }
        guard note != nil, parent == "note" || (parent == "en-export" && name == "note") else { return }
        switch name {
        case "title": note?.title = trimmed
        case "content": note?.content = text
        case "created": note?.created = Self.date(trimmed)
        case "updated": note?.updated = Self.date(trimmed)
        case "tag": if !trimmed.isEmpty { note?.tags.append(trimmed) }
        case "note":
            if let n = note, !onNote(n) {
                stopped = true
                parser.abortParsing()
            }
            note = nil
        default: break
        }
    }

    private var wantsText: Bool {
        guard let last = path.last else { return false }
        let parent = path.dropLast().last
        if parent == "note" { return ["title", "content", "created", "updated", "tag"].contains(last) }
        if parent == "resource" { return last == "mime" }
        return parent == "resource-attributes" && last == "file-name"
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Evernote's dates: "20231105T143012Z", always UTC.
    static func date(_ s: String) -> Date? {
        let d = Array(s.utf8)
        guard d.count >= 15, d[8] == UInt8(ascii: "T") else { return nil }
        func n(_ a: Int, _ b: Int) -> Int? { Int(String(decoding: d[a..<b], as: UTF8.self)) }
        guard let y = n(0, 4), let mo = n(4, 6), let day = n(6, 8), let h = n(9, 11), let mi = n(11, 13), let sec = n(13, 15) else { return nil }
        var c = DateComponents()
        (c.year, c.month, c.day, c.hour, c.minute, c.second) = (y, mo, day, h, mi, sec)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: c)
    }
}

/// Decodes base64 as it arrives, writing the bytes to a file and hashing them on the way.
/// Holds at most a few kilobytes of undecoded text.
struct Base64Sink {
    let file: URL
    private var handle: FileHandle?
    private var pending: [UInt8] = []
    private var md5 = Insecure.MD5()
    private var size = 0
    private var failed = false

    init(file: URL) {
        self.file = file
        FileManager.default.createFile(atPath: file.path, contents: nil)
        handle = try? FileHandle(forWritingTo: file)
        pending.reserveCapacity(1 << 16)
        if handle == nil { failed = true }
    }

    mutating func feed(_ s: String) {
        guard !failed else { return }
        for b in s.utf8 {
            switch b {
            case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "+"), UInt8(ascii: "/"), UInt8(ascii: "="):
                pending.append(b)
            default: break
            }
        }
        if pending.count >= 1 << 16 { flush(final: false) }
    }

    private mutating func flush(final: Bool) {
        let n = final ? pending.count : pending.count / 4 * 4
        guard n > 0 else { return }
        var chunk = Array(pending[0..<n])
        pending.removeFirst(n)
        if final { while chunk.count % 4 != 0 { chunk.append(UInt8(ascii: "=")) } }
        guard let data = Data(base64Encoded: Data(chunk)) else { failed = true; return }
        md5.update(data: data)
        size += data.count
        do { try handle?.write(contentsOf: data) } catch { failed = true }
    }

    /// The bytes' MD5 (lowercase hex) and length, or nil if they didn't decode or write.
    mutating func finish() -> (String, Int)? {
        flush(final: true)
        close()
        guard !failed else { return nil }
        return (md5.finalize().map { String(format: "%02x", $0) }.joined(), size)
    }

    mutating func close() {
        try? handle?.close()
        handle = nil
    }
}
