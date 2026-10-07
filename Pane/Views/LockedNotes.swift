import SwiftData
import SwiftUI

/// A locked note while it's locked, in place of the editor: the lock, and the ways in (like Notes).
struct LockedNoteView: View {
    let note: Note
    @State private var password = ""
    @State private var problem: String?
    @State private var wrongTries = 0
    @State private var working = false
    @FocusState private var focused: Bool
    private var vault: NoteVault { .shared }

    /// Sealed with a password from before it was changed on another device.
    private var earlier: Bool { vault.needsEarlierPassword(note) }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(Color.muted)
                .padding(.bottom, 4)
            // The title stays in the clear, in the note's own display type.
            Text(note.title)
                .font(.display(28))
                .tracking(Palette.tracking(28))
                .foregroundStyle(Color.ink)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text("This note is locked.")
                .font(.headline)
                .foregroundStyle(Color.ink)
            Text(earlier ? "It was locked with an earlier notes password. Enter that password to view it."
                         : "Enter the notes password to view this note.")
                .font(.callout)
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
            SecureField("Password", text: $password)
                .textContentType(.password)
                .focused($focused)
                .onSubmit(submit)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 260)
                .padding(.top, 6)
                .accessibilityIdentifier("lock.password")
            if let problem {
                Text(problem)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            if wrongTries > 0, !earlier, let hint = vault.settings?.hint {
                Text("Hint: \(hint)")
                    .font(.callout)
                    .foregroundStyle(Color.muted)
                    .accessibilityIdentifier("lock.hint")
            }
            Button(action: submit) {
                if working { ProgressView().controlSize(.small) } else { Text("View Note") }
            }
            .buttonStyle(.glassProminent)
            .disabled(password.isEmpty || working)
            .accessibilityIdentifier("lock.view")
            if !earlier, let name = vault.biometryName {
                Button("Use \(name)") { Task { await biometrics() } }
                    .buttonStyle(.hoverText)
                    .foregroundStyle(.tint)
                    .accessibilityIdentifier("lock.biometrics")
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: note.id) {
            // A password set (or changed) on another device.
            await vault.refresh()
            if !earlier, !(await biometrics()) { focused = true }
        }
    }

    @discardableResult
    private func biometrics() async -> Bool {
        guard vault.biometryName != nil, !vault.isUnlocked else { return false }
        return await vault.unlockWithBiometrics(reason: "Unlock your locked notes")
    }

    private func submit() {
        guard !password.isEmpty, !working else { return }
        working = true
        let typed = password
        Task { @MainActor in
            defer { working = false }
            do {
                if earlier { try await vault.openEarlier(note, password: typed) } else { try await vault.unlock(password: typed) }
                password = ""
                problem = nil
            } catch {
                wrongTries += 1
                password = ""
                problem = (error as? LocalizedError)?.errorDescription ?? "That password is incorrect."
                focused = true
            }
        }
    }
}

/// The first time a note is locked: one notes password (with a hint) for every locked note.
struct NotesPasswordSetupSheet: View {
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var verify = ""
    @State private var hint = ""
    @State private var useBiometrics = NoteVault.shared.usesBiometrics
    @State private var working = false
    @State private var problem: String?
    private var vault: NoteVault { .shared }

    private var ready: Bool { !password.isEmpty && password == verify && !working }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Password", text: $password)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("setup.password")
                    SecureField("Verify", text: $verify)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("setup.verify")
                    TextField("Hint (recommended)", text: $hint)
                        .accessibilityIdentifier("setup.hint")
                } header: {
                    Text("Create a password for your locked notes")
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("One password locks all your notes, on all your devices. A locked note is encrypted on your device before it syncs, so nobody else can read it: not us, and not an AI you've connected. Its title stays visible so you can find it.")
                        Text("If you forget this password, your locked notes can't be recovered, not even by us.")
                            .fontWeight(.semibold)
                        Text("Locking a note also removes its earlier versions from version history.")
                    }
                    .foregroundStyle(Color.muted)
                }
                if let name = NoteVault.shared.keyStore.biometryName {
                    Section { Toggle("Use \(name)", isOn: $useBiometrics) }
                }
                if password != verify, !verify.isEmpty {
                    Section { Text("The passwords don't match.").foregroundStyle(.red) }
                } else if let problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Set Password")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working { ProgressView().controlSize(.small) } else {
                        Button("Done", action: done).disabled(!ready).accessibilityIdentifier("setup.done")
                    }
                }
            }
        }
        #if os(macOS)
        .frame(width: 440, height: 420)
        #endif
    }

    private func done() {
        guard ready else { return }
        working = true
        Task { @MainActor in
            defer { working = false }
            do {
                vault.usesBiometrics = useBiometrics
                try await vault.setUp(password: password, hint: hint)
                dismiss()
                onDone()
            } catch {
                problem = (error as? LocalizedError)?.errorDescription ?? "Couldn't set the password. Try again."
            }
        }
    }
}

/// Asks for the notes password before something that needs it (locking a note, for one).
struct NotesPasswordPrompt: View {
    let message: String
    let onUnlocked: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var problem: String?
    @State private var wrongTries = 0
    @State private var working = false
    private var vault: NoteVault { .shared }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .onSubmit(submit)
                        .accessibilityIdentifier("prompt.password")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(message)
                        if wrongTries > 0, let hint = vault.settings?.hint { Text("Hint: \(hint)") }
                    }
                    .foregroundStyle(Color.muted)
                }
                if let problem { Section { Text(problem).foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            .navigationTitle("Enter Password")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working { ProgressView().controlSize(.small) } else {
                        Button("OK", action: submit).disabled(password.isEmpty).accessibilityIdentifier("prompt.ok")
                    }
                }
            }
        }
        #if os(macOS)
        .frame(width: 400, height: 240)
        #endif
        .task {
            await vault.refresh()
            if await vault.unlockWithBiometrics(reason: message) { finish() }
        }
    }

    private func submit() {
        guard !password.isEmpty, !working else { return }
        working = true
        let typed = password
        Task { @MainActor in
            defer { working = false }
            do {
                try await vault.unlock(password: typed)
                finish()
            } catch {
                wrongTries += 1
                password = ""
                problem = (error as? LocalizedError)?.errorDescription ?? "That password is incorrect."
            }
        }
    }

    private func finish() {
        dismiss()
        onUnlocked()
    }
}

/// Settings › Locked Notes › Change Password: every locked note is encrypted again.
struct ChangeNotesPasswordSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    let sync: SyncEngine?
    @State private var old = ""
    @State private var new = ""
    @State private var verify = ""
    @State private var hint = ""
    @State private var working = false
    @State private var problem: String?
    private var vault: NoteVault { .shared }

    private var ready: Bool { !old.isEmpty && !new.isEmpty && new == verify && !working }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Old Password", text: $old).textContentType(.password)
                } footer: {
                    if let hint = vault.settings?.hint { Text("Hint: \(hint)").foregroundStyle(Color.muted) }
                }
                Section {
                    SecureField("New Password", text: $new).textContentType(.newPassword)
                    SecureField("Verify", text: $verify).textContentType(.newPassword)
                    TextField("Hint (recommended)", text: $hint)
                } footer: {
                    Text("Your locked notes are encrypted again with the new password, on all your devices, and their earlier versions are removed from version history. If you forget it, they can't be recovered, not even by us.")
                        .foregroundStyle(Color.muted)
                }
                if new != verify, !verify.isEmpty {
                    Section { Text("The new passwords don't match.").foregroundStyle(.red) }
                } else if let problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Change Password")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working { ProgressView().controlSize(.small) } else {
                        Button("Done", action: done).disabled(!ready)
                    }
                }
            }
        }
        #if os(macOS)
        .frame(width: 440, height: 400)
        #endif
    }

    private func done() {
        guard ready else { return }
        working = true
        Task { @MainActor in
            defer { working = false }
            do {
                // The latest of every note first: the change fails if one moved on meanwhile.
                await sync?.sync()
                try await vault.changePassword(old: old, new: new, hint: hint, in: context)
                dismiss()
            } catch {
                problem = (error as? LocalizedError)?.errorDescription ?? "Couldn't change the password. Try again."
            }
        }
    }
}

/// Settings: the notes password, once there is one.
struct LockedNotesSection: View {
    let sync: SyncEngine?
    @State private var changing = false
    private var vault: NoteVault { .shared }

    var body: some View {
        if vault.isSetUp {
            Section {
                Button("Change Password…") { changing = true }
                    .accessibilityIdentifier("settings.changeNotesPassword")
                if let name = vault.keyStore.biometryName {
                    Toggle("Use \(name)", isOn: Binding(get: { vault.usesBiometrics }, set: { vault.usesBiometrics = $0 }))
                }
                if vault.isUnlocked {
                    Button("Lock Now") { vault.lockNow() }
                }
            } header: {
                Text("Locked Notes")
            } footer: {
                Text("Locked notes open with your notes password until the app goes to the background or a few minutes pass. If you forget the password, locked notes can't be recovered.")
                    .foregroundStyle(Color.muted)
            }
            .sheet(isPresented: $changing) { ChangeNotesPasswordSheet(sync: sync) }
        }
    }
}
