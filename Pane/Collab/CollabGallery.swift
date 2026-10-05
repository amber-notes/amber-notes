import SwiftUI

/// Collaboration (prototype): the presence avatars and the Share sheet with sample people, for
/// checking them on iPhone and Mac, light and dark (`-collabGallery`, and CollabMacShots).
struct CollabGallery: View {
    static let sara = UUID(uuidString: "5A4A0000-0000-4000-8000-000000000001")!
    static let jonas = UUID(uuidString: "1B4A0000-0000-4000-8000-000000000002")!
    static let emma = UUID(uuidString: "3E4A0000-0000-4000-8000-000000000003")!
    static let li = UUID(uuidString: "7C4A0000-0000-4000-8000-000000000004")!

    static let people: [PresenceAvatars.Person] = [
        .init(id: sara, name: "Sara Lind", typing: true), .init(id: jonas, name: "Jonas Berg", typing: false),
        .init(id: emma, name: "Emma Holm", typing: true), .init(id: li, name: "Li Wei", typing: false),
    ]

    static let share = ShareState(
        link: URL(string: "https://ambernotes.app/s/sEbHaDgYXLDfpSMmrziRgA#gIfSqgKHVsQcWBm2RTA0aw"), access: .edit,
        people: [
            .init(id: UUID(), name: "Emil Wagman", isMe: true, role: "owner", status: "Here"),
            .init(id: sara, name: "Sara Lind", role: "editor", status: "Editing now", safetyCode: "4821 0937 5512", typing: true),
            .init(id: jonas, name: "Jonas Berg", role: "editor", status: "Not here", safetyCode: "0712 8461 3495"),
        ])

    var body: some View {
        NavigationStack {
            List {
                Section("In the toolbar") {
                    row("One person, typing", Array(Self.people.prefix(1)))
                    row("Two, one typing", Array(Self.people.prefix(2)))
                    row("Three, two typing", Array(Self.people.prefix(3)))
                    row("Four (+1)", Self.people)
                }
                Section("Sizes") {
                    HStack(spacing: 18) {
                        ForEach([24, 28, 34, 48], id: \.self) { s in
                            PersonAvatar(name: "Sara Lind", color: CollabSession.color(for: Self.sara), size: CGFloat(s), typing: true)
                        }
                    }
                }
            }
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
