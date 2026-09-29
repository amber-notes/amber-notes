import SwiftUI

/// Sign in with Apple. On the Mac this is the whole window; on iPhone it's a glass
/// card over a warm backdrop. Both follow light and dark mode.
struct SignInView: View {
    let backend: Backend
    @State private var working = false
    @State private var error: String?
    /// The old email sign-in, folded away. It stays until your Apple ID is linked on
    /// every device (Settings → Connect Apple ID); then `emailFallback` goes to false.
    @State private var showEmail = false
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    enum Field { case email, password }

    /// Temporary: lets an account that hasn't linked its Apple ID yet get in once.
    static let emailFallback = true

    var body: some View {
        #if os(macOS)
        card
            .padding(.horizontal, 36)
            .padding(.top, 40)
            .padding(.bottom, 44)
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
                Image("Mark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)
                    .accessibilityHidden(true)
                Text("Sign in to Amber Notes")
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                AppleAuthButton(label: .signIn, height: 44) { result in
                    switch result {
                    case .success(let credential): signIn(credential)
                    case .failure(let failure): error = AppleSignIn.message(for: failure)
                    }
                }
                .disabled(working)
                .opacity(working ? 0.6 : 1)
                .overlay { if working { ProgressView().controlSize(.small) } }
                .accessibilityIdentifier("signin.apple")

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .transition(.opacity)
                }
            }

            if Self.emailFallback { emailSection }
        }
        .animation(.snappy(duration: 0.2), value: error)
        .animation(.smooth(duration: 0.3), value: showEmail)
    }

    @ViewBuilder
    private var emailSection: some View {
        if showEmail {
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
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signInWithEmail)
                        .accessibilityIdentifier("signin.password")
                }
                Button("Sign In", action: signInWithEmail)
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(email.isEmpty || password.isEmpty || working)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("signin.submit")
            }
            .textFieldStyle(.plain)
            .transition(.opacity.combined(with: .move(edge: .top)))
        } else {
            Button("Use email and password instead") {
                showEmail = true
                error = nil
                focus = .email
            }
            .buttonStyle(.plain)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("signin.useEmail")
        }
    }

    /// One input, as a soft pill.
    private func field(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .font(.body)
            .padding(.horizontal, 16)
            .frame(height: 44)
            .background(.fill.tertiary, in: .capsule)
            .overlay(Capsule().strokeBorder(.primary.opacity(0.08), lineWidth: 1))
    }

    private func signIn(_ credential: AppleSignIn.Credential) {
        working = true
        error = nil
        Task {
            do { try await backend.signInWithApple(credential) } catch { self.error = Backend.appleMessage(for: error, linking: false) }
            working = false
        }
    }

    private func signInWithEmail() {
        guard !email.isEmpty, !password.isEmpty, !working else { return }
        working = true
        error = nil
        Task {
            do { try await backend.signIn(email: email, password: password) } catch { self.error = Backend.message(for: error, signingUp: false) }
            working = false
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
