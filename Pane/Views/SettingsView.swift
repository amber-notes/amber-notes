import Supabase
import SwiftUI

/// Account, sync status, and the AIs connected to your notes.
struct SettingsView: View {
    let backend: Backend
    let sync: SyncEngine?
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

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
                        // The status and its action on one row, like iCloud in System Settings.
                        LabeledContent("Sync") {
                            HStack(spacing: 10) {
                                SyncStatusLabel(status: sync?.status ?? .idle)
                                Button("Sync Now") { Task { await sync?.sync() } }
                                    .controlSize(.small)
                                    .accessibilityIdentifier("settings.syncNow")
                            }
                        }
                        AppleIDRow(backend: backend)
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
                if case .signedIn = backend.state {
                    // Signing out sits apart, last, as in System Settings.
                    Section {
                        Button("Sign Out…", role: .destructive) { confirmSignOut = true }
                            .accessibilityIdentifier("settings.signOut")
                    }
                }
            }
            .formStyle(.grouped)
            .confirmationDialog("Sign out of Amber Notes?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { Task { await backend.signOut(); dismiss() } }
            } message: {
                Text("Your notes stay in your account and come back when you sign in again.")
            }
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
            // A settings row: what it is on the left, the standard Apple button on the right.
            LabeledContent {
                AppleAuthButton(label: .continue, height: 30) { result in
                    switch result {
                    case .success(let credential): link(credential)
                    case .failure(let failure): error = AppleSignIn.message(for: failure)
                    }
                }
                .frame(width: 190)
                .disabled(working)
                .accessibilityIdentifier("settings.connectApple")
            } label: {
                Text("Sign in with Apple")
                Text(error ?? "Sign in on every device without a password.")
                    .foregroundStyle(error == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
            }
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
