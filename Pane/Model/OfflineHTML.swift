import Foundation

/// HTML made safe to hand to the system's HTML import (NSAttributedString), which is
/// built on WebKit and fetches images, stylesheets and frames while it converts. A pasted
/// or imported page could otherwise ping a tracker with your address, or stall the app on
/// a slow server. Everything that could load something is removed first; text, links
/// and inline formatting stay.
enum OfflineHTML {
    private static let rules: [(NSRegularExpression, String)] = [
        // Whole elements that only ever load or run something.
        (#"<(script|iframe|object|embed|video|audio|picture|svg|math|template|noscript|frameset|frame|applet)\b[^>]*>[\s\S]*?</\1\s*>"#, ""),
        (#"<(img|link|meta|base|source|track|input|iframe|embed|object|frame|image)\b[^>]*/?>"#, ""),
        // Attributes that load something.
        (#"\s(src|srcset|background|poster|data|lowsrc|dynsrc|xlink:href|formaction|action|ping)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#, ""),
        // CSS that loads something: url(...), @import, image-set(...).
        (#"@import[^;]*;?"#, ""),
        (#"(?:url|image-set|image|cross-fade|element)\s*\([^)]*\)"#, "none"),
    ].map { (try! NSRegularExpression(pattern: $0.0, options: [.caseInsensitive]), $0.1) }

    static func strip(_ html: String) -> String {
        var s = html
        for (re, with) in rules {
            s = re.stringByReplacingMatches(in: s, range: NSRange(location: 0, length: (s as NSString).length), withTemplate: with)
        }
        return s
    }

    static func strip(_ data: Data) -> Data {
        guard let s = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return Data() }
        return Data(strip(s).utf8)
    }
}
