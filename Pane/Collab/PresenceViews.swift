import SwiftUI

/// Collaboration (prototype): who's in the note, as the note's toolbar and header show it.

/// One person: a solid circle with their photo, or their initials on their colour, inside a thin
/// solid ring in the toolbar's own colour, so overlapping avatars read as separate. Nothing is
/// see-through and nothing else is drawn on it: you see people editing in the note itself.
struct PersonAvatar: View {
    let name: String
    let color: Color
    var size: CGFloat = 28
    var photo: PImage? = nil
    var ring: Color = .avatarRing
    /// The initials' colour: white on the people colours; the warm ink on your own amber.
    var ink: Color = .white

    /// The ring's width: thin, about a twentieth of the circle, never under 1.5 pt.
    static func ringWidth(_ size: CGFloat) -> CGFloat { max(1.5, (size / 20).rounded()) }

    var body: some View {
        Group {
            if let photo {
                Image(platform: photo).resizable().scaledToFill()
            } else {
                Text(AvatarView.initials(name))
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(color)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .padding(Self.ringWidth(size))
        .background(ring, in: .circle)
        .accessibilityHidden(true)
    }
}

/// Everyone else in the note, gently overlapping, at most three and then "+n".
struct PresenceAvatars: View {
    struct Person: Identifiable, Equatable { let id: UUID; let name: String; var photo: PImage? = nil }
    let people: [Person]
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -(size * 0.22)) {
            ForEach(people.prefix(3)) { p in
                PersonAvatar(name: p.name, color: CollabSession.color(for: p.id), size: size, photo: p.photo)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
            if people.count > 3 {
                Text("+\(people.count - 3)")
                    .font(.system(size: size * 0.36, weight: .semibold))
                    .foregroundStyle(Color.avatarMoreInk)
                    .frame(width: size, height: size)
                    .background(Color.avatarMore, in: .circle)
                    .padding(PersonAvatar.ringWidth(size))
                    .background(Color.avatarRing, in: .circle)
            }
        }
        .animation(.snappy(duration: 0.3), value: people.map(\.id))
    }
}

extension Color {
    /// The ring around an avatar: the colour of the toolbar it sits on, measured on screen.
    /// iPhone: the capsule over the note shows #FFFEFD light and #191919 dark, and in dark mode the
    /// toolbar lifts what it holds by about 13 levels, so the ring is set darker to land on it.
    /// Mac: the capsule shows #F8F7F6 light and #272524 dark, with no lift.
    #if os(iOS)
    static let avatarRing = Color(Palette.pair(0xFCFBFA, 0x0B0B0C))
    #else
    static let avatarRing = Color(Palette.pair(0xF8F7F6, 0x272524))
    #endif
    /// The "+2" circle: solid and quiet.
    static let avatarMore = Color(Palette.pair(0xECE6DF, 0x3A3632))
    static let avatarMoreInk = Color(Palette.pair(0x5F4E3E, 0xD8CEC3))
    /// Initials on your own amber avatar: solid dark brown, readable on both ambers.
    static let avatarOnAmber = Color(Palette.pair(0x2A1D10, 0x2A1D10))
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
                PresenceAvatars(people: here.map { .init(id: $0.id, name: $0.name) })
                    .padding(.horizontal, 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityText)
        .accessibilityIdentifier("collab.people")
    }

    private var accessibilityText: String {
        guard !here.isEmpty else { return "People" }
        return "In this note: " + here.map(\.name).joined(separator: ", ")
    }
}
