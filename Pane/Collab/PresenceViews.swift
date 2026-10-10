import SwiftUI

/// Collaboration (prototype): who's in the note, as the note's toolbar and header show it.

/// What an avatar in the toolbar can carry (the options being compared, see `BadgeOption`).
enum AvatarBadge: Equatable { case none, pencil, dot }

/// A, B or C: when the toolbar's avatars carry a badge.
enum BadgeOption: String, CaseIterable, Identifiable {
    /// A pencil only while that person types; it fades a moment after they stop.
    case a = "A"
    /// A pencil the whole time someone who can edit is in the note.
    case b = "B"
    /// A live dot while they're here, the pencil instead while they type.
    case c = "C"
    var id: String { rawValue }

    func badge(typing: Bool, canEdit: Bool) -> AvatarBadge {
        switch self {
        case .a: typing ? .pencil : .none
        case .b: canEdit ? .pencil : .none
        case .c: typing ? .pencil : .dot
        }
    }

    /// The option in use (`-badgeOption A|B|C` while choosing; B, the recommendation, otherwise).
    static var current: BadgeOption {
        Capture.argument("-badgeOption").flatMap { BadgeOption(rawValue: $0.uppercased()) } ?? .b
    }
}

/// One person: a solid circle with their photo, or their initials on their colour, inside an
/// opaque ring in the toolbar's own colour, so overlapping avatars read as separate. A badge, when
/// there is one, is solid with the same ring, and sits inside the avatar's own bounds at the lower
/// right, so nothing clips it.
struct PersonAvatar: View {
    let name: String
    let color: Color
    var size: CGFloat = 28
    var photo: PImage? = nil
    var ring: Color = .avatarRing
    /// The initials' colour: white on the people colours; the warm ink on your own amber.
    var ink: Color = .white
    var badge: AvatarBadge = .none
    /// Keeps room for a badge whether or not one shows, so a stack never shifts when it appears.
    var roomForBadge = false
    /// Draws only the badge, in the same place (the stack puts every badge on its own top layer).
    var badgeOnly = false
    var pencilStyle: PencilStyle = .current

    /// The ring's width: 2 pt at toolbar size, a clean cut between overlapping avatars.
    static func ringWidth(_ size: CGFloat) -> CGFloat { max(2, (size / 14).rounded()) }

    /// Where a badge goes: on the lower-right edge of its own circle along the 45° diagonal, its
    /// centre on the circle's edge so about half of it sits over the circle.
    struct Geometry {
        let outer: CGFloat, badge: CGFloat, center: CGPoint, frame: CGSize
        /// The badge's right edge: the next avatar in a stack starts here.
        var badgeRight: CGFloat { center.x + badge / 2 }
    }

    static func geometry(_ size: CGFloat) -> Geometry {
        let ring = ringWidth(size)
        let outer = size + ring * 2
        let badge = size * 0.36 + ring * 0.75 * 2
        let r = outer / 2, d = r, angle = 45.0 * .pi / 180
        let center = CGPoint(x: r + d * cos(angle), y: r + d * sin(angle))
        return Geometry(outer: outer, badge: badge, center: center,
                        frame: CGSize(width: max(outer, center.x + badge / 2), height: max(outer, center.y + badge / 2)))
    }

    var body: some View {
        let g = Self.geometry(size)
        let room = roomForBadge || badge != .none
        ZStack(alignment: .topLeading) {
            if !badgeOnly { circle }
            if badgeOnly || !roomForBadge { badgeView.position(g.center) }
        }
        .frame(width: room ? g.frame.width : g.outer, height: room ? g.frame.height : g.outer, alignment: .topLeading)
        .animation(.easeOut(duration: 0.35), value: badge)
        .accessibilityHidden(true)
    }

    private var circle: some View {
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
    }

    @ViewBuilder
    private var badgeView: some View {
        let inner = size * 0.36
        switch badge {
        case .none:
            EmptyView()
        case .pencil:
            // A heavy glyph, about 60% of the badge, so it reads at real size. Sized by font, not
            // by resizing: a resized symbol ignores the weight and draws thin.
            Image(systemName: "pencil")
                .font(.system(size: inner * 0.66, weight: .heavy))
                .frame(width: inner * 0.6, height: inner * 0.6)
                .foregroundStyle(pencilStyle == .colour ? Color.white : color)
                .frame(width: inner, height: inner)
                .background(pencilStyle == .colour ? color : Color.white, in: .circle)
                .padding(Self.ringWidth(size) * 0.75)
                .background(ring, in: .circle)
                .transition(.opacity)
        case .dot:
            Circle().fill(Color.avatarLive)
                .frame(width: inner * 0.8, height: inner * 0.8)
                .padding(Self.ringWidth(size) * 0.75)
                .background(ring, in: .circle)
                .transition(.opacity)
        }
    }
}

/// The pencil badge's look: the person's colour with a white pencil, or white with the pencil in
/// their colour (`-pencilStyle white` while choosing).
enum PencilStyle: String, CaseIterable {
    case colour, white
    static var current: PencilStyle { Capture.argument("-pencilStyle").flatMap(PencilStyle.init(rawValue:)) ?? .colour }
}

/// Everyone else in the note, gently overlapping, at most three and then "+n".
struct PresenceAvatars: View {
    struct Person: Identifiable, Equatable {
        let id: UUID
        let name: String
        var photo: PImage? = nil
        var typing = false
        var canEdit = true
    }
    let people: [Person]
    var size: CGFloat = 28
    var option: BadgeOption = .current
    var pencilStyle: PencilStyle = .current

    var body: some View {
        row(badges: false)
            // Every badge on a layer of its own above all the circles, so the next avatar never covers one.
            .overlay(alignment: .leading) { row(badges: true) }
        .animation(.snappy(duration: 0.3), value: people.map(\.id))
        // Flattened into one opaque picture before the toolbar's glass gets it. Without this the
        // glass blends each circle with what's behind it, the previous avatar included, so the
        // white cut between them showed a tint of the avatar underneath (seen zoomed at 3x;
        // compositingGroup wasn't enough).
        .drawingGroup()
    }

    private func row(badges: Bool) -> some View {
        let g = PersonAvatar.geometry(size)
        let shown = Array(people.prefix(3))
        return HStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, p in
                let badge = option.badge(typing: p.typing, canEdit: p.canEdit)
                PersonAvatar(name: p.name, color: CollabSession.color(for: p.id), size: size, photo: p.photo,
                             badge: badge, roomForBadge: true, badgeOnly: badges, pencilStyle: pencilStyle)
                    // The next avatar overlaps this one gently, or, when this one has a badge, starts
                    // where the badge ends, so a badge never sits on the next person.
                    .padding(.trailing, i < shown.count - 1 || people.count > 3
                             ? (badge == .none ? g.outer - size * 0.22 : g.badgeRight + 0.5) - g.frame.width : 0)
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
                    .frame(height: g.frame.height, alignment: .top)
                    .opacity(badges ? 0 : 1)
            }
        }
    }
}

extension Color {
    /// The ring around an avatar, and where avatars overlap the cut between them: opaque white in
    /// light mode; in dark mode the toolbar's own colour, measured on screen (#191919 on iPhone,
    /// #272524 on the Mac). The stack is flattened before the glass gets it (drawingGroup), so
    /// these land exactly as written.
    #if os(iOS)
    static let avatarRing = Color(Palette.pair(0xFFFFFF, 0x191919))
    #else
    static let avatarRing = Color(Palette.pair(0xFFFFFF, 0x272524))
    #endif
    /// The "+2" circle: solid and quiet.
    static let avatarMore = Color(Palette.pair(0xECE6DF, 0x3A3632))
    static let avatarMoreInk = Color(Palette.pair(0x5F4E3E, 0xD8CEC3))
    /// The pencil badge: the app's dark ink in light mode, its cream in dark, solid either way.
    static let avatarPencil = Color(Palette.pair(0x2A1D10, 0xEDE6DE))
    static let avatarPencilInk = Color(Palette.pair(0xFFFFFF, 0x2A1D10))
    /// "Here now": a solid green.
    static let avatarLive = Color(Palette.pair(0x2FA44F, 0x34B85A))
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
                // Redrawn twice a second, so a pencil fades a moment after someone stops typing.
                TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                    PresenceAvatars(people: here.map { p in
                        .init(id: p.id, name: p.name, photo: CollabStore.shared?.photos[p.id], typing: p.isTyping,
                              canEdit: session.members.first { $0.id == p.id }?.role != "viewer")
                    })
                }
                .padding(.horizontal, 2)
            }
        }
        .buttonStyle(.hoverIcon(cornerRadius: 12))
        .accessibilityLabel(accessibilityText)
        .accessibilityIdentifier("collab.people")
    }

    private var accessibilityText: String {
        guard !here.isEmpty else { return "People" }
        return "In this note: " + here.map(\.name).joined(separator: ", ")
    }
}
