import SwiftUI

/// Collaboration (prototype): who's in the note, as the note's toolbar and header show it.

/// One person: initials on their colour (or their photo, in the product), with a ring of the page
/// colour so overlapping avatars read as separate, and a pencil while they type.
struct PersonAvatar: View {
    let name: String
    let color: Color
    var size: CGFloat = 28
    var typing = false

    var body: some View {
        Text(AvatarView.initials(name))
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(color, in: .circle)
            .overlay(Circle().strokeBorder(Color.notePage, lineWidth: 2))
            .overlay(alignment: .bottomTrailing) {
                if typing {
                    Image(systemName: "pencil")
                        .font(.system(size: size * 0.3, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: size * 0.48, height: size * 0.48)
                        .background(color, in: .circle)
                        .overlay(Circle().strokeBorder(Color.notePage, lineWidth: 1.5))
                        .offset(x: size * 0.12, y: size * 0.12)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .accessibilityHidden(true)
    }
}

/// The avatars of everyone else who has the note open, overlapping, newest last. Tapping opens
/// the people sheet. With nobody else here it's the plain "people" button.
struct PresenceStack: View {
    let session: CollabSession
    var action: () -> Void

    private var here: [CollabSession.Peer] { session.peers.values.sorted { $0.name < $1.name } }

    var body: some View {
        Button(action: action) {
            if here.isEmpty {
                Label("People", systemImage: "person.2")
            } else {
                HStack(spacing: -8) {
                    ForEach(here.prefix(3)) { p in
                        PersonAvatar(name: p.name, color: CollabSession.color(for: p.id), typing: p.isTyping)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    }
                    if here.count > 3 {
                        Text("+\(here.count - 3)")
                            .font(.system(size: 11, weight: .semibold))
                            .frame(width: 28, height: 28)
                            .background(.quaternary, in: .circle)
                    }
                }
                .padding(.horizontal, 4)
                .animation(.spring(duration: 0.35, bounce: 0.3), value: here.map(\.id))
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

/// Everyone in the note, who's here now, and inviting someone.
struct PeopleSheet: View {
    let session: CollabSession
    let store: CollabStore
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var found: (name: String, code: String)?
    @State private var problem: String?
    @State private var working = false

    var body: some View {
        NavigationStack {
            List {
                Section("In this note") {
                    ForEach(session.members) { m in
                        HStack(spacing: 12) {
                            PersonAvatar(name: m.name, color: m.id == session.me ? Color(PColor.paneAccent) : CollabSession.color(for: m.id), size: 34,
                                         typing: session.peers[m.id]?.isTyping ?? false)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.id == session.me ? "\(m.name) (you)" : m.name).font(.body)
                                Text(status(m)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(m.role == "owner" ? "Owner" : m.role == "editor" ? "Can edit" : "Can view")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    TextField("Email address", text: $email)
                        .textContentType(.emailAddress)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("collab.email")
                    Button(working ? "Inviting…" : "Invite to edit") { Task { await invite() } }
                        .disabled(email.isEmpty || working)
                        .accessibilityIdentifier("collab.invite")
                    if let found {
                        Text("Invited \(found.name). Safety code \(found.code): if you want to be sure it's really them, check they see the same code.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
                } header: {
                    Text("Invite people")
                } footer: {
                    Text("People you invite can read and edit this note on their own devices, and their AI can too if they connected one. It stays end-to-end encrypted.")
                }
            }
            .navigationTitle("People")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await session.refreshMembers() }
            .task {
                // The demo types the address and presses Invite itself.
                guard let address = CollabDemo.pendingInvite else { return }
                CollabDemo.pendingInvite = nil
                try? await Task.sleep(for: .seconds(0.8))
                for ch in address {
                    email.append(ch)
                    try? await Task.sleep(for: .seconds(0.06))
                }
                try? await Task.sleep(for: .seconds(0.6))
                await invite()
                try? await Task.sleep(for: .seconds(2.6))
                dismiss()
            }
        }
    }

    private func status(_ m: CollabSession.Member) -> String {
        if m.id == session.me { return "Here" }
        if let p = session.peers[m.id] { return p.isTyping ? "Editing now" : "Here now" }
        return m.accepted ? "Not here" : "Invited"
    }

    private func invite() async {
        working = true
        defer { working = false }
        problem = nil
        do {
            guard let hit = try await store.find(email) else { problem = "No Amber Notes account uses that address."; return }
            try await store.invite(hit.person, to: session.noteID)
            found = (hit.person.display_name ?? email, hit.code)
            email = ""
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? "Couldn't invite. Try again."
        }
    }
}
