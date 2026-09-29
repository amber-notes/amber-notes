import Foundation
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Turns what another app shares (a note from Notes, a web page, text, photos, files) into
/// markdown plus files, the same way the Mac's Apple Notes import converts a note.
/// Used by the share extension; lives here so it can be tested.
enum SharedItem {
    struct Content: Equatable {
        var markdown: String
        var files: [URL]
    }

    /// Reads every provider in order. Rich text wins over plain text for the same item.
    @MainActor
    static func read(_ providers: [NSItemProvider], filesInto dir: URL) async -> Content {
        var texts: [String] = []
        var files: [URL] = []
        for p in providers {
            if let rich = await richText(p, filesInto: dir) {
                texts.append(rich.markdown)
                files += rich.files
                continue
            }
            if p.hasItemConformingToTypeIdentifier(UTType.url.identifier), !p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = await link(p) {
                texts.append(url.absoluteString); continue
            }
            if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
               let s = await string(p, UTType.plainText.identifier) {
                texts.append(s); continue
            }
            if let f = await file(p, into: dir) { files.append(f) }
        }
        return Content(markdown: texts.joined(separator: "\n\n"), files: files)
    }

    /// HTML the way the Mac import converts an Apple Notes body: offline, dashed lists kept.
    @MainActor
    static func markdown(html: String) -> String {
        clean(RichTextToMarkdown.markdown(fromHTML: html))
    }

    /// RTF or RTFD (what Notes and Pages hand over). Pictures inside become files.
    @MainActor
    static func markdown(attributed data: Data, rtfd: Bool, filesInto dir: URL) -> Content? {
        let type: NSAttributedString.DocumentType = rtfd ? .rtfd : .rtf
        guard let text = try? NSAttributedString(data: data, options: [.documentType: type], documentAttributes: nil) else { return nil }
        var files: [URL] = []
        var n = 0
        text.enumerateAttribute(.attachment, in: NSRange(location: 0, length: text.length)) { value, _, _ in
            guard let attachment = value as? NSTextAttachment else { return }
            n += 1
            if let url = save(attachment, index: n, into: dir) { files.append(url) }
        }
        let md = clean(RichTextToMarkdown.markdown(from: text))
        guard !md.isEmpty || !files.isEmpty else { return nil }
        return Content(markdown: md, files: files)
    }

    /// The first non-empty line, without heading marks: the note's title.
    static func title(markdown: String, files: [URL]) -> String {
        let t = markdown.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } ?? ""
        return t.isEmpty ? (files.first?.lastPathComponent ?? "Shared item") : t.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression)
    }

    static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{FFFC}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Providers

    @MainActor
    private static func richText(_ p: NSItemProvider, filesInto dir: URL) async -> Content? {
        // HTML first: it's what the Mac import reads from Notes, so formatting matches.
        if p.hasItemConformingToTypeIdentifier(UTType.html.identifier),
           let data = await data(p, UTType.html.identifier),
           let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) {
            let md = markdown(html: html)
            if !md.isEmpty { return Content(markdown: md, files: []) }
        }
        for (type, rtfd) in [("com.apple.flat-rtfd", true), (UTType.rtfd.identifier, true), (UTType.rtf.identifier, false)]
        where p.hasItemConformingToTypeIdentifier(type) {
            if let data = await data(p, type), let c = markdown(attributed: data, rtfd: rtfd, filesInto: dir) { return c }
        }
        return nil
    }

    // Providers aren't Sendable: every read starts on the main actor and hands back plain values.

    @MainActor
    private static func data(_ p: NSItemProvider, _ type: String) async -> Data? {
        await withCheckedContinuation { c in _ = p.loadDataRepresentation(forTypeIdentifier: type) { d, _ in c.resume(returning: d) } }
    }

    @MainActor
    private static func string(_ p: NSItemProvider, _ type: String) async -> String? {
        let item: String? = await withCheckedContinuation { c in
            p.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                c.resume(returning: (value as? String) ?? (value as? Data).flatMap { String(data: $0, encoding: .utf8) })
            }
        }
        return item
    }

    /// A shared link. On iOS it arrives as an archived NSURL, so let the system decode it:
    /// reading the raw data turns it into "bplist00…" garbage.
    @MainActor
    private static func link(_ p: NSItemProvider) async -> URL? {
        guard p.canLoadObject(ofClass: URL.self) else { return nil }
        return await withCheckedContinuation { c in
            _ = p.loadObject(ofClass: URL.self) { url, _ in c.resume(returning: url) }
        }
    }

    @MainActor
    private static func file(_ p: NSItemProvider, into dir: URL) async -> URL? {
        guard let type = p.registeredTypeIdentifiers.first else { return nil }
        let name = p.suggestedName
        return await withCheckedContinuation { c in
            _ = p.loadFileRepresentation(forTypeIdentifier: type) { src, _ in
                guard let src else { c.resume(returning: nil); return }
                let folder = dir.appending(path: UUID().uuidString, directoryHint: .isDirectory)
                try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let ext = src.pathExtension
                let fname = name.map { ext.isEmpty || $0.hasSuffix(".\(ext)") ? $0 : "\($0).\(ext)" } ?? src.lastPathComponent
                let dest = folder.appending(path: fname)
                c.resume(returning: (try? FileManager.default.copyItem(at: src, to: dest)) != nil ? dest : nil)
            }
        }
    }

    /// Writes one picture or file from rich text next to the note.
    private static func save(_ a: NSTextAttachment, index: Int, into dir: URL) -> URL? {
        let folder = dir.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if let wrapper = a.fileWrapper, let bytes = wrapper.regularFileContents {
            let name = wrapper.preferredFilename ?? wrapper.filename ?? "Attachment \(index)"
            let url = folder.appending(path: name)
            return (try? bytes.write(to: url)) != nil ? url : nil
        }
        if let bytes = a.contents {
            let ext = a.fileType.flatMap { UTType($0)?.preferredFilenameExtension } ?? "dat"
            let url = folder.appending(path: "Attachment \(index).\(ext)")
            return (try? bytes.write(to: url)) != nil ? url : nil
        }
        #if os(iOS)
        if let png = a.image?.pngData() {
            let url = folder.appending(path: "Image \(index).png")
            return (try? png.write(to: url)) != nil ? url : nil
        }
        #endif
        return nil
    }
}
