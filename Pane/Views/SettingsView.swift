import PhotosUI
import Supabase
import SwiftUI
import UniformTypeIdentifiers

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
                if case .signedIn(let email) = backend.state {
                    // You first, like the Apple Account at the top of System Settings.
                    ProfileSection(backend: backend, email: backend.displayEmail ?? email)
                }
                Section("Account") {
                    if case .signedIn = backend.state {
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
                #else
                if case .signedIn = backend.state {
                    // On the Mac this is Help › Show Setup Guide.
                    Section {
                        Button("Show Setup Guide") {
                            NotificationCenter.default.post(name: .paneShowSetupGuide, object: nil)
                            dismiss()
                        }
                        .accessibilityIdentifier("settings.setupGuide")
                    } footer: {
                        Text("Shows the Get set up steps at the top of your notes again.")
                    }
                }
                #endif
                if case .signedIn = backend.state {
                    // Signing out sits apart, last, as in System Settings.
                    Section {
                        Button(role: .destructive) { confirmSignOut = true } label: { Text("Sign Out…").foregroundStyle(.red) }
                            .accessibilityIdentifier("settings.signOut")
                        DeleteAccountButton(backend: backend)
                    } footer: {
                        LegalLinksRow()
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

/// Your photo, name and email, and the controls to change the first two.
private struct ProfileSection: View {
    let backend: Backend
    let email: String
    @State private var profile = ProfileStore.shared
    @State private var draft = ""
    @FocusState private var editing: Bool
    @State private var importing = false
    #if os(iOS)
    @State private var picked: PhotosPickerItem?
    #endif

    var body: some View {
        Section {
            HStack(spacing: 16) {
                AvatarView(photo: profile.photo, name: profile.name ?? email, size: 64)
                    #if os(macOS)
                    .dropDestination(for: URL.self) { urls, _ in
                        guard let url = urls.first, let data = try? Data(contentsOf: url) else { return false }
                        Task { await profile.setPhoto(data) }
                        return true
                    }
                    #endif
                VStack(alignment: .leading, spacing: 2) {
                    TextField("Name", text: $draft, prompt: Text("Your Name"))
                        .labelsHidden()
                        .textFieldStyle(.plain)
                        .multilineTextAlignment(.leading)
                        .font(.title3.weight(.semibold))
                        .focused($editing)
                        .onSubmit(commit)
                        .accessibilityLabel("Name")
                        .accessibilityIdentifier("settings.profileName")
                    Text(email)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
            .padding(.vertical, 4)
            HStack(spacing: 10) {
                #if os(iOS)
                PhotosPicker(profile.photo == nil ? "Choose Photo…" : "Change Photo…", selection: $picked, matching: .images)
                    .accessibilityIdentifier("settings.choosePhoto")
                #else
                Button(profile.photo == nil ? "Choose Photo…" : "Change Photo…") { importing = true }
                    .accessibilityIdentifier("settings.choosePhoto")
                #endif
                if profile.photo != nil {
                    Button("Remove Photo", role: .destructive) { Task { await profile.removePhoto() } }
                        .accessibilityIdentifier("settings.removePhoto")
                }
                if profile.working { ProgressView().controlSize(.small) }
            }
            if let problem = profile.problem {
                Text(problem).font(.footnote).foregroundStyle(.secondary)
            }
        } footer: {
            Text("Shown in the app and on notes you share.")
        }
        .onAppear { draft = profile.name ?? "" }
        .onChange(of: profile.name) { _, new in if !editing { draft = new ?? "" } }
        .onChange(of: editing) { _, now in if !now { commit() } }
        .onChange(of: draft) { _, new in if new.count > ProfileName.maxLength { draft = String(new.prefix(ProfileName.maxLength)) } }
        .task(id: backend.state) { await profile.bind(backend) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .heic, .image]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            Task { await profile.setPhoto(data) }
        }
        #if os(iOS)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { await profile.setPhoto(data) }
                picked = nil
            }
        }
        #endif
    }

    private func commit() {
        Task { await profile.setName(draft) }
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
                AppleAuthButton(label: .continue, height: 30, title: "Continue with Apple", web: webLink) { result in
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

    /// The Mac download links your Apple ID on the web (see AppleAuthButton.web).
    private var webLink: (@MainActor () -> Void)? {
        #if DIRECT
        return {
            working = true
            error = nil
            Task {
                do { try await backend.linkAppleOnTheWeb() } catch where !Backend.isCanceled(error) {
                    self.error = Backend.appleMessage(for: error, linking: true)
                } catch {}
                working = false
            }
        }
        #else
        return nil
        #endif
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
