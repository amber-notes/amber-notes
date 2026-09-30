import SwiftUI

/// Sign in: Sign in with Apple, or email first. Type your email, Continue, and the screen asks
/// for your password or for a new one, depending on whether the email has an account.
/// On the Mac this is the whole window; on iPhone it's a glass card over a warm backdrop.
struct SignInView: View {
    let backend: Backend
    @State private var flow: EmailSignInFlow
    @State private var working = false
    @State private var error: String?
    @FocusState private var focus: Field?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale

    enum Field { case email, password }

    init(backend: Backend, flow: EmailSignInFlow = EmailSignInFlow()) {
        self.backend = backend
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
        #if os(macOS)
        card
            .padding(.horizontal, 36)
            .padding(.vertical, 56)
            .frame(width: 380)
        #else
        card
            .padding(28)
            .frame(minWidth: 300, maxWidth: 380)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { Backdrop() }
        #endif
    }

    private var card: some View {
        VStack(spacing: 24) {
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

                if Self.emailFallback {
                    orDivider
                    emailSection
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .transition(.opacity)
                        .accessibilityIdentifier("signin.error")
                }
            }

            ConsentFooter()
        }
        .animation(.snappy(duration: 0.2), value: error)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: flow.step)
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
            if flow.emailLocked {
                lockedEmail
            } else {
                field {
                    TextField("Email", text: $flow.email)
                        .textContentType(.username)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.continue)
                        .onSubmit(primary)
                        .accessibilityIdentifier("signin.email")
                }
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
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }

            if flow.step == .create {
                Text("New here? We'll create your account.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity)
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

            if flow.step == .signIn(fallback: true) {
                Button("New? Create an account") {
                    flow.chooseCreate()
                    error = nil
                    focus = .password
                }
                .buttonStyle(.plain)
                .font(.footnote)
                .foregroundStyle(.tint)
                .accessibilityIdentifier("signin.create")
            }
        }
        .textFieldStyle(.plain)
    }

    /// The email, fixed once you've continued, with the way back.
    private var lockedEmail: some View {
        let shape = RoundedRectangle(cornerRadius: Row.radius, style: .continuous)
        return HStack(spacing: 8) {
            Text(flow.email)
                .font(.system(size: Row.text))
                .lineLimit(1)
                .truncationMode(.middle)
                .accessibilityIdentifier("signin.lockedEmail")
            Spacer(minLength: 8)
            Button("Use a different email") {
                flow.back()
                error = nil
                focus = .email
            }
            .buttonStyle(.plain)
            .font(.footnote)
            .foregroundStyle(.tint)
            .accessibilityIdentifier("signin.back")
        }
        .padding(.horizontal, 12)
        .frame(height: Row.height)
        .background(Color(Palette.field), in: shape)
        .overlay(shape.strokeBorder(Color(Palette.fieldHairline), lineWidth: 1 / displayScale))
    }

    private func mainButton(_ title: String) -> some View {
        let busy = working || flow.step == .checking
        let enabled = flow.buttonEnabled && !working
        return Button(action: primary) {
            ZStack {
                Text(title).opacity(busy ? 0 : 1)
                if busy { ProgressView().controlSize(.small).tint(Color(Palette.onAmber)) }
            }
            .font(.system(size: Row.text, weight: .semibold))
            // Deep amber with dark ink when it can be pressed; quiet, near the field, when not.
            .foregroundStyle(enabled || busy ? Color(Palette.onAmber) : Color.muted)
            .frame(maxWidth: .infinity, minHeight: Row.height, maxHeight: Row.height)
            .background(enabled || busy ? Color.accentColor : Color(Palette.quietButton), in: .rect(cornerRadius: Row.radius, style: .continuous))
            .contentShape(.rect(cornerRadius: Row.radius, style: .continuous))
        }
        .buttonStyle(PressScale())
        .disabled(!enabled)
        .animation(.easeOut(duration: 0.15), value: enabled)
        .keyboardShortcut(.defaultAction)
        .accessibilityLabel(busy ? "\(title), working" : title)
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
                if flow.showsPassword { focus = .password }
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
        (scheme == .dark ? Color(red: 0.105, green: 0.1, blue: 0.11) : Color(red: 0.975, green: 0.968, blue: 0.955))
            .ignoresSafeArea()
    }
}
