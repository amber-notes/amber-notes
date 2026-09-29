import SwiftData
import SwiftUI

/// Screenshots and recordings only (`-uitest`): an AI's edit played on a demo note, as if a
/// sync had just brought it.
///   `-aiEdit Groceries -aiScene paella -aiBy ChatGPT -aiAfter 2.5`
enum Capture {
    static func argument(_ name: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// What an AI might do to a demo note, as the website's demo tells it.
    static func edited(_ body: String, scene: String) -> String {
        switch scene {
        case "paella":
            return body.replacingOccurrences(of: "- [ ] Oat milk", with: "- [ ] Paella rice\n- [ ] Saffron\n- [ ] Chorizo\n- [ ] Chicken thighs\n- [ ] Smoked paprika\n- [ ] Oat milk")
        case "lisbon":
            return body.replacingOccurrences(of: "- [ ] Day trip to Sintra", with: "- [ ] Day trip to Sintra\n- [ ] Late checkout requested, confirm by 10 May")
        default:
            return body
        }
    }

    /// The note changes the way a synced AI edit changes it: new text, the AI's name and time
    /// (which the server sets), then the same bookkeeping the sync engine does.
    @MainActor static func aiEdit(_ context: ModelContext, title: String, scene: String, by ai: String) {
        let notes = (try? context.fetch(FetchDescriptor<Note>())) ?? []
        guard let note = notes.first(where: { $0.title == title && $0.deletedAt == nil }) else { return }
        let old = note.body, oldAt = note.aiEditedAt
        let new = edited(old, scene: scene)
        guard new != old else { return }
        note.body = new
        note.updatedAt = .now
        note.aiEditor = ai
        note.aiEditedAt = .now
        AIEdit.arrived(note, previousBody: old, previousEditAt: oldAt, quiet: false)
    }

    @MainActor static func scheduleFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let title = argument("-aiEdit") else { return }
        let delay = argument("-aiAfter").flatMap(Double.init) ?? 2.5
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            aiEdit(context, title: title, scene: argument("-aiScene") ?? "paella", by: argument("-aiBy") ?? "ChatGPT")
        }
    }
}
