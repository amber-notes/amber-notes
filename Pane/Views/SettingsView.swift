import Supabase
import SwiftUI

/// Account, sync status, and the AIs connected to your notes.
struct SettingsView: View {
    let backend: Backend
    let sync: SyncEngine?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        #if os(macOS)
        // A Mac Settings window: no navigation bar, no Done button.
        form
            .frame(width: 520)
            .frame(minHeight: 560)
        #else
        NavigationStack {
            form
                .navigationTitle("Settings")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        #endif
    }

    private var form: some View {
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
                    ConnectAISection(client: client)
                }
            }
            .formStyle(.grouped)
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
