import AuthenticationServices
import Foundation
import Observation
import Supabase
#if os(iOS)
import UIKit
#endif

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

    /// The MCP function itself. The app calls it here for connection requests.
    static var mcpURL: URL? { url?.appending(path: "functions/v1/mcp") }

    /// The MCP server's address as people see it and paste it (https://mcp.ambernotes.app in
    /// release builds, from PANE_MCP_URL). Builds without one show the function's own address.
    static var mcpPublicURL: URL? {
        publicMCPURL(configured: Bundle.main.object(forInfoDictionaryKey: "PaneMCPURL") as? String, function: mcpURL)
    }

    static func publicMCPURL(configured: String?, function: URL?) -> URL? {
        if let s = configured, s.hasPrefix("https://"), let u = URL(string: s) { return u }
        return function
    }
}

/// Owns the Supabase client and the signed-in session.
@MainActor
@Observable
final class Backend {
    enum State: Equatable { case disabled, signedOut, signedIn(email: String) }

    private(set) var state: State = .disabled
    /// The Apple ID linked to this account, if any: sign-in is Apple-only once it's there.
    private(set) var apple: AppleIdentity?
    let client: SupabaseClient?

    struct AppleIdentity: Equatable {
        /// Apple's email for you: your own, or a private relay address.
        var email: String?
    }

    init() {
        if BackendConfig.isEnabled, let url = BackendConfig.url, let key = BackendConfig.key {
            client = SupabaseClient(
                supabaseURL: url,
                supabaseKey: key,
                options: SupabaseClientOptions(
                    auth: .init(storage: SessionStorage(), emitLocalSessionAsInitialSession: true),
                    // Which device wrote each version, for version history ("You on iPhone"); and that
                    // this app keeps locked notes sealed and reads end-to-end encrypted accounts (the
                    // server refuses builds that don't say so, for accounts that need it).
                    global: .init(headers: ["x-pane-device": Self.device, "x-amber-client": Self.clientTag], session: AppNetwork.session)
                )
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

    /// Tests: a client (on a stubbed network) that counts as signed in, as `userID` when given.
    init(testClient: SupabaseClient, email: String, userID: UUID? = nil) {
        client = testClient
        state = .signedIn(email: email)
        testUserID = userID
    }

    private var testUserID: UUID?
    var userID: UUID? { testUserID ?? client?.auth.currentUser?.id }

    /// What this build can do, for the server: seal locked notes, and read and write encrypted accounts.
    static let clientTag = "lock-aware/1 e2ee/1"

    /// This kind of device, as version history names it.
    static var device: String {
        #if os(iOS)
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #else
        "Mac"
        #endif
    }

    /// Runs just before the app shows an account as signed in, so the device's library can be
    /// handed to that account first (AccountLibrary). Nothing is drawn in between.
    @ObservationIgnored var willSignIn: (UUID) -> Void = { _ in }

    private func signedIn(_ session: Session) {
        willSignIn(session.user.id)
        state = .signedIn(email: session.user.email ?? "")
    }

    /// For screenshots and previews only: shows the signed-in screens without a session.
    func showSignedInForPreview(email: String) { state = .signedIn(email: email) }

    private func watchAuth() async {
        guard let client else { return }
        for await (_, session) in client.auth.authStateChanges {
            apple = session.flatMap { Self.appleIdentity(of: $0.user) }
            if let session, !session.isExpired {
                signedIn(session)
            } else if let session, session.isExpired {
                // Let the SDK refresh; stay signed in if it can.
                if (try? await client.auth.refreshSession()) != nil {
                    signedIn(session)
                } else {
                    state = .signedOut
                }
            } else {
                state = .signedOut
            }
        }
    }

    /// The email to show for you: Apple's, unless Apple hides it behind a relay address.
    var displayEmail: String? {
        guard case .signedIn(let account) = state else { return nil }
        if let a = apple?.email, !a.isEmpty, !a.hasSuffix("privaterelay.appleid.com") { return a }
        return account
    }

    static func appleIdentity(of user: User) -> AppleIdentity? {
        guard let identity = user.identities?.first(where: { $0.provider == "apple" }) else { return nil }
        return AppleIdentity(email: identity.identityData?["email"]?.stringValue)
    }

    /// Signs in with an Apple ID. Only an Apple ID already linked to an account gets in:
    /// the server refuses to create new accounts for anyone not invited.
    func signInWithApple(_ credential: AppleSignIn.Credential) async throws {
        guard let client else { return }
        try await client.auth.signInWithIdToken(credentials: OpenIDConnectCredentials(provider: .apple, idToken: credential.idToken, nonce: credential.rawNonce))
    }

    /// Adds your Apple ID to the account you're signed in to, so Apple signs you in from now on.
    func linkApple(_ credential: AppleSignIn.Credential) async throws {
        guard let client else { return }
        let session = try await client.auth.linkIdentityWithIdToken(credentials: OpenIDConnectCredentials(provider: .apple, idToken: credential.idToken, nonce: credential.rawNonce))
        apple = Self.appleIdentity(of: session.user) ?? AppleIdentity(email: nil)
    }

    #if DIRECT
    /// Where Apple's web sign-in returns to: the app's own URL scheme, caught by the
    /// ASWebAuthenticationSession (it never reaches the app's URL handler).
    static let webCallback = URL(string: "ambernotes://auth-callback")!

    /// Sign in with Apple through the web, for the Mac download: Apple's page in a secure
    /// browser sheet, then Supabase's PKCE exchange. The same Apple ID lands in the same
    /// account as the App Store and iPhone apps (Apple's user id is shared across the team).
    func signInWithAppleOnTheWeb() async throws {
        guard let client else { return }
        try await client.auth.signInWithOAuth(provider: .apple, redirectTo: Self.webCallback, scopes: "name email")
    }

    /// Adds your Apple ID to this account through the web, for the Mac download.
    func linkAppleOnTheWeb() async throws {
        guard let client else { return }
        let link = try await client.auth.getLinkIdentityURL(provider: .apple, scopes: "name email", redirectTo: Self.webCallback)
        let result = try await WebAuthSession.run(link.url, callbackScheme: "ambernotes")
        let session = try await client.auth.session(from: result)
        apple = Self.appleIdentity(of: session.user) ?? AppleIdentity(email: nil)
    }

    /// Closing Apple's sheet isn't an error worth showing.
    nonisolated static func isCanceled(_ error: Error) -> Bool {
        (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
    }
    #endif

    /// Words for an Apple sign-in that didn't work.
    nonisolated static func appleMessage(for error: Error, linking: Bool) -> String {
        if error is URLError { return "Can't reach the server. Check your connection." }
        let raw = (error as? AuthError)?.message ?? error.localizedDescription
        let lower = raw.lowercased()
        if lower.contains("already") && lower.contains("linked") || lower.contains("identity_already_exists") {
            return "That Apple ID already belongs to another account."
        }
        if !linking, lower.contains("private") || lower.contains("not allowed") || lower.contains("hook") {
            return "This Apple ID isn't connected to an Amber Notes account yet. Sign in the old way once, then choose Connect Apple ID in Settings."
        }
        return raw
    }

    /// Email and password sign-in, next to Sign in with Apple.
    func signIn(email: String, password: String) async throws {
        guard let client else { return }
        try await client.auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    /// Whether an email already has an account, for the email-first sign-in (the `account-status`
    /// function). Throws when the server can't answer; the screen then falls back to a password field.
    func accountStatus(email: String) async throws -> AccountStatus {
        guard let client else { throw URLError(.notConnectedToInternet) }
        struct Reply: Decodable { let exists: Bool; let password: Bool }
        let r: Reply = try await client.functions.invoke(
            "account-status",
            options: FunctionInvokeOptions(method: .post, body: ["email": email]))
        if !r.exists { return .new }
        return r.password ? .password : .appleOnly
    }

    /// A new account with email and password (at least 12 characters). Email isn't confirmed,
    /// so the new session starts at once.
    func signUp(email: String, password: String) async throws {
        guard let client else { return }
        try await client.auth.signUp(email: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    /// Words a person can act on, instead of raw server errors.
    static func message(for error: Error, signingUp: Bool) -> String {
        if error is URLError { return "Can't reach the server. Check your connection." }
        let raw = (error as? AuthError)?.message ?? error.localizedDescription
        let lower = raw.lowercased()
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
