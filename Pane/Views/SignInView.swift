import SwiftUI

/// Sign in with Apple. On the Mac this is the whole window; on iPhone it's a glass
/// card over a warm backdrop. Both follow light and dark mode.
struct SignInView: View {
    let backend: Backend
    @State private var working = false
    @State private var error: String?
    /// The old email sign-in, folded away. It stays until your Apple ID is linked on
    /// every device (Settings → Connect Apple ID); then `emailFallback` goes to false.
    @State private var showEmail = true
    /// The email form creates an account instead of signing in.
    @State private var creating = false
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    enum Field { case email, password }

    /// Temporary: lets an account that hasn't linked its Apple ID yet get in once.
    static let emailFallback = true

    /// One size and shape for every row (Apple button, fields, Sign In), so the card reads as one form.
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

    /// Signing in and creating an account are two pages: the whole card changes, not a few words in it.
    private var card: some View {
        ZStack {
            page
                .id(creating)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .offset(x: creating ? 24 : -24)),
                    removal: .opacity.combined(with: .offset(x: creating ? -24 : 24))))
        }
        .animation(.smooth(duration: 0.3), value: creating)
    }

    private var page: some View {
        VStack(spacing: 24) {
            VStack(spacing: 14) {
                AppMark(size: 72)
                Text(creating ? "Create your account" : "Sign in to Amber Notes")
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 12) {
                AppleAuthButton(label: creating ? .signUp : .signIn, height: Row.height,
                                title: creating ? "Sign up with Apple" : "Sign in with Apple", web: webSignIn) { result in
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

                if Self.emailFallback {
                    orDivider
                    emailSection
                }
            }

            Button {
                creating.toggle()
                error = nil
                password = ""
            } label: {
                (Text(creating ? "Already have an account? " : "New to Amber Notes? ").foregroundStyle(.secondary)
                 + Text(creating ? "Sign In" : "Create an Account").foregroundStyle(.tint))
                    .font(.footnote)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("signin.switch")
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
                    SecureField(creating ? "Password, 12+ characters" : "Password", text: $password)
                        .textContentType(creating ? .newPassword : .password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signInWithEmail)
                        .accessibilityIdentifier("signin.password")
                }
                Button(action: signInWithEmail) {
                    Text(creating ? "Create Account" : "Sign In")
                        .font(.system(size: Row.text, weight: .semibold))
                        .foregroundStyle(.black.opacity(0.85))
                        .frame(maxWidth: .infinity, minHeight: Row.height, maxHeight: Row.height)
                        .background(Color.accentColor, in: .rect(cornerRadius: Row.radius, style: .continuous))
                        .contentShape(.rect(cornerRadius: Row.radius, style: .continuous))
                }
                .buttonStyle(PressScale())
                .disabled(!canSubmitEmail)
                .opacity(canSubmitEmail ? 1 : 0.45)
                .animation(.easeOut(duration: 0.15), value: canSubmitEmail)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("signin.submit")
                .padding(.top, 2)
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

    /// One input, the same height and corners as the buttons.
    private func field(@ViewBuilder _ content: () -> some View) -> some View {
        let shape = RoundedRectangle(cornerRadius: Row.radius, style: .continuous)
        return content()
            .font(.system(size: Row.text))
            .padding(.horizontal, 12)
            .frame(height: Row.height)
            .background(.fill.tertiary, in: shape)
            .overlay(shape.strokeBorder(.primary.opacity(0.08), lineWidth: 1))
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

    private var canSubmitEmail: Bool {
        !email.isEmpty && !working && (creating ? password.count >= 12 : !password.isEmpty)
    }

    private func signInWithEmail() {
        guard canSubmitEmail else { return }
        working = true
        error = nil
        let signingUp = creating
        Task {
            do {
                if signingUp { try await backend.signUp(email: email, password: password) }
                else { try await backend.signIn(email: email, password: password) }
            } catch {
                self.error = Backend.message(for: error, signingUp: signingUp)
            }
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
