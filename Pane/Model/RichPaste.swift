import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// What a paste should become.
enum PasteKind: Equatable { case image, richText, plain }

extension RichPaste {
    /// An image wins unless there's real text alongside it: browsers and apps put
    /// the image's address or an <img> tag next to the picture itself.
    static func kind(hasImage: Bool, text: String?, htmlIsOnlyImage: Bool) -> PasteKind {
        guard hasImage else { return .richText }
        let t = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty || htmlIsOnlyImage || t.hasPrefix("http") && !t.contains(" ") || t.hasPrefix("file:") { return .image }
        return .richText
    }

    /// True when HTML is just an image (and wrappers), with no text of its own.
    static func htmlIsOnlyImage(_ html: String?) -> Bool {
        guard let html, html.range(of: "<img", options: .caseInsensitive) != nil else { return false }
        let text = html.replacingOccurrences(of: #"<[^>]*>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty
    }
}

/// Turns rich text on the pasteboard (copied from Apple Notes, a web page…) into markdown.
@MainActor
enum RichPaste {
    /// nil when the pasteboard holds plain text only, so the normal paste runs.
    static func markdownFromPasteboard() -> String? {
        guard let attributed = attributedFromPasteboard() else { return nil }
        let md = clean(RichTextToMarkdown.markdown(from: attributed))
        let plain = clean(attributed.string)
        return md == plain ? nil : md
    }

    static func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{FFFC}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func attributedFromPasteboard() -> NSAttributedString? {
        #if os(iOS)
        let pb = UIPasteboard.general
        if let data = pb.data(forPasteboardType: "public.rtfd") ?? pb.data(forPasteboardType: "com.apple.flat-rtfd"),
           let a = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtfd], documentAttributes: nil) { return a }
        if let data = pb.data(forPasteboardType: "public.rtf"),
           let a = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil) { return a }
        if let data = pb.data(forPasteboardType: "public.html"),
           let a = try? NSAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil) { return a }
        return nil
        #else
        let pb = NSPasteboard.general
        if let data = pb.data(forType: .rtfd) ?? pb.data(forType: NSPasteboard.PasteboardType("com.apple.flat-rtfd")),
           let a = NSAttributedString(rtfd: data, documentAttributes: nil) { return a }
        if let data = pb.data(forType: .rtf), let a = NSAttributedString(rtf: data, documentAttributes: nil) { return a }
        if let data = pb.data(forType: .html), let a = NSAttributedString(html: data, documentAttributes: nil) { return a }
        return nil
        #endif
    }
}
