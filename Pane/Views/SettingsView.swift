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
                        LabeledContent("Signed in as", value: backend.displayEmail ?? email)
                        LabeledContent("Sync") { SyncStatusLabel(status: sync?.status ?? .idle) }
                        Button("Sync now") { Task { await sync?.sync() } }
                        AppleIDRow(backend: backend)
                        Button("Sign out", role: .destructive) { Task { await backend.signOut(); dismiss() } }
                        DeleteAccountButton(backend: backend)
                    } else {
                        Text("Sync is off. This build keeps notes on this device only.")
                            .foregroundStyle(.secondary)
                    }
                }
                if case .signedIn = backend.state, let client = backend.client {
                    ConnectAISection(client: client)
                }
                #if os(macOS)
                MenuBarSection()
                #endif
            }
            .formStyle(.grouped)
    }
}

/// Sign in with Apple for this account: connect it once, then Apple is how you sign in.
private struct AppleIDRow: View {
    let backend: Backend
    @State private var working = false
    @State private var error: String?

    var body: some View {
        if let apple = backend.apple {
            LabeledContent("Sign in with Apple") {
                Label(apple.email ?? "Connected", systemImage: "checkmark.circle.fill")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("settings.appleConnected")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Connect your Apple ID")
                Text("Then you sign in with Apple on every device, without a password.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                AppleAuthButton(label: .continue, height: 36) { result in
                    switch result {
                    case .success(let credential): link(credential)
                    case .failure(let failure): error = AppleSignIn.message(for: failure)
                    }
                }
                .frame(maxWidth: 260)
                .disabled(working)
                .accessibilityIdentifier("settings.connectApple")
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func link(_ credential: AppleSignIn.Credential) {
        working = true
        error = nil
        Task {
            do { try await backend.linkApple(credential) } catch { self.error = Backend.appleMessage(for: error, linking: true) }
            working = false
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

#if os(macOS)
/// Amber Notes in the menu bar, on by default.
private struct MenuBarSection: View {
    @AppStorage(MenuBarSettings.key) private var show = true

    var body: some View {
        Section {
            Toggle("Show in menu bar", isOn: $show)
                .accessibilityIdentifier("settings.menuBar")
        } header: {
            Text("Menu Bar")
        } footer: {
            Text("Capture a note or find one from the menu bar, even with the window closed.")
                .foregroundStyle(.secondary)
        }
    }
}
#endif
