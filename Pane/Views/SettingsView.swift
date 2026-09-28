import Supabase
import SwiftUI

/// Account, sync status and AI access tokens.
struct SettingsView: View {
    let backend: Backend
    let sync: SyncEngine?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    if case .signedIn(let email) = backend.state {
                        LabeledContent("Signed in as", value: email)
                        LabeledContent("Sync") { SyncStatusLabel(status: sync?.status ?? .idle) }
                        Button("Sync now") { Task { await sync?.sync() } }
                        ChangePasswordRow(backend: backend)
                        Button("Sign out", role: .destructive) { Task { await backend.signOut(); dismiss() } }
                    } else {
                        Text("Sync is off. This build keeps notes on this device only.")
                            .foregroundStyle(.secondary)
                    }
                }
                if case .signedIn = backend.state, let client = backend.client {
                    AIAccessSection(client: client)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(width: 560, height: 640)
        #endif
    }
}

/// Change the account password in place.
private struct ChangePasswordRow: View {
    let backend: Backend
    @State private var open = false
    @State private var password = ""
    @State private var confirm = ""
    @State private var state: String?

    var body: some View {
        DisclosureGroup("Change password", isExpanded: $open) {
            SecureField("New password (12+ characters)", text: $password)
                .textContentType(.newPassword)
            SecureField("Type it again", text: $confirm)
                .textContentType(.newPassword)
            HStack {
                if let state { Text(state).font(.footnote).foregroundStyle(state == "Password changed" ? Color.green : Color.red) }
                Spacer()
                Button("Save password") {
                    Task {
                        do {
                            try await backend.changePassword(to: password)
                            state = "Password changed"
                            password = ""; confirm = ""
                        } catch {
                            state = Backend.message(for: error, signingUp: true)
                        }
                    }
                }
                .disabled(password.count < 12 || password != confirm)
            }
        }
    }
}

struct SyncStatusLabel: View {
    let status: SyncEngine.Status
    var body: some View {
        switch status {
        case .idle: Text("Waiting").foregroundStyle(.secondary)
        case .syncing: HStack(spacing: 6) { ProgressView().controlSize(.mini); Text("Syncing…") }
        case .synced(let d): Text("Up to date · \(d.formatted(date: .omitted, time: .shortened))").foregroundStyle(.secondary)
        case .offline(let why): Text(why).foregroundStyle(.orange)
        }
    }
}

private struct TokenRow: Decodable, Identifiable {
    let id: UUID
    let name: String
    let can_write: Bool
    let created_at: Date
    let last_used_at: Date?
    let revoked_at: Date?
}

/// Tokens let Claude, ChatGPT, Claude Code and Codex use your notes through MCP.
private struct AIAccessSection: View {
    let client: SupabaseClient
    @State private var tokens: [TokenRow] = []
    @State private var newName = "Claude"
    @State private var writeAccess = true
    @State private var created: (name: String, token: String)?
    @State private var error: String?

    var body: some View {
        Section {
            ForEach(tokens.filter { $0.revoked_at == nil }) { t in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.name)
                        Text(t.last_used_at.map { "Last used \($0.formatted(.relative(presentation: .named)))" } ?? "Never used")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(t.can_write ? "Read & write" : "Read only").font(.caption).foregroundStyle(.secondary)
                    Button("Revoke", role: .destructive) { Task { await revoke(t) } }
                        .buttonStyle(.borderless)
                }
            }
            HStack {
                TextField("Name, e.g. ChatGPT", text: $newName)
                Toggle("Can edit", isOn: $writeAccess)
                    .fixedSize()
                Button("Create token") { Task { await create() } }
                    .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
        } header: {
            Text("AI access")
        } footer: {
            Text("Each connected AI gets its own token. Revoking one cuts it off at once. Every change an AI makes keeps the previous version, so it can be undone.")
        }
        .task { await load() }
        .sheet(isPresented: Binding(get: { created != nil }, set: { if !$0 { created = nil } })) {
            if let created { ConnectInstructions(name: created.name, token: created.token) }
        }
    }

    private func load() async {
        tokens = (try? await client.from("mcp_tokens").select().order("created_at", ascending: false).execute().value) ?? []
    }

    private func create() async {
        do {
            let token: String = try await client.rpc("create_mcp_token", params: ["token_name": AnyJSON.string(newName), "write_access": AnyJSON.bool(writeAccess)]).execute().value
            created = (newName, token)
            await load()
        } catch {
            self.error = "Couldn't create a token. Check your connection."
        }
    }

    private func revoke(_ t: TokenRow) async {
        _ = try? await client.from("mcp_tokens").update(["revoked_at": AnyJSON.string(Date.now.ISO8601Format())]).eq("id", value: t.id).execute()
        await load()
    }
}

/// Shown once after creating a token: how to connect each client.
struct ConnectInstructions: View {
    let name: String
    let token: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied: String?

    private var server: String { BackendConfig.mcpURL?.absoluteString ?? "" }
    private var secretURL: String { server + "/" + token }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Copy what you need now. The token isn't shown again.")
                        .foregroundStyle(.secondary)
                }
                block("Claude and ChatGPT (connector URL)", secretURL,
                      note: "Claude: Settings → Connectors → Add custom connector, paste the URL. ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode, then Create, paste the URL, no authentication. The URL contains the token, so keep it private.")
                block("Claude Code", "claude mcp add --transport http amber-notes \(server) --header \"Authorization: Bearer \(token)\"",
                      note: "Run in a terminal. Add --scope user to use it in every project.")
                block("Codex", "[mcp_servers.amber_notes]\nurl = \"\(server)\"\nhttp_headers = { \"Authorization\" = \"Bearer \(token)\" }",
                      note: "Add to ~/.codex/config.toml.")
            }
            .formStyle(.grouped)
            .navigationTitle("Connect \(name)")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        #if os(macOS)
        .frame(width: 600, height: 620)
        #endif
    }

    private func block(_ title: String, _ value: String, note: String) -> some View {
        Section(title) {
            Text(value)
                .font(.system(.footnote, design: .monospaced))
                .textSelection(.enabled)
                .lineLimit(6)
            Button(copied == title ? "Copied" : "Copy", systemImage: copied == title ? "checkmark" : "doc.on.doc") {
                #if os(iOS)
                UIPasteboard.general.string = value
                #else
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(value, forType: .string)
                #endif
                withAnimation(.snappy) { copied = title }
            }
            Text(note).font(.caption).foregroundStyle(.secondary)
        }
    }
}
