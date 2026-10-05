import Foundation

// Places in the app the onboarding emails link to (supabase/functions/lifecycle). Each is a
// universal link the site's apple-app-site-association claims (/open/*), with a page at the same
// address for people without the app:
//
//     https://ambernotes.app/open/connect-ai   ambernotes://connect-ai   Settings › Connect an AI
//     https://ambernotes.app/open/import       ambernotes://import       Import from Apple Notes (a Mac;
//                                                                        on iPhone, where to do it)
//     https://ambernotes.app/open/history      ambernotes://history      version history of the note an
//                                                                        AI changed last (or the notes)

// MARK: Pure pieces (tested)

enum AppPlace: String, CaseIterable, Sendable {
    case connectAI = "connect-ai"
    case importNotes = "import"
    case history

    /// The place `url` links to, if it's one of these.
    static func parse(_ url: URL) -> AppPlace? {
        let scheme = url.scheme?.lowercased(), host = url.host?.lowercased() ?? ""
        let path = url.path.hasSuffix("/") && url.path.count > 1 ? String(url.path.dropLast()) : url.path
        if scheme == NoteSourceLink.scheme { return path.isEmpty || path == "/" ? AppPlace(rawValue: host) : nil }
        guard scheme == "https", NoteSourceLink.webHosts.contains(host), path.hasPrefix("/open/") else { return nil }
        return AppPlace(rawValue: String(path.dropFirst("/open/".count)))
    }

    /// The note whose history "See your note's history" opens: the one an AI changed last.
    static func historyNote<ID>(_ notes: [(id: ID, aiEditedAt: Date?)]) -> ID? {
        notes.compactMap { n in n.aiEditedAt.map { (n.id, $0) } }.max { $0.1 < $1.1 }?.0
    }
}

/// The place waiting to be opened. Links can arrive before the notes are showing; the views that
/// own each place open it when they see it, then clear it.
@MainActor
@Observable
final class AppPlaceCenter {
    static let shared = AppPlaceCenter()
    var pending: AppPlace?
    /// Set when history should open on this note as soon as it shows.
    var historyFor: UUID?

    @discardableResult
    func receive(_ url: URL) -> Bool {
        guard let place = AppPlace.parse(url) else { return false }
        pending = place
        return true
    }
}
