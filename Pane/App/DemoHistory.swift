import Foundation
import SwiftData

/// A made-up version history for the demo library (`-demo -demoHistory`), for captures and
/// tests: a few days of edits from an iPhone and a Mac, a ChatGPT edit and a Claude Code one.
/// Restoring works as it does on the server: the text it replaces becomes a version too.
@MainActor
final class DemoHistoryStore: NoteHistoryStore {
    struct Kept { var version: NoteVersion; var body: String }

    /// Earlier versions per note, newest first.
    private var kept: [UUID: [Kept]] = [:]
    private var current: [UUID: NoteVersion] = [:]
    private let context: ModelContext
    /// `-historyOffline`: every fetch fails the way it does with no connection.
    var offline = false

    init(context: ModelContext, now: Date = .now) {
        self.context = context
        offline = ProcessInfo.processInfo.arguments.contains("-historyOffline")
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        for note in notes where note.deletedAt == nil {
            guard let script = Self.script(for: note.title) else { continue }
            seed(note, script, now: now)
        }
    }

    /// One step back in time: how long before the one after it, who wrote the text it replaced
    /// (the version this step creates), and how that text differed.
    struct Step {
        var before: TimeInterval
        var author: VersionAuthor
        var change: (String) -> String
    }

    private static func script(for title: String) -> (current: VersionAuthor, steps: [Step])? {
        let iPhone = VersionAuthor.you(device: "iPhone"), mac = VersionAuthor.you(device: "Mac")
        func swap(_ a: String, _ b: String) -> (String) -> String { { $0.replacingOccurrences(of: a, with: b) } }
        func drop(_ line: String) -> (String) -> String { { $0.replacingOccurrences(of: line + "\n", with: "") } }
        let minute: TimeInterval = 60, hour: TimeInterval = 3600, day: TimeInterval = 86400
        switch title {
        case "Groceries":
            return (iPhone, [
                // Before you ticked off the eggs and spinach at the shop.
                Step(before: 2 * hour, author: .ai("ChatGPT")) { swap("- [x] Eggs\n- [x] Spinach", "- [ ] Eggs\n- [ ] Spinach")($0) },
                // Before ChatGPT added what Sunday dinner needs.
                Step(before: 15 * hour, author: mac) { drop("- [ ] Burrata")(drop("- [ ] Cherry tomatoes")(drop("- [ ] Olive oil")($0))) },
                // A burst of typing on the Mac.
                Step(before: 3 * minute, author: mac) { drop("- [ ] Dark chocolate")($0) },
                Step(before: 2 * minute, author: mac) { drop("- [ ] Fresh basil")($0) },
                Step(before: day, author: iPhone) {
                    swap("For the weekend, and Sunday dinner with Sara and Jonas.", "For the weekend.")($0)
                },
                Step(before: 1.5 * day, author: .ai("Claude Code")) { drop("- [ ] Coffee beans")(drop("- [ ] Lemons")($0)) },
                Step(before: 2 * hour, author: iPhone) { swap("- [x] Sourdough\n", "")(swap("For the weekend.\n\n", "")($0)) },
            ])
        case "Lisbon":
            return (mac, [
                Step(before: 40 * minute, author: .ai("ChatGPT")) { drop("- LX Factory on Sunday")($0) },
                Step(before: day, author: iPhone) { swap("- [x] Hotel in Príncipe Real", "- [ ] Hotel in Príncipe Real")($0) },
                Step(before: 4 * minute, author: iPhone) { drop("- [ ] Day trip to Sintra")($0) },
            ])
        case "Standup notes":
            return (mac, [
                Step(before: 30 * minute, author: mac) { swap("- Ask about the CI flake", "- Ask about the CI flake\n- Demo on Friday")($0) },
            ])
        default:
            return nil
        }
    }

    private func seed(_ note: Note, _ script: (current: VersionAuthor, steps: [Step]), now: Date) {
        var text = note.body
        var version = Int64(script.steps.count * 3 + 4)
        var at = min(note.updatedAt, now)
        current[note.id] = NoteVersion(version: version, madeAt: at, author: script.current, isCurrent: true)
        var out: [Kept] = []
        for step in script.steps {
            text = step.change(text)
            at -= step.before
            // Gaps in the numbers, as typing between kept versions leaves on the server.
            version -= step.author.isAI ? 1 : 2
            out.append(Kept(version: NoteVersion(version: version, madeAt: at, author: step.author), body: text))
        }
        kept[note.id] = out
    }

    func versions(of note: UUID) async throws -> [NoteVersion] {
        if offline { throw URLError(.notConnectedToInternet) }
        guard let c = current[note] else { return [] }
        return [c] + (kept[note] ?? []).map(\.version)
    }

    func body(of note: UUID, version: Int64) async throws -> String {
        if offline { throw URLError(.notConnectedToInternet) }
        if current[note]?.version == version, let n = context.note(note) { return n.body }
        guard let k = kept[note]?.first(where: { $0.version.version == version }) else { throw HistoryError.gone }
        return k.body
    }

    func restore(note: UUID, version: Int64) async throws -> NoteDTO? {
        if offline { throw URLError(.notConnectedToInternet) }
        guard let n = context.note(note), var c = current[note],
              kept[note]?.contains(where: { $0.version.version == version }) == true else { throw HistoryError.gone }
        c.isCurrent = false
        kept[note, default: []].insert(Kept(version: c, body: n.body), at: 0)
        current[note] = NoteVersion(version: c.version + 1, madeAt: .now, author: .you(device: Backend.device), restored: true, isCurrent: true)
        return nil
    }
}
