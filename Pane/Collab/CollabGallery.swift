import SwiftUI

/// Collaboration (prototype): the presence avatars and the Share sheet with sample people, for
/// checking them on iPhone and Mac, light and dark (`-collabGallery`, and CollabMacShots).
struct CollabGallery: View {
    static let sara = UUID(uuidString: "5A4A0000-0000-4000-8000-000000000001")!
    static let jonas = UUID(uuidString: "1B4A0000-0000-4000-8000-000000000002")!
    static let emma = UUID(uuidString: "3E4A0000-0000-4000-8000-000000000003")!
    static let li = UUID(uuidString: "7C4A0000-0000-4000-8000-000000000004")!

    static let people: [PresenceAvatars.Person] = [
        .init(id: sara, name: "Sara Lind"), .init(id: jonas, name: "Jonas Berg"),
        .init(id: emma, name: "Emma Holm"), .init(id: li, name: "Li Wei"),
    ]

    static let share = ShareState(
        link: URL(string: "https://ambernotes.app/s/sEbHaDgYXLDfpSMmrziRgA#gIfSqgKHVsQcWBm2RTA0aw"), access: .edit,
        people: [
            .init(id: UUID(), name: "Emil Wagman", isMe: true, role: "owner"),
            .init(id: sara, name: "Sara Lind", role: "editor", safetyCode: "4821 0937 5512"),
            .init(id: jonas, name: "Jonas Berg", role: "viewer", safetyCode: "0712 8461 3495"),
        ])

    /// Share as Template with a habit tracker and its app, for screenshots (`-collabGallery -template`).
    static func templateSheet() -> some View {
        let store = CollabStore(name: "Emil Wagman", email: "emil@example.com", relay: URL(string: "http://127.0.0.1:1")!)
        let note = Note(body: CollabDemo.habitNote())
        store.pages[note.id] = "<!doctype html><title>Habit tracker</title>"
        return NavigationStack { TemplateForm(note: note, store: store) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("On the note's toolbar").font(.headline)
                    row("One person", Array(Self.people.prefix(1)))
                    row("Two", Array(Self.people.prefix(2)))
                    row("Three", Array(Self.people.prefix(3)))
                    row("Four (+1)", Self.people)
                    Text("Sizes").font(.headline).padding(.top, 8)
                    HStack(spacing: 18) {
                        ForEach([24, 28, 32, 48], id: \.self) { s in
                            PersonAvatar(name: "Sara Lind", color: CollabSession.color(for: Self.sara), size: CGFloat(s), ring: .clear)
                        }
                    }
                    Text("Palette").font(.headline).padding(.top, 8)
                    HStack(spacing: 10) {
                        ForEach(Array(["Clay A", "Sage B", "Dusk C", "Plum D", "Teal E", "Olive F"].enumerated()), id: \.offset) { i, n in
                            PersonAvatar(name: n, color: CollabSession.color(at: i), size: 32, ring: .clear)
                        }
                        PersonAvatar(name: "Emil Wagman", color: Color(PColor.paneAccent), size: 32, ring: .clear, ink: .avatarOnAmber)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.notePage)
            .navigationTitle("Team offsite")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    PresenceAvatars(people: Array(Self.people.prefix(3))).padding(.horizontal, 2)
                }
                ToolbarItem(placement: .primaryAction) { Button("More", systemImage: "ellipsis") {} }
            }
        }
    }

    private func row(_ label: String, _ people: [PresenceAvatars.Person]) -> some View {
        HStack {
            Text(label)
            Spacer()
            // The toolbar's capsule, to see the badge against it.
            PresenceAvatars(people: people)
                .padding(.horizontal, 8).padding(.vertical, 5)
                .glassEffect(.regular, in: .capsule)
        }
    }
}
