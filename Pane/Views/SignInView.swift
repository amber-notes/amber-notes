import SwiftUI

/// Sign in: Sign in with Apple, or email first. Type your email, Continue, and the screen asks
/// for your password or for a new one, depending on whether the email has an account.
/// Signed out, it sits beside the welcome's picture (WelcomeFlow); on its own (captures and
/// snapshots) it's the old card: the whole window on the Mac, a glass card on iPhone.
struct SignInView: View {
    let backend: Backend
    let heading: Heading
    @State private var flow: EmailSignInFlow
    @State private var working = false
    @State private var error: String?
    @FocusState private var focus: Field?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale

    enum Field { case email, password }

    /// The words above the form: the card's own (icon, title and promise, centred), or a title
    /// and a line from the welcome flow, which sets the form beside its picture.
    enum Heading: Equatable {
        case card
        case beside(title: String, line: String)
    }

    init(backend: Backend, flow: EmailSignInFlow = EmailSignInFlow(), heading: Heading = .card) {
        self.backend = backend
        self.heading = heading
        _flow = State(initialValue: flow)
    }

    /// Email sign-in sits under Sign in with Apple.
    static let emailFallback = true

    /// One size and shape for every row (Apple button, fields, the main button), so the card reads as one form.
    enum Row {
        #if os(macOS)
        static let height: CGFloat = 36
        static let radius: CGFloat = 8
        static let text: CGFloat = 14
        #else
        static let height: CGFloat = 48
        static let radius: CGFloat = 12
        static let text: CGFloat = 17
        #endif
    }

    var body: some View {
        if case .beside = heading {
            // The welcome flow places it.
            card
        } else {
            cardScreen
        }
    }

    private var cardScreen: some View {
        #if os(macOS)
        card
            .padding(.horizontal, 36)
            .padding(.vertical, 56)
            .frame(width: 380)
        #else
        // Top-anchored in a scroll view: the card keeps one place for the whole flow. The keyboard
        // only scrolls it when it would cover the field you're typing in.
        ScrollView {
            card
                .padding(28)
                .frame(minWidth: 300, maxWidth: 380)
                .glassEffect(.regular, in: .rect(cornerRadius: 28))
                .padding(20)
                .padding(.top, 20)
                .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .background { Backdrop() }
        #endif
    }

    private var card: some View {
        VStack(spacing: 24) {
            switch heading {
            case .card:
                VStack(spacing: 14) {
                    AppMark(size: 72)
                    // The website's display type: heavy and tight.
                    Text("Sign in to Amber Notes")
                        .font(.title2.weight(.heavy))
                        .tracking(-0.6)
                        .foregroundStyle(Color.ink)
                        .multilineTextAlignment(.center)
                    promise
                }
            case .beside(let title, let line):
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.title2.weight(.heavy))
                        .tracking(-0.6)
                        .foregroundStyle(Color.ink)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("signin.title")
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(Color.muted)
                }
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(spacing: 12) {
                // Asking for a password, the Apple row folds away as the password row comes in,
                // so the main button keeps its place and the whole form fits above the keyboard.
                if flow.showsApple {
                    VStack(spacing: 12) {
                        AppleAuthButton(label: .signIn, height: Row.height, title: "Sign in with Apple", web: webSignIn) { result in
                            switch result {
                            case .success(let credential): signIn(credential)
                            case .failure(let failure): error = AppleSignIn.message(for: failure)
                            }
                        }
                        .disabled(working)
                        .opacity(working ? 0.6 : 1)
                        .accessibilityIdentifier("signin.apple")

                        if Self.emailFallback { orDivider }
                    }
                    .transition(.opacity)
                }

                if Self.emailFallback {
                    emailSection
                }

                // Always there, a line high when empty, so an error coming or going moves nothing.
                Text(error ?? " ")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(error == nil ? 0 : 1)
                    .accessibilityHidden(error == nil)
                    .accessibilityIdentifier(error == nil ? "" : "signin.error")
            }

            ConsentFooter()
        }
        .animation(.snappy(duration: 0.2), value: error)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: flow.step)
        // Once the password field is there (focusing it in the same update as it appears is
        // lost, and a paste then lands on the email row).
        .onChange(of: flow.showsPassword) { _, shows in if shows { focus = .password } }
    }

    /// The website's one-line promise, with its low amber marker under "your AI".
    private var promise: some View {
        VStack(spacing: 3) {
            Text("The notes app \(Text("your AI").foregroundStyle(Color.ink).customAttribute(Marker())) can use.")
                .textRenderer(Marker.Renderer(color: Color(Palette.underline)))
            // Where the notes live, said once and plainly.
            Text("Your notes sync between iPhone and Mac.")
                .font(.footnote)
                .foregroundStyle(Color.muted.opacity(0.85))
                .accessibilityIdentifier("signin.sync")
        }
        .font(.subheadline)
        .foregroundStyle(Color.muted)
        .multilineTextAlignment(.center)
        .padding(.top, -6)
    }

    private var emailSection: some View {
        VStack(spacing: 10) {
            // One row for the email: a field, then (once it's checked) the address as text. Both
            // stay in place and swap at once (no cross-fade of two texts), so the row itself can
            // ease up when Sign in with Apple folds away, and the keyboard goes straight on to
            // the password field.
            field {
                ZStack(alignment: .leading) {
                    // Edits while it's being checked are ignored, so the answer matches the email.
                    TextField("Email", text: Binding(get: { flow.email }, set: { if !flow.emailLocked { flow.email = $0 } }))
                        .textContentType(.username)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.continue)
                        .onSubmit(primary)
                        .animation(nil) { $0.opacity(flow.showsEmailField ? 1 : 0) }
                        .allowsHitTesting(flow.showsEmailField)
                        .accessibilityHidden(!flow.showsEmailField)
                        .accessibilityIdentifier("signin.email")
                    Text(flow.email)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .animation(nil) { $0.opacity(flow.showsEmailField ? 0 : 1) }
                        .accessibilityHidden(flow.showsEmailField)
                        .accessibilityIdentifier("signin.lockedEmail")
                }
            }
            if !flow.showsEmailField {
                // On its own line, so a long address keeps the whole row.
                Button {
                    flow.back()
                    error = nil
                    focus = .email
                } label: {
                    // The whole row takes the tap, not just the words.
                    Text("Use a different email")
                        .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .font(.footnote)
                .foregroundStyle(.tint)
                .accessibilityIdentifier("signin.back")
                .transition(.opacity)
            }

            if flow.showsPassword {
                field {
                    SecureField(flow.step == .create ? "Create a password (12+ characters)" : "Password", text: $flow.password)
                        .textContentType(flow.step == .create ? .newPassword : .password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(primary)
                        .accessibilityIdentifier("signin.password")
                }
                .transition(.opacity)
            }

            if case .forgot = flow.step {
                note("We'll email you a link to choose a new password.", id: "signin.forgotNote")
            }

            if flow.step == .forgotSent {
                note("If an account uses this email, we've sent it a link. Open it on any device to choose a new password. The link works for one hour.", id: "signin.resetSent")
            }

            if flow.step == .apple {
                Text("This email signs in with Apple. Use Sign in with Apple above.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
                    .accessibilityIdentifier("signin.appleOnly")
            }

            if let title = flow.buttonTitle {
                mainButton(title)
            }

            // Under the button, like the link below, so the button stays where it was.
            if flow.step == .create {
                Text("New here? We'll create your account.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .transition(.opacity)
            }

            if flow.offersReset {
                smallButton("Forgot password?", id: "signin.forgot") {
                    flow.forgotPassword()
                    error = nil
                }
            }

            if flow.step == .forgot(sending: false) {
                smallButton("Back to Sign In", id: "signin.backToSignIn") {
                    flow.backToSignIn()
                    error = nil
                    focus = .password
                }
            }

            if flow.step == .signIn(fallback: true) {
                smallButton("New? Create an account", id: "signin.create") {
                    flow.chooseCreate()
                    error = nil
                    focus = .password
                }
            }
        }
        .textFieldStyle(.plain)
    }

    /// A line of explanation under the email, in the card's quiet voice.
    private func note(_ text: String, id: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
            .accessibilityIdentifier(id)
    }

    /// A text button under the main one, still big enough to hit.
    private func smallButton(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .font(.footnote)
            .foregroundStyle(.tint)
            .frame(minHeight: 28)
            .contentShape(.rect)
            .transition(.opacity)
            .accessibilityIdentifier(id)
    }

    private func mainButton(_ title: String) -> some View {
        let busy = working || flow.step == .checking || flow.step == .forgot(sending: true)
        let enabled = flow.buttonEnabled && !working
        return Button(title, action: primary)
        .buttonStyle(.amberProminent(height: Row.height, cornerRadius: Row.radius))
        .amberBusy(busy)
        .disabled(!enabled)
        .animation(.easeOut(duration: 0.15), value: enabled)
        .keyboardShortcut(.defaultAction)
        .accessibilityIdentifier("signin.submit")
        .padding(.top, 2)
    }

    /// One input, the same height and corners as the buttons.
    private func field(@ViewBuilder _ content: () -> some View) -> some View {
        let shape = RoundedRectangle(cornerRadius: Row.radius, style: .continuous)
        return content()
            .font(.system(size: Row.text))
            .padding(.horizontal, 12)
            .frame(height: Row.height)
            .background(Color(Palette.field), in: shape)
            .overlay(shape.strokeBorder(Color(Palette.fieldHairline), lineWidth: 1 / displayScale))
    }

    /// "or" between the two ways in.
    private var orDivider: some View {
        HStack(spacing: 10) {
            Rectangle().fill(.separator).frame(height: 1)
            Text("or").font(.footnote).foregroundStyle(.secondary)
            Rectangle().fill(.separator).frame(height: 1)
        }
        .padding(.vertical, 2)
        .accessibilityHidden(true)
    }

    /// The Mac download signs in with Apple on the web; everywhere else the native sheet does it.
    private var webSignIn: (@MainActor () -> Void)? {
        #if DIRECT
        return {
            working = true
            error = nil
            Task {
                do { try await backend.signInWithAppleOnTheWeb() } catch where !Backend.isCanceled(error) {
                    self.error = Backend.appleMessage(for: error, linking: false)
                } catch {}
                working = false
            }
        }
        #else
        return nil
        #endif
    }

    private func signIn(_ credential: AppleSignIn.Credential) {
        working = true
        error = nil
        Task {
            do { try await backend.signInWithApple(credential) } catch { self.error = Backend.appleMessage(for: error, linking: false) }
            working = false
        }
    }

    /// The full-width button, or Return in either field.
    private func primary() {
        guard flow.buttonEnabled, !working else { return }
        error = nil
        switch flow.action {
        case .check:
            guard flow.beginCheck() else { return }
            let email = flow.email
            Task {
                let status = try? await backend.accountStatus(email: email)
                guard flow.step == .checking, flow.email == email else { return }
                flow.finishCheck(status)
            }
        case .signIn, .create:
            let creating = flow.action == .create
            let (email, password) = (flow.email, flow.password)
            working = true
            Task {
                do {
                    if creating { try await backend.signUp(email: email, password: password) }
                    else { try await backend.signIn(email: email, password: password) }
                } catch {
                    self.error = Backend.message(for: error, signingUp: creating)
                }
                working = false
            }
        case .sendReset:
            guard flow.beginReset() else { return }
            let email = flow.email
            Task {
                do {
                    try await backend.requestPasswordReset(email: email)
                    flow.finishReset(sent: true)
                } catch {
                    flow.finishReset(sent: false)
                    self.error = "Can't reach the server. Check your connection."
                }
            }
        case .backToSignIn:
            flow.backToSignIn()
            focus = .password
        case nil:
            break
        }
    }
}

/// The website's low marker: a band behind the lower part of the words, from the middle of the
/// lowercase letters to just under the baseline, so it reads as a highlighter stroke, not a box.
struct Marker: TextAttribute {
    struct Renderer: TextRenderer {
        let color: Color

        func draw(layout: Text.Layout, in context: inout GraphicsContext) {
            for line in layout {
                for run in line {
                    if run[Marker.self] != nil {
                        let r = run.typographicBounds.rect
                        let band = CGRect(x: r.minX - 1, y: r.minY + r.height * 0.52, width: r.width + 2, height: r.height * 0.32)
                        context.fill(Path(band), with: .color(color))
                    }
                    context.draw(run)
                }
            }
        }
    }
}

/// A plain, warm ground in either appearance: no glows, no fades.
struct Backdrop: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Self.color(scheme).ignoresSafeArea()
    }

    static func color(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.105, green: 0.1, blue: 0.11) : Color(red: 0.975, green: 0.968, blue: 0.955)
    }
}
