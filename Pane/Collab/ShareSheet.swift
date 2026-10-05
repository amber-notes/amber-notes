import SwiftUI

/// Share (prototype): one sheet, built around one link. "Anyone with the link can View or Edit."
///
/// - View: the link opens a read-only copy on the web (and its app, read only) with no account.
///   The key is in the link's fragment, so we can't read it.
/// - Edit: opening the link in Amber Notes adds you to the note as an editor. The fragment also
///   carries the join secret; the server keeps only a hash of what it derives.
/// - People in the note are listed under the link, each with Remove. Removing someone, or Reset
///   Link, makes a new note key and a new link.
/// - Checking a person's safety code is on their row (Verify), out of the main flow.
/// - Share as Template is its own item at the bottom, with its public notice.
///
/// No email invites in v1: people who sign in with Apple often hide their address, so a link is
/// the one thing that always reaches them.
struct ShareState: Equatable {
    enum Access: String, CaseIterable, Identifiable { case view = "View", edit = "Edit"; var id: String { rawValue } }
    struct Person: Identifiable, Equatable {
        let id: UUID
        var name: String
        var isMe = false
        var role: String
        /// Here now, Editing now, Not here.
        var status: String
        var safetyCode: String?
        var typing = false
    }
    var link: URL?
    var access: Access = .view
    var people: [Person] = []
    var working = false
    var problem: String?
}

/// The sheet's content, on its own so it can be shown with sample state (Mac shots, previews).
struct ShareForm: View {
    let title: String
    let state: ShareState
    var setAccess: (ShareState.Access) -> Void = { _ in }
    var copy: () -> Void = {}
    var remove: (ShareState.Person) -> Void = { _ in }
    var reset: () -> Void = {}
    var stop: () -> Void = {}
    var template: () -> Void = {}
    var done: () -> Void = {}
    @State private var copied = false

    var body: some View {
        Form {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(state.link?.absoluteString ?? "Making a link…")
                        .font(.footnote.monospaced())
                        .foregroundStyle(state.link == nil ? .secondary : .primary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("share.link")
                }
                Picker("Anyone with the link can", selection: Binding(get: { state.access }, set: setAccess)) {
                    ForEach(ShareState.Access.allCases) { Text($0.rawValue).tag($0) }
                }
                .accessibilityIdentifier("share.access")
                HStack {
                    Button(copied ? "Copied" : "Copy Link", systemImage: copied ? "checkmark" : "doc.on.doc") {
                        copy()
                        withAnimation(.snappy) { copied = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { withAnimation(.snappy) { copied = false } }
                    }
                    .disabled(state.link == nil)
                    Spacer()
                    if let link = state.link {
                        ShareLink(item: link, subject: Text(title)) { Label("Send Link…", systemImage: "square.and.arrow.up") }
                    }
                }
                #if os(macOS)
                .buttonStyle(.borderless)
                #endif
            } footer: {
                Text(state.access == .view
                     ? "They can read the note and use its app, read only, in a browser or in Amber Notes. No account needed. The end of the link is the key, so we can't read the note."
                     : "Opening the link in Amber Notes adds them to this note, and they can edit it with you. They show up below. The end of the link is the key, so we can't read the note.")
            }

            if !state.people.isEmpty {
                Section("People") {
                    ForEach(state.people) { p in
                        Group {
                            if p.isMe { PersonRow(person: p) } else { NavigationLink(value: p.id) { PersonRow(person: p) } }
                        }
                            #if os(iOS)
                            .swipeActions { if !p.isMe { Button("Remove", role: .destructive) { remove(p) } } }
                            #endif
                            .contextMenu { if !p.isMe { Button("Remove", systemImage: "person.badge.minus", role: .destructive) { remove(p) } } }
                    }
                }
            }

            Section {
                Button("Reset Link", systemImage: "arrow.triangle.2.circlepath", action: reset).disabled(state.link == nil)
                Button("Stop Sharing", systemImage: "xmark.circle", role: .destructive, action: stop).disabled(state.link == nil)
            } footer: {
                Text("Reset Link makes a new link and a new key; the old link stops working. People already in the note stay.")
            }

            Section {
                Button("Share as Template…", systemImage: "square.on.square", action: template)
                    .accessibilityIdentifier("share.template")
            } footer: {
                Text("A public page anyone can start their own copy from. Your notes and data aren't included.")
            }

            if let problem = state.problem { Text(problem).foregroundStyle(.red) }
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
}

private struct PersonRow: View {
    let person: ShareState.Person

    var body: some View {
        HStack(spacing: 12) {
            PersonAvatar(name: person.name, color: person.isMe ? Color(PColor.paneAccent) : CollabSession.color(for: person.id), size: 32, typing: person.typing)
            VStack(alignment: .leading, spacing: 1) {
                Text(person.isMe ? "\(person.name) (you)" : person.name)
                Text(person.status).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(person.role == "owner" ? "Owner" : person.role == "editor" ? "Can edit" : "Can view")
                .font(.callout).foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A person's row, opened: who they are, verifying them, removing them.
private struct PersonDetail: View {
    let person: ShareState.Person
    let remove: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    PersonAvatar(name: person.name, color: CollabSession.color(for: person.id), size: 48)
                    VStack(alignment: .leading) {
                        Text(person.name).font(.headline)
                        Text(person.role == "owner" ? "Owner" : "Can edit").foregroundStyle(.secondary)
                    }
                }
            }
            if let code = person.safetyCode {
                Section {
                    Text(code).font(.title2.monospacedDigit()).frame(maxWidth: .infinity, alignment: .center).textSelection(.enabled)
                } header: {
                    Text("Verify \(person.name.split(separator: " ").first.map(String.init) ?? person.name)")
                } footer: {
                    Text("If \(person.name.split(separator: " ").first.map(String.init) ?? person.name) sees the same code on your row, nobody in between, us included, could have swapped the keys that lock this note. You don't need to do this; it's here if you want to be sure.")
                }
            }
            Section {
                Button("Remove from Note", role: .destructive) { remove(); dismiss() }
            } footer: {
                Text("They lose access to new changes. What they already saw stays with them. The note gets a new key and a new link.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle(person.name)
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
                      copy: copyLink,
                      remove: { p in Task { await run { try await store.remove(p.id, from: note) } } },
                      reset: { Task { await run { try await store.resetLink(note) } } },
                      stop: { Task { try? await store.stopSharing(note); dismiss() } },
                      template: { showTemplate = true },
                      done: { dismiss() })
            .navigationDestination(isPresented: $showTemplate) { TemplateForm(note: note, store: store) }
        }
        .task {
            await run { try await store.ensureLink(note) }
            // People come and go: keep the list current while the sheet is open.
            while !Task.isCancelled {
                state.people = store.people(in: note)
                if let auto = CollabDemo.pendingAccess { CollabDemo.pendingAccess = nil; try? await Task.sleep(for: .seconds(1.2)); await set(auto) }
                try? await Task.sleep(for: .seconds(0.5))
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 520)
        #endif
    }

    private func set(_ access: ShareState.Access) async {
        state.access = access
        await run { try await store.setAccess(access, for: note) }
    }

    private func run(_ work: () async throws -> Void) async {
        state.working = true
        defer { state.working = false }
        do {
            try await work()
            state.problem = nil
        } catch {
            state.problem = (error as? LocalizedError)?.errorDescription ?? "Couldn't share. Try again."
        }
        state.link = store.linkURL(note)
        state.access = store.access(note)
        state.people = store.people(in: note)
        if let link = state.link { CollabDemo.wrote(state.access == .edit ? "edit-link" : "link", link) }
    }

    private func copyLink() {
        guard let url = state.link else { return }
        #if os(iOS)
        UIPasteboard.general.url = url
        #else
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(url.absoluteString, forType: .string)
        #endif
    }
}
