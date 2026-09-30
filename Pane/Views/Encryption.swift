import SwiftUI

/// After sign-in, before the notes, while this device doesn't have the account's key: waiting for
/// iCloud Keychain, the recovery key, and (last) starting fresh. Then, once per account on each
/// device, "Your notes are encrypted". Styled like the sign-in card.
struct KeyGateView: View {
    let crypto: AccountCrypto
    let backend: Backend
    /// What you chose to do instead of waiting.
    @State private var screen: Screen = .auto
    @State private var recovery = ""
    @State private var confirmation = ""
    @State private var working = false
    @State private var error: String?
    /// Starting fresh was refused: it needs a sign-in from the last few minutes.
    @State private var needsSignIn = false
    @State private var password = ""
    @FocusState private var focused: Bool
    @Environment(\.displayScale) private var displayScale

    enum Screen { case auto, recovery, startFresh }

    private typealias Row = SignInView.Row
    private typealias Copy = KeyCopy

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
            content
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
        .onChange(of: crypto.phase) { _, _ in
            // The key arrived (or the account changed) while you were on another screen.
            if crypto.phase == .ready { screen = .auto }
            error = nil
        }
    }

    @ViewBuilder private var content: some View {
        switch (crypto.phase, screen) {
        case (.ready, _): welcome
        case (.waiting, .startFresh), (.mismatch, .startFresh): startFresh
        case (.waiting, .recovery), (.mismatch, _): recoveryEntry
        case (.waiting, _): waiting
        case (.unreachable, _): unreachable
        default: ProgressView().controlSize(.regular).frame(height: 120)
        }
    }

    private func heading(_ title: String, _ message: String?) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.title2.weight(.heavy))
                .tracking(-0.6)
                .foregroundStyle(Color.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let message {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Color.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: Screens

    private var welcome: some View {
        VStack(spacing: 18) {
            heading(Copy.welcomeTitle, Copy.welcomeMessage)
            mainButton("Continue", id: "e2ee.continue", enabled: true) { crypto.welcomeShown() }
        }
    }

    private var waiting: some View {
        VStack(spacing: 18) {
            heading(Copy.waitingTitle, nil)
            ProgressView().controlSize(.regular)
            if crypto.showsKeychainHelp {
                VStack(spacing: 14) {
                    Text(Copy.keychainHelp)
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    mainButton("Use recovery key", id: "e2ee.useRecovery", enabled: true) { screen = .recovery }
                    Text(Copy.recoveryHint)
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .transition(.opacity)
            }
            signOut
        }
        .animation(.easeOut(duration: 0.25), value: crypto.showsKeychainHelp)
    }

    private var recoveryEntry: some View {
        VStack(spacing: 18) {
            heading("Enter your recovery key", crypto.phase == .mismatch ? Copy.mismatch : nil)
            VStack(spacing: 10) {
                field {
                    TextField("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX", text: $recovery)
                        .font(.system(size: Row.text, design: .monospaced))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
                        .focused($focused)
                        .onSubmit { if canSubmitRecovery { submitRecovery() } }
                }
                .accessibilityIdentifier("e2ee.recovery")
                Text(Copy.recoveryHint)
                    .font(.footnote)
                    .foregroundStyle(Color.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                mainButton("Unlock notes", id: "e2ee.submit", enabled: canSubmitRecovery) {
                    try await crypto.recover(typed: recovery)
                    recovery = ""
                }
            }
            VStack(spacing: 10) {
                if crypto.phase == .waiting {
                    quietButton("Keep waiting for iCloud Keychain", id: "e2ee.back") { screen = .auto }
                }
                quietButton("I don't have my key", id: "e2ee.noKey") { screen = .startFresh }
                signOut
            }
        }
        .onAppear { focused = true }
    }

    private var canSubmitRecovery: Bool { recovery.filter { $0.isLetter || $0.isNumber }.count >= 28 }

    private func submitRecovery() {
        run { try await crypto.recover(typed: recovery); recovery = "" }
    }

    private var startFresh: some View {
        VStack(spacing: 18) {
            heading("Start fresh?", nil)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Copy.startFreshMessage, id: \.self) { line in
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(Color.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            VStack(spacing: 10) {
                if needsSignIn {
                    signInAgain
                } else {
                    field {
                        TextField("Type \u{201C}\(AccountCrypto.startFreshPhrase)\u{201D} to confirm", text: $confirmation)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.never)
                            #endif
                    }
                    .accessibilityIdentifier("e2ee.confirmStartFresh")
                    mainButton("Start fresh", id: "e2ee.startFresh", enabled: confirmed, destructive: true) {
                        try await startFreshNow()
                    }
                }
                quietButton("Back", id: "e2ee.back") { screen = .recovery; confirmation = ""; needsSignIn = false; password = "" }
            }
        }
    }

    /// Starts fresh, or (when the server wants a recent sign-in) asks for one first.
    private func startFreshNow() async throws {
        do {
            try await crypto.startFresh(confirmation: confirmation)
        } catch KeyError.reauth {
            needsSignIn = true
            return
        }
        confirmation = ""
        needsSignIn = false
        screen = .auto
    }

    /// Deleting everything takes a fresh sign-in, the way this account signs in: Apple once an
    /// Apple ID is linked, otherwise its email and password. Then it starts fresh.
    @ViewBuilder private var signInAgain: some View {
        Text(Copy.signInAgain)
            .font(.subheadline)
            .foregroundStyle(Color.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("e2ee.signInAgain")
        if backend.apple != nil {
            AppleAuthButton(label: .signIn, height: Row.height, title: "Sign in with Apple", web: webSignIn) { result in
                switch result {
                case .success(let credential):
                    run {
                        try await backend.signInWithApple(credential)
                        try await startFreshNow()
                    }
                case .failure(.canceled): break
                case .failure(let failure): error = AppleSignIn.message(for: failure)
                }
            }
            .disabled(working)
            .opacity(working ? 0.6 : 1)
            .accessibilityIdentifier("e2ee.signInApple")
        } else {
            field {
                SecureField("Password for \(email)", text: $password)
                    .textContentType(.password)
                    .onSubmit { if !password.isEmpty { signInWithPassword() } }
            }
            .accessibilityIdentifier("e2ee.password")
            mainButton("Sign in and start fresh", id: "e2ee.signInStartFresh", enabled: !password.isEmpty, destructive: true) {
                try await signInAndStartFresh()
            }
        }
    }

    private var email: String {
        if case .signedIn(let email) = backend.state { return email }
        return ""
    }

    private func signInWithPassword() { run { try await signInAndStartFresh() } }

    private func signInAndStartFresh() async throws {
        do { try await backend.signIn(email: email, password: password) } catch {
            throw KeyGateFailure(message: Backend.message(for: error, signingUp: false))
        }
        password = ""
        try await startFreshNow()
    }

    private struct KeyGateFailure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// The Mac download signs in with Apple on the web, as on the sign-in screen.
    private var webSignIn: (@MainActor () -> Void)? {
        #if DIRECT
        return {
            run {
                do { try await backend.signInWithAppleOnTheWeb() } catch where Backend.isCanceled(error) { return }
                try await startFreshNow()
            }
        }
        #else
        return nil
        #endif
    }

    private var confirmed: Bool {
        confirmation.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == AccountCrypto.startFreshPhrase
    }

    private var unreachable: some View {
        VStack(spacing: 18) {
            heading("Can't reach Amber Notes", Copy.unreachable)
            mainButton("Try again", id: "e2ee.retry", enabled: true) { await crypto.restart() }
            signOut
        }
    }

    private var signOut: some View {
        quietButton("Sign out", id: "e2ee.signOut", muted: true) { Task { await backend.signOut() } }
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

    private func quietButton(_ title: String, id: String, muted: Bool = false, action: @escaping () -> Void) -> some View {
        Button(title) { error = nil; action() }
            .buttonStyle(.plain)
            .font(muted ? .footnote : .subheadline)
            .foregroundStyle(muted ? Color.muted : Color.accentColor)
            .frame(minHeight: 28)
            .contentShape(.rect)
            .accessibilityIdentifier(id)
    }

    private func run(_ action: @escaping () async throws -> Void) {
        working = true
        error = nil
        Task {
            do { try await action() } catch { self.error = error.localizedDescription }
            working = false
        }
    }

    private func mainButton(_ title: String, id: String, enabled: Bool, destructive: Bool = false,
                            action: @escaping () async throws -> Void) -> some View {
        let on = enabled && !working
        let fill = destructive ? Color.red : Color.accentColor
        return Button { run(action) } label: {
            ZStack {
                Text(title).opacity(working ? 0 : 1)
                if working { ProgressView().controlSize(.small).tint(destructive ? .white : Color(Palette.onAmber)) }
            }
            .font(.system(size: Row.text, weight: .semibold))
            .foregroundStyle(on || working ? (destructive ? Color.white : Color(Palette.onAmber)) : Color.muted)
            .frame(maxWidth: .infinity, minHeight: Row.height, maxHeight: Row.height)
            .background(on || working ? fill : Color(Palette.quietButton), in: .rect(cornerRadius: Row.radius, style: .continuous))
            .contentShape(.rect(cornerRadius: Row.radius, style: .continuous))
        }
        .buttonStyle(PressScale())
        .disabled(!on)
        .keyboardShortcut(destructive ? nil : .defaultAction)
        .accessibilityLabel(working ? "\(title), working" : title)
        .accessibilityIdentifier(id)
    }
}

/// The key screens' words, in one place.
enum KeyCopy {
    static let welcomeTitle = "Your notes are encrypted."
    static let welcomeMessage = "Only your devices, and AI connections you approve, can unlock your notes."
    static let waitingTitle = "Getting your key from iCloud Keychain…"
    #if os(macOS)
    static let keychainHelp = "Check that iCloud Keychain is on here and on your other device: System Settings › [your name] › iCloud › Passwords and Keychain."
    #else
    static let keychainHelp = "Check that iCloud Keychain is on here and on your other device: Settings › [your name] › iCloud › Passwords and Keychain."
    #endif
    static let recoveryHint = "Find it on your other device in Amber Notes › Settings › Privacy & Security."
    static let mismatch = "The key on this device isn't your account's current key."
    static let unreachable = "Connect to the internet. This device checks your key with Amber Notes before opening your notes."
    static let startFreshMessage = [
        "Without your recovery key or another device that has your key, the notes stored with Amber Notes can't be opened here, or by us. AI connections you approved can still open them until they're disconnected.",
        "Starting fresh deletes them from our server and disconnects every AI. This device gets a new key and a new recovery key, and your account starts empty.",
    ]
    static let signInAgain = "To delete your notes, sign in again first."

}
