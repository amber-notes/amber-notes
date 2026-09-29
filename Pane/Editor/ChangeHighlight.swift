import Foundation

/// Lines an AI connection just changed, tinted in amber behind the text.
///
/// Only App Store captures use it today: `-uitest -highlight "Saffron|Chorizo"` names the lines
/// (their text, without the list marker). Live sync doesn't mark changes yet.
enum ChangeHighlight {
    static let lines: Set<String> = {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-highlight"), i + 1 < args.count else { return [] }
        return Set(args[i + 1].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) })
    }()

    /// Whether this markdown line (a whole paragraph, marker included) is one of them.
    static func matches(_ paragraph: String) -> Bool {
        guard !lines.isEmpty else { return false }
        var text = paragraph.trimmingCharacters(in: .newlines)
        if let prefix = ListPrefix(line: text) { text = (text as NSString).substring(from: prefix.length) }
        return lines.contains(text.trimmingCharacters(in: .whitespaces))
    }
}
