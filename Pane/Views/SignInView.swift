import SwiftUI

/// The one screen between you and your notes when sync is on.
struct SignInView: View {
    let backend: Backend
    @State private var email = ""
    @State private var password = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            Backdrop()
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    Image("Mark")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 84, height: 84)
                        .accessibilityHidden(true)
                    Text("Sign in to Amber Notes")
                        .font(.title2.weight(.bold))
                    Text("Your notes sync between your devices and the AI tools you connect.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(spacing: 10) {
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
                    Divider()
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .accessibilityIdentifier("signin.password")
                }
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(.fill.tertiary, in: .rect(cornerRadius: 12))

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .transition(.opacity)
                }

                Button(action: submit) {
                    HStack(spacing: 8) {
                        if working { ProgressView().controlSize(.small) }
                        Text(working ? "Signing in…" : "Sign in")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(email.isEmpty || password.isEmpty || working)
                .accessibilityIdentifier("signin.submit")
            }
            .padding(28)
            .frame(maxWidth: 380)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
            .padding(20)
        }
        .environment(\.colorScheme, .dark)
        .onAppear { focus = .email }
        .animation(.snappy(duration: 0.2), value: error)
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !working else { return }
        working = true
        error = nil
        Task {
            do {
                try await backend.signIn(email: email, password: password)
            } catch {
                self.error = "That email and password didn't match."
            }
            working = false
        }
    }
}

/// A soft, warm field behind glass surfaces.
struct Backdrop: View {
    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color(white: 0.08)
                Circle()
                    .fill(Color(red: 0.96, green: 0.66, blue: 0.22).opacity(0.55))
                    .frame(width: geo.size.width * 0.9)
                    .blur(radius: 120)
                    .offset(x: geo.size.width * 0.3, y: -geo.size.height * 0.3)
                Circle()
                    .fill(Color(red: 0.45, green: 0.35, blue: 0.85).opacity(0.35))
                    .frame(width: geo.size.width * 0.8)
                    .blur(radius: 140)
                    .offset(x: -geo.size.width * 0.35, y: geo.size.height * 0.35)
            }
        }
        .ignoresSafeArea()
        .environment(\.colorScheme, .dark)
    }
}
