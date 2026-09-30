import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// After sign-in, before the notes: set the account's encryption password (the first device), or
/// type it (a device that doesn't have the key yet). Styled like the sign-in card.
struct EncryptionGateView: View {
    let crypto: AccountCrypto
    let backend: Backend
    @State private var password = ""
    @State private var confirm = ""
    @State private var recovery = ""
    @State private var wantsRecoveryKey = true
    @State private var usingRecoveryKey = false
    @State private var working = false
    @State private var error: String?
    /// The recovery key just made: shown once, before the notes.
    @State private var shownKey: String?
    @Environment(\.displayScale) private var displayScale

    private typealias Row = SignInView.Row

    var body: some View {
        #if os(macOS)
        card
            .padding(.horizontal, 36)
            .padding(.vertical, 48)
            .frame(width: 400)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(for: .window) { Backdrop() }
        #else
        ScrollView {
            card
                .padding(28)
                .frame(minWidth: 300, maxWidth: 400)
                .glassEffect(.regular, in: .rect(cornerRadius: 28))
                .padding(20)
                .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background { Backdrop() }
        #endif
    }

    @ViewBuilder private var card: some View {
        VStack(spacing: 22) {
            AppMark(size: 60)
            if let shownKey {
                recoveryKeyShown(shownKey)
            } else {
                switch crypto.phase {
                case .needsSetup: setUp
                case .needsPassword: unlock
                case .unreachable: unreachable
                default: ProgressView().controlSize(.regular).frame(height: 120)
                }
            }
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("e2ee.error")
            }
        }
        .animation(.snappy(duration: 0.2), value: error)
    }

    private func heading(_ title: String, _ message: String) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.title2.weight(.heavy))
                .tracking(-0.6)
                .foregroundStyle(Color.ink)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: First device

    private var setUp: some View {
        VStack(spacing: 18) {
            heading("Your notes are encrypted",
                    "Your notes, folders, files and their history are encrypted on your devices with a key only you can unlock. We store them, but we can't read them.")
            VStack(alignment: .leading, spacing: 10) {
                Text("When you connect an AI like ChatGPT or Claude, that connection gets its own copy of your key. While the AI reads or changes your notes, our server decrypts what it asked for, in memory, and doesn't keep it. A note you share is published as a readable copy until you stop sharing it.")
                    .font(.footnote)
                    .foregroundStyle(Color.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 10) {
                field { SecureField("Encryption password (8+ characters)", text: $password).textContentType(.newPassword) }
                    .accessibilityIdentifier("e2ee.password")
                field { SecureField("Type it again", text: $confirm).textContentType(.newPassword) }
                    .accessibilityIdentifier("e2ee.confirm")
                Text("You'll type it on each new device. If you forget it, your notes can't be recovered, by you or by us.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Toggle("Also make a recovery key", isOn: $wantsRecoveryKey)
                    .font(.subheadline)
                    .accessibilityIdentifier("e2ee.recoveryToggle")
                mainButton("Encrypt My Notes", enabled: password.count >= 8 && !confirm.isEmpty) {
                    shownKey = try await crypto.setUp(password: password, confirm: confirm, recovery: wantsRecoveryKey)
                    password = ""
                    confirm = ""
                }
            }
        }
    }

    private func recoveryKeyShown(_ key: String) -> some View {
        VStack(spacing: 18) {
            heading("Save your recovery key",
                    "If you forget your encryption password, this key is the only other way into your notes. We can't show it again or reset it for you.")
            Text(key)
                .font(.system(.title3, design: .monospaced).weight(.semibold))
                .textSelection(.enabled)
                .multilineTextAlignment(.center)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(Color(Palette.field), in: .rect(cornerRadius: Row.radius, style: .continuous))
                .accessibilityIdentifier("e2ee.recoveryKey")
            Button("Copy Recovery Key", systemImage: "doc.on.doc") { copyToPasteboard(key) }
                .accessibilityIdentifier("e2ee.copyRecovery")
            Text("Keep it somewhere safe that isn't this device, like a password manager or on paper.")
                .font(.footnote)
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
            mainButton("I Saved It", enabled: true) { shownKey = nil }
        }
    }

    // MARK: Another device

    private var unlock: some View {
        VStack(spacing: 18) {
            heading(usingRecoveryKey ? "Enter your recovery key" : "Enter your encryption password",
                    usingRecoveryKey ? "The 28 characters you saved when you set up encryption."
                                     : "Your notes are encrypted. Type the encryption password you chose on your other device.")
            VStack(spacing: 10) {
                if usingRecoveryKey {
                    field { TextField("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", text: $recovery).autocorrectionDisabled() }
                        .accessibilityIdentifier("e2ee.recovery")
                    mainButton("Unlock Notes", enabled: E2EE.normalizeRecoveryKey(recovery).count == 28) {
                        try await crypto.unlock(recoveryKey: recovery)
                    }
                } else {
                    field { SecureField("Encryption password", text: $password).textContentType(.password) }
                        .accessibilityIdentifier("e2ee.password")
                    mainButton("Unlock Notes", enabled: !password.isEmpty) {
                        try await crypto.unlock(password: password)
                        password = ""
                    }
                }
                if crypto.keys?.recovery_wrap != nil || usingRecoveryKey {
                    Button(usingRecoveryKey ? "Use Encryption Password" : "Use Recovery Key Instead") {
                        usingRecoveryKey.toggle()
                        error = nil
                    }
                    .buttonStyle(.plain)
                    .font(.subheadline)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityIdentifier("e2ee.switch")
                }
                Button("Sign Out") { Task { await backend.signOut() } }
                    .buttonStyle(.plain)
                    .font(.footnote)
                    .foregroundStyle(Color.muted)
            }
        }
    }

    private var unreachable: some View {
        VStack(spacing: 18) {
            heading("Can't reach Amber Notes", "Your notes are encrypted, and this device needs to check your key once. Connect to the internet and try again.")
            mainButton("Try Again", enabled: true) {
                await crypto.attach(account: backend.userID, remote: backend.client.map { SupabaseAccountKeys(client: $0) })
            }
        }
    }

    // MARK: Pieces

    private func field(@ViewBuilder _ content: () -> some View) -> some View {
        let shape = RoundedRectangle(cornerRadius: Row.radius, style: .continuous)
        return content()
            .font(.system(size: Row.text))
            .padding(.horizontal, 12)
            .frame(height: Row.height)
            .background(Color(Palette.field), in: shape)
            .overlay(shape.strokeBorder(Color(Palette.fieldHairline), lineWidth: 1 / displayScale))
    }

    private func mainButton(_ title: String, enabled: Bool, action: @escaping () async throws -> Void) -> some View {
        let on = enabled && !working
        return Button {
            working = true
            error = nil
            Task {
                do { try await action() } catch { self.error = error.localizedDescription }
                working = false
            }
        } label: {
            ZStack {
                Text(title).opacity(working ? 0 : 1)
                if working { ProgressView().controlSize(.small).tint(Color(Palette.onAmber)) }
            }
            .font(.system(size: Row.text, weight: .semibold))
            .foregroundStyle(on || working ? Color(Palette.onAmber) : Color.muted)
            .frame(maxWidth: .infinity, minHeight: Row.height, maxHeight: Row.height)
            .background(on || working ? Color.accentColor : Color(Palette.quietButton), in: .rect(cornerRadius: Row.radius, style: .continuous))
            .contentShape(.rect(cornerRadius: Row.radius, style: .continuous))
        }
        .buttonStyle(PressScale())
        .disabled(!on)
        .keyboardShortcut(.defaultAction)
        .accessibilityLabel(working ? "\(title), working" : title)
        .accessibilityIdentifier("e2ee.submit")
    }
}

func copyToPasteboard(_ text: String) {
    #if os(iOS)
    UIPasteboard.general.string = text
    #else
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #endif
}

// MARK: Settings

/// Settings › Encryption: change the encryption password, or make a new recovery key.
struct EncryptionSection: View {
    let crypto: AccountCrypto
    @State private var changing = false
    @State private var old = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var working = false
    @State private var message: String?
    @State private var newKey: String?
    @State private var confirmNewKey = false

    var body: some View {
        Section {
            LabeledContent("End-to-end encryption", value: "On")
            Button("Change Encryption Password…") { changing = true }
                .accessibilityIdentifier("settings.e2eePassword")
            Button("Make a New Recovery Key…") { confirmNewKey = true }
                .accessibilityIdentifier("settings.e2eeRecovery")
            if let message { Text(message).font(.footnote).foregroundStyle(.secondary) }
        } header: {
            Text("Encryption")
        } footer: {
            Text("Your notes, folders, files and versions are encrypted with a key only your devices and the AI connections you approve can open. If you forget your encryption password and have no recovery key, your notes can't be recovered.")
        }
        .sheet(isPresented: $changing) { changeSheet }
        .confirmationDialog("Make a new recovery key?", isPresented: $confirmNewKey, titleVisibility: .visible) {
            Button("Make New Key") { Task { await makeKey() } }
        } message: {
            Text("Your old recovery key will stop working.")
        }
        .alert("Your new recovery key", isPresented: Binding(get: { newKey != nil }, set: { if !$0 { newKey = nil } })) {
            Button("Copy and Close") { if let newKey { copyToPasteboard(newKey) }; newKey = nil }
            Button("Close", role: .cancel) { newKey = nil }
        } message: {
            Text((newKey ?? "") + "\n\nSave it somewhere safe. It isn't shown again.")
        }
    }

    private var changeSheet: some View {
        NavigationStack {
            Form {
                SecureField("Current password", text: $old)
                SecureField("New password (8+ characters)", text: $new)
                SecureField("Type the new one again", text: $confirm)
                if let message { Text(message).foregroundStyle(.red) }
            }
            .formStyle(.grouped)
            .navigationTitle("Change Encryption Password")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { reset() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Changing…" : "Change") { Task { await change() } }
                        .disabled(working || old.isEmpty || new.count < 8)
                }
            }
        }
        #if os(macOS)
        .frame(width: 420, height: 280)
        #endif
    }

    private func reset() {
        changing = false
        old = ""; new = ""; confirm = ""
    }

    private func change() async {
        working = true
        defer { working = false }
        do {
            try await crypto.changePassword(old: old, new: new, confirm: confirm)
            reset()
            message = "Encryption password changed."
        } catch {
            message = error.localizedDescription
        }
    }

    private func makeKey() async {
        do { newKey = try await crypto.newRecoveryKey() } catch { message = error.localizedDescription }
    }
}

// MARK: While moving to encryption, and after

/// "Encrypting your notes…" at the bottom of the window while the first encryption runs.
struct EncryptionProgressBanner: ViewModifier {
    let migration: E2EEMigration

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let progress = migration.progress {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(progress).font(.footnote.weight(.medium))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .glassEffect(.regular, in: .capsule)
                .padding(.bottom, 16)
                .transition(.opacity)
                .accessibilityIdentifier("e2ee.progress")
            }
        }
        .animation(.easeOut(duration: 0.2), value: migration.progress)
    }
}
