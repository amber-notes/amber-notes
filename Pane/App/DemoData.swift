import Foundation
import SwiftData

/// Realistic sample notes for recordings and UI tests (`-demo`).
@MainActor
enum DemoData {
    static func load(into context: ModelContext, main: Folder) {
        let ideas = context.createFolder(named: "Ideas")
        let travel = context.createFolder(named: "Travel")
        let work = context.createFolder(named: "Work")
        let q4 = context.createFolder(named: "Q4 planning", parent: work)

        let day: TimeInterval = 86400
        let items: [(Folder, String, TimeInterval, Bool)] = [
            (main, "Groceries\n\n- [ ] Oat milk\n- [x] Sourdough\n- [ ] Lemons\n- [ ] Coffee beans", -600, true),
            (work, "Standup notes\n\nShipped the sync fix. **Blocked** on the review for the importer.\n\n- Next: table editing\n- Ask about the CI flake", -3 * 3600, false),
            (ideas, "App ideas\n\n1. A calmer inbox\n2. Voice notes that file themselves\n3. A reading list that forgets", -day, false),
            (travel, "Lisbon\n\n## Places\n- Time Out Market\n- Miradouro da Senhora do Monte\n\n<details>\n<summary>Hotel booking</summary>\n\nMemmo Príncipe Real, 12–15 May\nConfirmation **LX-48213**\n\n- [x] Paid deposit\n- [ ] Ask for a late checkout\n- [ ] Airport transfer\n\n> Check-in from 15:00\n\n</details>\n\n## Food\n| Place | Dish |\n| --- | --- |\n| Manteigaria | Pastel de nata |\n| Ramiro | Seafood |", -3 * day, false),
            (q4, "Q4 goals\n\n> Ship less, finish more.\n\n- [ ] Launch the new onboarding\n- [ ] Hire a designer\n- [x] Close the books for Q3", -5 * day, false),
            (ideas, "Reading list\n\n- *The Design of Everyday Things*\n- *Shape Up*\n- [Interfaces](https://interfaces.dev)", -12 * day, false),
            (main, "Snippets\n\n```swift\nlet greeting = \"Hello\"\nprint(greeting)\n```", -45 * day, false),
            (travel, "Packing\n\n- [ ] Passport\n- [ ] Chargers\n- [ ] Rain jacket", -80 * day, false),
        ]
        for (folder, body, offset, pinned) in items {
            let n = context.createNote(in: .folder(folder.id), body: body)
            n.updatedAt = .now.addingTimeInterval(offset)
            n.createdAt = n.updatedAt
            n.isPinned = pinned
        }
        try? context.save()
    }
}
