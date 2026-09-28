import SwiftUI

/// Sign in or create an account. On the Mac this is the whole window; on iPhone
/// it's a glass card over a warm backdrop.
struct SignInView: View {
    let backend: Backend
    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Field { case email, password }
    enum Mode { case signIn, signUp }

    var body: some View {
        #if os(macOS)
        card
            .padding(.horizontal, 36)
            .padding(.top, 40)
            .padding(.bottom, 52) // a chin below the link
            .frame(width: 380)
            .environment(\.colorScheme, .dark)
            .onAppear { focus = .email }
        #else
        card
            .padding(28)
            .frame(minWidth: 300, maxWidth: 380)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { Backdrop() }
            .environment(\.colorScheme, .dark)
            .onAppear { focus = .email }
        #endif
    }

    private var card: some View {
        VStack(spacing: 22) {
            VStack(spacing: 14) {
                Image("Mark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .accessibilityHidden(true)
                swap {
                    Text(mode == .signIn ? "Sign in" : "Create account")
                        .font(.title2.weight(.bold))
                }
            }

            VStack(spacing: 10) {
                field {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    #if os(iOS)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    #endif
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
                    .accessibilityIdentifier("signin.email")
                }
                field {
                SecureField(mode == .signIn ? "Password" : "Password, 12+ characters", text: $password)
                    .textContentType(mode == .signIn ? .password : .newPassword)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .accessibilityIdentifier("signin.password")
                }
            }
            .textFieldStyle(.plain)

            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            }

            VStack(spacing: 12) {
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if working { ProgressView().controlSize(.small).tint(.black) }
                        swap { Text(buttonTitle) }
                    }
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.black.opacity(0.85))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Color.accentColor, in: .capsule)
                    .contentShape(.capsule)
                }
                .buttonStyle(PressScale())
                .disabled(!canSubmit)
                .opacity(canSubmit || working ? 1 : 0.45)
                .animation(.easeOut(duration: 0.15), value: canSubmit)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("signin.submit")

                Button {
                    withAnimation(.smooth(duration: 0.32)) {
                        mode = mode == .signIn ? .signUp : .signIn
                        error = nil
                    }
                } label: {
                    swap { Text(mode == .signIn ? "Create an account" : "I already have an account") }
                }
                .buttonStyle(.plain)
                .font(.callout)
                .foregroundStyle(.tint)
                .accessibilityIdentifier("signin.switch")
            }
        }
        .animation(.snappy(duration: 0.2), value: error)
    }

    /// Changing text slides up and fades; the old one leaves a little faster.
    /// Both sit in one place, so nothing around them moves.
    private func swap(@ViewBuilder _ content: () -> some View) -> some View {
        ZStack {
            content()
                .id(mode)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .offset(y: 8)).animation(.smooth(duration: 0.32).delay(0.05)),
                    removal: .opacity.combined(with: .offset(y: -6)).animation(.easeOut(duration: 0.18))))
        }
    }

    /// One input, as a soft glass pill.
    private func field(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .font(.body)
            .padding(.horizontal, 16)
            .frame(height: 44)
            .background(.white.opacity(0.07), in: .capsule)
            .overlay(Capsule().strokeBorder(.white.opacity(0.10), lineWidth: 1))
    }

    private var buttonTitle: String {
        switch (mode, working) {
        case (.signIn, false): "Sign in"
        case (.signIn, true): "Signing in…"
        case (.signUp, false): "Create account"
        case (.signUp, true): "Creating account…"
        }
    }

    private var canSubmit: Bool {
        !email.isEmpty && !working && (mode == .signIn ? !password.isEmpty : password.count >= 12)
    }

    private func submit() {
        guard canSubmit else { return }
        working = true
        error = nil
        Task {
            do {
                if mode == .signIn {
                    try await backend.signIn(email: email, password: password)
                } else {
                    try await backend.signUp(email: email, password: password)
                }
            } catch {
                self.error = Backend.message(for: error, signingUp: mode == .signUp)
            }
            working = false
        }
    }
}

/// A plain, warm-dark ground: no glows, no fades.
struct Backdrop: View {
    var body: some View {
        Color(red: 0.105, green: 0.1, blue: 0.11)
            .ignoresSafeArea()
    }
}
