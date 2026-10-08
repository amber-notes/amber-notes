import SwiftUI

/// After sign-in, before the notes, while this device doesn't have the account's key: a code for
/// a device that has it to scan (Add a device), with the recovery key and iCloud Keychain as the
/// other ways, and (last) starting fresh. Then, once per account on each device, "Your notes are
/// encrypted". Styled like the sign-in card.
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
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// What you chose: `auto` is the code another device scans while the key isn't here;
    /// `noDevice` lists the other ways, `keychain` is waiting for iCloud Keychain.
    enum Screen { case auto, noDevice, keychain, recovery, startFresh }

    enum Shown: Equatable { case welcome, addDevice, noDevice, waiting, recovery, startFresh, unreachable, checking }

    /// The screen for where startup is and what you chose. Without the key here, the code for
    /// another device comes first, and iCloud Keychain keeps being checked behind it: nobody sits
    /// on a spinner, and nobody is asked for a recovery key they may never have saved.
    static func shown(_ phase: AccountCrypto.Phase, _ screen: Screen) -> Shown {
        switch (phase, screen) {
        case (.ready, _): .welcome
        case (.waiting, .startFresh), (.mismatch, .startFresh): .startFresh
        case (.waiting, .recovery), (.mismatch, .recovery): .recovery
        case (.waiting, .noDevice), (.mismatch, .noDevice): .noDevice
        case (.waiting, .keychain): .waiting
        case (.waiting, _), (.mismatch, _): .addDevice
        case (.unreachable, _): .unreachable
        default: .checking
        }
    }

    /// The code this device shows while it waits to be added.
    @State private var session: NewDeviceSession

    init(crypto: AccountCrypto, backend: Backend, screen: Screen = .auto, session: NewDeviceSession? = nil) {
        self.crypto = crypto
        self.backend = backend
        _screen = State(initialValue: screen)
        _session = State(initialValue: session ?? NewDeviceSession(crypto: crypto, server: backend.client.map { SupabaseAddDevice(client: $0) }))
    }

    private typealias Row = SignInView.Row
    private typealias Copy = KeyCopy

    var body: some View {
        #if os(macOS)
        // In the welcome's card window, beside its picture (CardLayout).
        card
            .padding(.horizontal, 36)
            .padding(.vertical, 32)
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
                .padding(.top, 20)
                .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background { Backdrop() }
        #endif
    }

    @ViewBuilder private var card: some View {
        VStack(spacing: 22) {
            #if os(iOS)
            // The sign-in card's mark, in the same place, so it stays put from one card to the next.
            // On the Mac the picture beside the step is the mark, as it is for sign-in.
            AppMark(size: 72)
            #endif
            // One screen fades into the next while the card eases to its new height: the mark
            // stays put and nothing snaps.
            content
                .id(Self.shown(crypto.phase, screen))
                .transition(.opacity)
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
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: Self.shown(crypto.phase, screen))
        .onChange(of: crypto.phase) { _, _ in
            // The key arrived (or the account changed) while you were on another screen.
            if crypto.phase == .ready { screen = .auto }
            error = nil
        }
    }

    @ViewBuilder private var content: some View {
        switch Self.shown(crypto.phase, screen) {
        case .welcome: welcome
        case .startFresh: startFresh
        case .addDevice: addDevice
        case .noDevice: noDevice
        case .recovery: recoveryEntry
        case .waiting: waiting
        case .unreachable: unreachable
        case .checking: checking
        }
    }

    /// A check that takes this long offers Sign out under the spinner: a server that takes
    /// connections but never answers shouldn't hold you here until the fetch gives up.
    static let signOutAfter: Duration = .seconds(4)

    private var checking: some View {
        CheckingScreen { signOut }
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

    /// The main way in: a code for a device where Amber Notes already works. The recovery key and
    /// the rest are small links under it.
    private var addDevice: some View {
        VStack(spacing: 18) {
            heading(AddDeviceCopy.gateTitle, crypto.phase == .mismatch ? Copy.mismatch + " " + AddDeviceCopy.gateMessage : AddDeviceCopy.gateWhy + "\n\n" + AddDeviceCopy.gateMessage)
            NewDeviceCodeView(session: session)
                .task(id: session.round) { await session.run() }
            VStack(spacing: 10) {
                quietButton(AddDeviceCopy.useRecovery, id: "e2ee.useRecovery") { screen = .recovery }
                quietButton(AddDeviceCopy.noDevice, id: "e2ee.noDevice") { screen = .noDevice }
                signOut
            }
        }
    }

    /// Every device is gone: what can still open the notes, said plainly, and starting fresh last.
    private var noDevice: some View {
        VStack(spacing: 18) {
            heading(AddDeviceCopy.noDevice, AddDeviceCopy.noDeviceMessage)
            VStack(spacing: 10) {
                if crypto.phase == .waiting, crypto.store.syncs {
                    way(AddDeviceCopy.keychainTitle, AddDeviceCopy.keychainDetail, symbol: "icloud", id: "e2ee.wayKeychain") { screen = .keychain }
                }
                way(AddDeviceCopy.recoveryTitle, AddDeviceCopy.recoveryDetail, symbol: "key", id: "e2ee.wayRecovery") { screen = .recovery }
            }
            Text(AddDeviceCopy.aiNote)
                .font(.footnote)
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 10) {
                quietButton(AddDeviceCopy.noneWork, id: "e2ee.noKey") { screen = .startFresh }
                quietButton("Back", id: "e2ee.back") { screen = .auto }
            }
        }
    }

    private func way(_ title: String, _ detail: String, symbol: String, id: String, action: @escaping () -> Void) -> some View {
        let shape = RoundedRectangle(cornerRadius: Row.radius, style: .continuous)
        return Button { error = nil; action() } label: {
            HStack(spacing: 12) {
                // The largest text sizes get the whole width for the words.
                if !typeSize.isAccessibilitySize {
                    Image(systemName: symbol)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.tint)
                        .frame(width: 28)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ink)
                    Text(detail).font(.footnote).foregroundStyle(Color.muted)
                }
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if !typeSize.isAccessibilitySize {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.muted)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: Row.height)
            .hoverHighlight(shape)
            .background(Color(Palette.field), in: shape)
            .overlay(shape.strokeBorder(Color(Palette.fieldHairline), lineWidth: 1 / displayScale))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// You chose to wait for iCloud Keychain. A spinner only for a little while; then what to
    /// check. The recovery key is always one tap away.
    private var waiting: some View {
        VStack(spacing: 18) {
            heading(Copy.waitingTitle, crypto.showsKeychainHelp ? Copy.keychainHelp : nil)
            if !crypto.showsKeychainHelp {
                ProgressView().controlSize(.regular)
                    .transition(.opacity)
            }
            mainButton("Use recovery key", id: "e2ee.useRecovery", enabled: true) { screen = .recovery }
            quietButton("Back", id: "e2ee.back") { screen = .noDevice }
            signOut
        }
        .animation(.easeOut(duration: 0.25), value: crypto.showsKeychainHelp)
    }

    private var recoveryEntry: some View {
        VStack(spacing: 18) {
            heading("Enter your recovery key", nil)
            VStack(spacing: 10) {
                field {
                    TextField("Recovery key", text: $recovery)
                        .font(.system(size: Row.text, design: .monospaced))
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
                        .focused($focused)
                        .onSubmit { if canSubmitRecovery { submitRecovery() } }
                        .accessibilityLabel("Recovery key")
                        .accessibilityIdentifier("e2ee.recovery")
                }
                Text(Copy.recoveryFormat + " " + Copy.recoveryHint)
                    .font(.footnote)
                    .foregroundStyle(Color.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                mainButton("Unlock notes", id: "e2ee.submit", enabled: canSubmitRecovery) {
                    try await unlock()
                }
            }
            VStack(spacing: 10) {
                quietButton("Back", id: "e2ee.back") { screen = .auto }
                signOut
            }
        }
        .onAppear { focused = true }
    }

    private var canSubmitRecovery: Bool { recovery.filter { $0.isLetter || $0.isNumber }.count >= 28 }

    private func submitRecovery() {
        run { try await unlock() }
    }

    /// The keyboard goes down first, the usual way: left up, it vanishes in one frame when the
    /// next screen takes the field away.
    private func unlock() async throws {
        focused = false
        try await crypto.recover(typed: recovery)
        recovery = ""
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
                quietButton("Back", id: "e2ee.back") { screen = .noDevice; confirmation = ""; needsSignIn = false; password = "" }
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

    /// Deleting everything takes a fresh sign-in, the way this account signs in: Apple or Google
    /// once one is linked, otherwise its email and password. Then it starts fresh.
    @ViewBuilder private var signInAgain: some View {
        Text(Copy.signInAgain)
            .font(.subheadline)
            .foregroundStyle(Color.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("e2ee.signInAgain")
        if backend.apple != nil || backend.google {
            if backend.apple != nil { appleAgain }
            if backend.google {
                GoogleAuthButton(height: Row.height, cornerRadius: Row.radius) {
                    run { try await signInWithGoogleAndStartFresh() }
                }
                .disabled(working)
                .accessibilityIdentifier("e2ee.signInGoogle")
            }
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

    private var appleAgain: some View {
        AppleAuthButton(label: .signIn, height: Row.height, cornerRadius: Row.radius, title: "Sign in with Apple", web: webSignIn) { result in
            switch result {
            case .success(let credential):
                run {
                    try await backend.signInWithApple(credential)
                    try await startFreshAfterSignIn()
                }
            case .failure(.canceled): break
            case .failure(let failure): error = AppleSignIn.message(for: failure)
            }
        }
        .disabled(working)
        .opacity(working ? 0.6 : 1)
        .accessibilityIdentifier("e2ee.signInApple")
    }

    /// Google's chooser can sign in to any Google account, so a different one would sign in to a
    /// different Amber Notes account: that one is signed out again and nothing is deleted.
    private func signInWithGoogleAndStartFresh() async throws {
        let before = backend.userID
        let after: UUID?
        do { after = try await backend.signInWithGoogle(hint: email) } catch where Backend.isCanceled(error) { return } catch {
            throw KeyGateFailure(message: Backend.googleMessage(for: error))
        }
        guard Self.sameAccount(before: before, after: after) else {
            await backend.signOut()
            throw KeyGateFailure(message: "That Google account signs in to a different Amber Notes account. Nothing was deleted.")
        }
        try await startFreshAfterSignIn()
    }

    /// Start fresh only ever runs on the account that asked for it.
    nonisolated static func sameAccount(before: UUID?, after: UUID?) -> Bool {
        guard let before, let after else { return false }
        return before == after
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
        try await startFreshAfterSignIn()
    }

    /// Just signed in again for Start fresh. If the new session still doesn't show a recent
    /// sign-in (`SignInRecency`), asking for another sign-in would only go round in a circle:
    /// say so instead.
    private func startFreshAfterSignIn() async throws {
        let token = try? await backend.client?.auth.session.accessToken
        guard let token, SignInRecency.isRecent(accessToken: token) else { throw KeyError.reauthUnconfirmed }
        do {
            try await crypto.startFresh(confirmation: confirmation)
        } catch KeyError.reauth {
            throw KeyError.reauthUnconfirmed
        }
        confirmation = ""
        needsSignIn = false
        screen = .auto
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
                try await startFreshAfterSignIn()
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
            .buttonStyle(.hoverLink)
            .font(muted ? .footnote : .subheadline)
            .foregroundStyle(muted ? AnyShapeStyle(Color.muted) : AnyShapeStyle(.tint))
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
        return Button(title, role: destructive ? .destructive : nil) { run(action) }
        .buttonStyle(.amberProminent(height: Row.height, cornerRadius: Row.radius))
        .amberBusy(working)
        .disabled(!on)
        .keyboardShortcut(destructive ? nil : .defaultAction)
        .accessibilityIdentifier(id)
    }
}

/// The key screens' words, in one place.
enum KeyCopy {
    static let welcomeTitle = "Your notes are encrypted."
    static let welcomeMessage = "Only your devices, and AI connections you approve, can unlock your notes."
    static let waitingTitle = "Waiting for iCloud Keychain…"
    #if os(macOS)
    static let keychainHelp = "Check that iCloud Keychain is on here and on your other device: System Settings › [your name] › iCloud › Passwords and Keychain."
    #else
    static let keychainHelp = "Check that iCloud Keychain is on here and on your other device: Settings › [your name] › iCloud › Passwords and Keychain."
    #endif
    static let recoveryFormat = "28 letters and numbers, in groups of four."
    static let recoveryHint = "If another device still opens your notes, it shows the key in Settings › Security."
    static let mismatch = "The key on this device isn't your account's current key."
    static let unreachable = "Connect to the internet. This device checks your key with Amber Notes before opening your notes."
    static let startFreshMessage = [
        "Without a device that has your key, or a recovery key you saved, the notes stored with Amber Notes can't be opened by anyone, including us. AI connections you approved can still open them until they're disconnected.",
        "Starting fresh deletes them from our server and disconnects every AI. This device gets a new key and a new recovery key, and your account starts empty.",
    ]
    static let signInAgain = "To delete your notes, sign in again first."

}

/// The spinner while the key check is out, with Sign out once it has taken a while. Its place is
/// kept from the start so nothing moves when it appears.
private struct CheckingScreen<SignOut: View>: View {
    @ViewBuilder var signOut: SignOut
    @State private var slow = false

    var body: some View {
        VStack(spacing: 18) {
            ProgressView().controlSize(.regular).frame(height: 120)
            signOut
                .opacity(slow ? 1 : 0)
                .disabled(!slow)
                .accessibilityHidden(!slow)
        }
        .animation(.easeOut(duration: 0.25), value: slow)
        .task {
            guard (try? await Task.sleep(for: KeyGateView.signOutAfter)) != nil else { return }
            slow = true
        }
    }
}
