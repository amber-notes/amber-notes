import Foundation

/// What clicking a link in a note may do. Notes can be written by anyone the account lets
/// in (an AI connection, an import, a paste), so a link only ever opens a web page, a mail
/// or a call, or another note (by id, or by title through a wiki link). file:, smb: (which
/// hands the Mac's login to a stranger's server), other apps' schemes and Amber Notes' own
/// ambernotes: are never opened.
enum LinkPolicy {
    enum Action: Equatable {
        case open(URL)
        case note(UUID)
        /// A wiki link, by the target written in it ("Projects/Kitchen remodel").
        case wiki(String)
        case nothing
    }

    static func action(for url: URL) -> Action {
        switch url.scheme?.lowercased() {
        case "http", "https", "mailto", "tel":
            return .open(url)
        case wikiScheme:
            let target = url.absoluteString.dropFirst(wikiScheme.count + 1).removingPercentEncoding ?? ""
            return target.isEmpty ? .nothing : .wiki(target)
        case "pane-note":
            let id = url.absoluteString.dropFirst("pane-note:".count).prefix(36)
            return UUID(uuidString: String(id)).map(Action.note) ?? .nothing
        default:
            return .nothing
        }
    }

    /// The editor's own address for a wiki link's target; it never leaves the app.
    static let wikiScheme = "pane-wiki"

    static func wikiURL(_ target: String) -> URL? {
        target.addingPercentEncoding(withAllowedCharacters: .alphanumerics).flatMap { URL(string: "\(wikiScheme):\($0)") }
    }

    /// Links that arrive as strings (NSTextView passes either).
    static func action(for link: Any) -> Action {
        if let url = link as? URL { return action(for: url) }
        if let s = link as? String, let url = URL(string: s) { return action(for: url) }
        return .nothing
    }
}
