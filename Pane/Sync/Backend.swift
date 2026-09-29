import Foundation
import Observation
import Supabase

/// The Supabase project from the build settings, or nil when the app runs local-only.
enum BackendConfig {
    static var url: URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "PaneSupabaseURL") as? String,
              s.hasPrefix("http"), let u = URL(string: s) else { return nil }
        return u
    }

    static var key: String? {
        guard let k = Bundle.main.object(forInfoDictionaryKey: "PaneSupabaseKey") as? String, !k.isEmpty, !k.hasPrefix("$(") else { return nil }
        return k
    }

    /// Test runs and `-local` launches never touch the network.
    static var isEnabled: Bool {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-uitest") || args.contains("-local") { return false }
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil, !args.contains("-synctest") { return false }
        return url != nil && key != nil
    }

    static var mcpURL: URL? { url?.appending(path: "functions/v1/mcp") }
}

/// Owns the Supabase client and the signed-in session.
@MainActor
@Observable
final class Backend {
    enum State: Equatable { case disabled, signedOut, signedIn(email: String) }

    private(set) var state: State = .disabled
    let client: SupabaseClient?

    init() {
        if BackendConfig.isEnabled, let url = BackendConfig.url, let key = BackendConfig.key {
            client = SupabaseClient(
                supabaseURL: url,
                supabaseKey: key,
                options: SupabaseClientOptions(auth: .init(storage: SessionStorage(), emitLocalSessionAsInitialSession: true))
            )
            state = .signedOut
            let fresh = ProcessInfo.processInfo.arguments.contains("-signout")
            Task {
                if fresh { try? await client?.auth.signOut() }
                await watchAuth()
            }
        } else {
            client = nil
        }
    }

    var userID: UUID? { client?.auth.currentUser?.id }

    /// For screenshots and previews only: shows the signed-in screens without a session.
    func showSignedInForPreview(email: String) { state = .signedIn(email: email) }

    private func watchAuth() async {
        guard let client else { return }
        for await (_, session) in client.auth.authStateChanges {
            if let session, !session.isExpired {
                state = .signedIn(email: session.user.email ?? "")
            } else if let session, session.isExpired {
                // Let the SDK refresh; stay signed in if it can.
                if (try? await client.auth.refreshSession()) != nil {
                    state = .signedIn(email: session.user.email ?? "")
                } else {
                    state = .signedOut
                }
            } else {
                state = .signedOut
            }
        }
    }

    func signIn(email: String, password: String) async throws {
        guard let client else { return }
        try await client.auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    /// Creates an account. With email confirmation off, this signs you straight in.
    func signUp(email: String, password: String) async throws {
        guard let client else { return }
        try await client.auth.signUp(email: email.trimmingCharacters(in: .whitespaces).lowercased(), password: password)
    }

    func changePassword(to password: String) async throws {
        guard let client else { return }
        try await client.auth.update(user: UserAttributes(password: password))
    }

    /// Words a person can act on, instead of raw server errors.
    static func message(for error: Error, signingUp: Bool) -> String {
        if error is URLError { return "Can't reach the server. Check your connection." }
        let raw = (error as? AuthError)?.message ?? error.localizedDescription
        let lower = raw.lowercased()
        if lower.contains("private") || lower.contains("not allowed") { return "This server only accepts invited emails. Ask its owner to add yours." }
        if lower.contains("already") { return "That email already has an account. Sign in instead." }
        if lower.contains("invalid login") || lower.contains("invalid credentials") { return "That email and password didn't match." }
        if lower.contains("password") && signingUp { return "Pick a longer password: at least 12 characters." }
        if lower.contains("email") && lower.contains("invalid") { return "That doesn't look like an email address." }
        return raw
    }

    func signOut() async {
        try? await client?.auth.signOut()
    }
}
