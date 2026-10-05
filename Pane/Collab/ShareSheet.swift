import SwiftUI

/// Share (prototype): who's in the note, one Share Link button, and what the link lets people do.
///
/// - People come first: everyone in the note with their role. Remove is in a row's context menu
///   (and a swipe on iPhone); removing someone quietly gives the note a new key and a new link.
/// - Share Link hands the link to the system share sheet (iPhone) or share menu (Mac), which
///   already have Copy. The link itself is never shown.
/// - "People with the link can edit / view", or the link is off. Off deletes the link; turning it
///   on again makes a new one, which is also the way to retire a link that went too far.
/// - Can view opens a read-only page (no account); Can edit opens the note in Amber Notes and adds
///   the person to it. Both stay end-to-end encrypted: the key travels in the link's fragment.
/// - Share as Template is a quiet item at the bottom.
///
/// No email invites in v1: people who sign in with Apple often hide their address.
struct ShareState: Equatable {
    enum Access: String, CaseIterable, Identifiable {
        case edit = "Can edit", view = "Can view", off = "Off"
        var id: String { rawValue }
    }
    struct Person: Identifiable, Equatable {
        let id: UUID
        var name: String
        var isMe = false
        var role: String
        var safetyCode: String?
    }
    var link: URL?
    var access: Access = .view
    var people: [Person] = []
    var problem: String?
}

/// The sheet's content, on its own so it can be shown with sample state (the gallery, Mac shots).
struct ShareForm: View {
    let title: String
    let state: ShareState
    var setAccess: (ShareState.Access) -> Void = { _ in }
    var remove: (ShareState.Person) -> Void = { _ in }
    var template: () -> Void = {}
    var done: () -> Void = {}

    var body: some View {
        Form {
            Section {
                ForEach(state.people) { p in
                    Group {
                        if p.isMe || p.safetyCode == nil { PersonRow(person: p) }
                        else { NavigationLink(value: p.id) { PersonRow(person: p) } }
                    }
                    #if os(iOS)
                    .swipeActions { if !p.isMe { Button("Remove", role: .destructive) { remove(p) } } }
                    #endif
                    .contextMenu { if !p.isMe { Button("Remove from Note", systemImage: "person.badge.minus", role: .destructive) { remove(p) } } }
                }
            }

            Section {
                shareButton
                Picker(selection: Binding(get: { state.access }, set: setAccess)) {
                    ForEach(ShareState.Access.allCases) { Text($0.rawValue).tag($0) }
                } label: {
                    Text("People with the link")
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("share.access")
            } footer: {
                if let problem = state.problem { Text(problem).foregroundStyle(.red) }
            }

            Section {
                Button("Share as Template…", action: template)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("share.template")
            }
        }
        .formStyle(.grouped)
        #if os(macOS)
        .buttonStyle(.borderless)
        #endif
        .navigationTitle("Share")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: done) } }
        .navigationDestination(for: UUID.self) { id in
            if let p = state.people.first(where: { $0.id == id }) { PersonDetail(person: p, remove: { remove(p) }) }
        }
    }

    /// One button. The system share sheet (iPhone) or menu (Mac) has Copy and every app to send it with.
    @ViewBuilder
    private var shareButton: some View {
        if let link = state.link, state.access != .off {
            ShareLink(item: link, subject: Text(title)) {
                Label("Share Link", systemImage: "square.and.arrow.up")
            }
            .accessibilityIdentifier("share.link")
        } else {
            Button("Share Link", systemImage: "square.and.arrow.up") { setAccess(.view) }
                .accessibilityIdentifier("share.link")
        }
    }
}

private struct PersonRow: View {
    let person: ShareState.Person

    var body: some View {
        HStack(spacing: 12) {
            // On its own in a row, an avatar needs no ring.
            PersonAvatar(name: person.name, color: person.isMe ? Color(PColor.paneAccent) : CollabSession.color(for: person.id), size: 32,
                         ring: .clear, ink: person.isMe ? .avatarOnAmber : .white)
            Text(person.isMe ? "\(person.name) (you)" : person.name)
            Spacer()
            Text(person.role == "owner" ? "Owner" : person.role == "editor" ? "Can edit" : "Can view")
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A person, opened: their safety code for anyone who wants to check, and Remove.
private struct PersonDetail: View {
    let person: ShareState.Person
    let remove: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var first: String { person.name.split(separator: " ").first.map(String.init) ?? person.name }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    PersonAvatar(name: person.name, color: CollabSession.color(for: person.id), size: 48, ring: .clear)
                    VStack(alignment: .leading) {
                        Text(person.name).font(.headline)
                        Text(person.role == "owner" ? "Owner" : person.role == "editor" ? "Can edit" : "Can view").foregroundStyle(.secondary)
                    }
                }
            }
            if let code = person.safetyCode {
                Section {
                    Text(code).font(.title2.monospacedDigit()).frame(maxWidth: .infinity, alignment: .center).textSelection(.enabled)
                } header: {
                    Text("Verify \(first)")
                } footer: {
                    Text("If \(first) sees the same code, you're sharing with the real \(first).")
                }
            }
            Section {
                Button("Remove from Note", role: .destructive) { remove(); dismiss() }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(first)
    }
}

/// The live sheet: the form, wired to CollabStore for this note.
struct ShareSheet: View {
    let note: Note
    let store: CollabStore
    @Environment(\.dismiss) private var dismiss
    @State private var state = ShareState()
    @State private var showTemplate = false

    var body: some View {
        NavigationStack {
            ShareForm(title: note.title, state: state,
                      setAccess: { a in Task { await set(a) } },
                      remove: { p in Task { await run { try await store.remove(p.id, from: note) } } },
                      template: { showTemplate = true },
                      done: { dismiss() })
            .navigationDestination(isPresented: $showTemplate) { TemplateForm(note: note, store: store) }
        }
        .task {
            // Opening Share makes the link (View) unless the note has one; it isn't shown, only shared.
            await run { if store.linkURL(note) == nil, !store.linkOff.contains(note.id) { try await store.ensureLink(note) } }
            // People come and go: keep the list current while the sheet is open.
            while !Task.isCancelled {
                state.people = people
                if let auto = CollabDemo.pendingAccess { CollabDemo.pendingAccess = nil; try? await Task.sleep(for: .seconds(1.2)); await set(auto) }
                try? await Task.sleep(for: .seconds(0.5))
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 360)
        #endif
    }

    /// Everyone in the note; before anyone else joins, just you.
    private var people: [ShareState.Person] {
        let list = store.people(in: note)
        return list.isEmpty ? [.init(id: store.me ?? UUID(), name: store.name, isMe: true, role: "owner")] : list
    }

    private func set(_ access: ShareState.Access) async {
        state.access = access
        await run { try await store.setAccess(access, for: note) }
    }

    private func run(_ work: () async throws -> Void) async {
        do {
            try await work()
            state.problem = nil
        } catch {
            state.problem = (error as? LocalizedError)?.errorDescription ?? "Couldn't share. Try again."
        }
        state.link = store.linkURL(note)
        state.access = store.linkURL(note) == nil ? .off : store.access(note)
        state.people = people
        if let link = state.link { CollabDemo.wrote(state.access == .edit ? "edit-link" : "link", link) }
    }
}
