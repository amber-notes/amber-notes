import SwiftUI

/// Collaboration (prototype): who's in the note, as the note's toolbar and header show it.

/// One person: initials on their colour (or their photo, in the product), with a ring of the page
/// colour so overlapping avatars read as separate, and a pencil badge while they type. The view is
/// a little larger than the circle so the badge sits fully inside its own bounds: a toolbar, a
/// stack or a list row never clips it. Only the photo is clipped to the circle, never the badge.
/// The badge sits at the lower left: in an overlapping stack each avatar is drawn over the one
/// before it, so a badge there lies on top of its neighbour instead of under the next one.
struct PersonAvatar: View {
    let name: String
    let color: Color
    var size: CGFloat = 28
    var typing = false

    /// The room the badge takes beyond the circle, on the right and at the bottom.
    static func outset(_ size: CGFloat) -> CGFloat { (size * 0.2).rounded() }

    var body: some View {
        let badge = (size * 0.5).rounded()
        ZStack(alignment: .bottomLeading) {
            Text(AvatarView.initials(name))
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(color, in: .circle)
                .overlay(Circle().strokeBorder(Color.notePage, lineWidth: 2))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            if typing {
                Image(systemName: "pencil")
                    .font(.system(size: badge * 0.56, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: badge, height: badge)
                    .background(color, in: .circle)
                    // A ring in the background colour, so the badge reads on any avatar colour.
                    .padding(1.5)
                    .background(Color.notePage, in: .circle)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .frame(width: size + Self.outset(size), height: size + Self.outset(size))
        .animation(.spring(duration: 0.3, bounce: 0.3), value: typing)
        .accessibilityHidden(true)
    }
}

/// Everyone else in the note, overlapping, at most three and then "+n".
struct PresenceAvatars: View {
    struct Person: Identifiable, Equatable { let id: UUID; let name: String; let typing: Bool }
    let people: [Person]
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -(size * 0.12) - PersonAvatar.outset(size)) {
            ForEach(people.prefix(3)) { p in
                PersonAvatar(name: p.name, color: CollabSession.color(for: p.id), size: size, typing: p.typing)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            }
            if people.count > 3 {
                Text("+\(people.count - 3)")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: size, height: size)
                    .background(.quaternary, in: .circle)
                    .overlay(Circle().strokeBorder(Color.notePage, lineWidth: 2))
                    .padding(.leading, PersonAvatar.outset(size))
                    .frame(height: size + PersonAvatar.outset(size), alignment: .top)
            }
        }
        .animation(.spring(duration: 0.35, bounce: 0.3), value: people.map(\.id))
    }
}

/// The avatars of everyone else who has the note open. Tapping opens Share (the people are
/// listed there). With nobody else here it's the plain "people" button.
struct PresenceStack: View {
    let session: CollabSession
    var action: () -> Void

    private var here: [CollabSession.Peer] { session.peers.values.sorted { $0.name < $1.name } }

    var body: some View {
        Button(action: action) {
            if here.isEmpty {
                Label("People", systemImage: "person.2")
            } else {
                PresenceAvatars(people: here.map { .init(id: $0.id, name: $0.name, typing: $0.isTyping) })
                    .padding(.horizontal, 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
        .accessibilityIdentifier("collab.people")
    }

    private var accessibilityText: String {
        guard !here.isEmpty else { return "People" }
        let names = here.map { $0.isTyping ? "\($0.name), editing" : $0.name }
        return "In this note: " + names.joined(separator: ", ")
    }
}

/// "Sara is editing", under the toolbar while someone else types.
struct EditingLine: View {
    let session: CollabSession

    var body: some View {
        let typing = session.peers.values.filter(\.isTyping).sorted { $0.name < $1.name }
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            HStack(spacing: 6) {
                if let first = typing.first {
                    Circle().fill(CollabSession.color(for: first.id)).frame(width: 7, height: 7)
                    Text(line(typing.map { $0.name.split(separator: " ").first.map(String.init) ?? $0.name }))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .frame(height: typing.isEmpty ? 0 : 22)
            .padding(.horizontal, 20)
            .opacity(typing.isEmpty ? 0 : 1)
            .animation(.easeOut(duration: 0.2), value: typing.isEmpty)
        }
        .accessibilityIdentifier("collab.editing")
    }

    private func line(_ names: [String]) -> String {
        switch names.count {
        case 1: "\(names[0]) is editing"
        case 2: "\(names[0]) and \(names[1]) are editing"
        default: "\(names[0]) and \(names.count - 1) others are editing"
        }
    }
}
