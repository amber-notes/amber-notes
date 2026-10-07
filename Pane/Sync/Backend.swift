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

/// When the session last really signed in, read from its access token's `amr` claim (the JWT
/// payload): the newest timestamp of any method except `token_refresh`, the same rule the server
/// uses for a recent sign-in (`pane_signed_in_at`). Start fresh needs one from the last 10 minutes.
///
/// Sign in with Apple (the id token on the iPhone and Mac App Store, OAuth on the web) should add
/// an `id_token` or `oauth` entry; that needs checking on a real device with a real Apple ID.
enum SignInRecency {
    static let window: TimeInterval = 10 * 60

    /// The newest sign-in in the token, or nil when it has none (or isn't a JWT).
    static func signedInAt(accessToken: String) -> Date? {
        let parts = accessToken.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let amr = payload["amr"] as? [[String: Any]] else { return nil }
        let times = amr.compactMap { entry -> Double? in
            guard entry["method"] as? String != "token_refresh" else { return nil }
            return (entry["timestamp"] as? NSNumber)?.doubleValue
        }
        return times.max().map { Date(timeIntervalSince1970: $0) }
    }

    /// Whether the token shows a sign-in in the last 10 minutes.
    static func isRecent(accessToken: String, now: Date = .now) -> Bool {
        guard let at = signedInAt(accessToken: accessToken) else { return false }
        return now.timeIntervalSince(at) <= window
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
    /// Whether a Google account signs in to this account (docs/Technical/google-sign-in.md).
    private(set) var google = false
    let client: SupabaseClient?

    struct AppleIdentity: Equatable {
        /// Apple's email for you: your own, or a private relay address.
        var email: String?
    }

    /// Where the client keeps its session, for reading it once at launch (restoreHeldSession).
    @ObservationIgnored private var sessionStore: AuthLocalStorage?
    @ObservationIgnored private var sessionKey: String?

    init() {
        if BackendConfig.isEnabled, let url = BackendConfig.url, let key = BackendConfig.key {
            let storage = SessionStorage()
            sessionStore = storage
            sessionKey = Self.sessionKey(url)
            client = SupabaseClient(
                supabaseURL: url,
                supabaseKey: key,
                options: SupabaseClientOptions(
                    auth: .init(storage: storage, emitLocalSessionAsInitialSession: true),
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
            // Captures: `-uitest -captureSignedOut` opens the real signed-out window, offline.
            let args = ProcessInfo.processInfo.arguments
            if args.contains("-uitest"), args.contains("-captureSignedOut") { state = .signedOut }
        }
    }

    /// The key the Supabase client stores its session under (its default for the project).
    static func sessionKey(_ url: URL) -> String {
        "sb-\(url.host()?.split(separator: ".").first.map(String.init) ?? "")-auth-token"
    }

    /// Launching: the session this device kept, read once, before anything is drawn, so a signed-in
    /// launch is signed in from its first frame. The client still checks and refreshes it
    /// (watchAuth) and signs out only if it has really ended. Nil when there's no session here
    /// (or it can't be read), and the launch goes on as before.
    @discardableResult
    func restoreHeldSession() -> UUID? {
        guard state == .signedOut, let sessionStore, let sessionKey else { return nil }
        return restore(from: sessionStore, key: sessionKey)
    }

    /// Tests: `restoreHeldSession` from a given store.
    func restore(from store: AuthLocalStorage, key: String) -> UUID? {
        guard let data = try? store.retrieve(key: key), let session = try? JSONDecoder().decode(Session.self, from: data) else { return nil }
        apple = Self.appleIdentity(of: session.user)
        google = Self.hasGoogle(session.user)
        signedIn(session)
        return session.user.id
    }

    /// Tests: a client (on a stubbed network) that counts as signed in, as `userID` when given.
    init(testClient: SupabaseClient, email: String, userID: UUID? = nil) {
        client = testClient
        state = .signedIn(email: email)
        self.userID = userID
    }

    /// Tests: a client (on a stubbed network) whose stored session decides the state, as at launch.
    init(watching testClient: SupabaseClient) {
        client = testClient
        state = .signedOut
        Task { await watchAuth() }
    }

    /// The signed-in account, kept as sign-in, refreshes and sign-out arrive. Asking the client for
    /// its current user reads the session from the Keychain (and runs its storage migrations) each
    /// time, and views read this in their bodies: every update of the window waited on the
    /// Keychain, enough to freeze the app on a slow Keychain.
    private(set) var userID: UUID?

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
        userID = session.user.id
        state = .signedIn(email: session.user.email ?? "")
    }

    /// For screenshots and previews only: shows the signed-in screens without a session.
    func showSignedInForPreview(email: String) { state = .signedIn(email: email) }

    private func watchAuth() async {
        guard let client else { return }
        for await (_, session) in client.auth.authStateChanges {
            apple = session.flatMap { Self.appleIdentity(of: $0.user) }
            google = session.map { Self.hasGoogle($0.user) } ?? false
            if let session, !session.isExpired {
                signedIn(session)
            } else if let session, session.isExpired {
                // Let the SDK refresh; stay signed in if it can, and while offline (an hour after
                // the last refresh, on a plane): the notes are on this device, and the refresh
                // happens with the next request that gets through. A refresh token the server
                // refuses signs out (the SDK removes the session and sends signedOut).
                do {
                    _ = try await client.auth.refreshSession()
                    signedIn(session)
                } catch {
                    if Self.keepsSession(afterRefreshError: error) {
                        signedIn(session)
                    } else {
                        userID = nil
                        state = .signedOut
                    }
                }
            } else {
                userID = nil
                state = .signedOut
            }
        }
    }

    /// A refresh that failed because the server couldn't be reached (offline, a dead connection, a
    /// server that's down, a plane's Wi-Fi answering with its own page) keeps the session; one the
    /// auth server answered and refused doesn't.
    nonisolated static func keepsSession(afterRefreshError error: Error) -> Bool {
        guard let auth = error as? AuthError else { return true }
        // 5xx: the server is there but failing; the token may well be fine.
        if case .api(_, _, _, let response) = auth { return response.statusCode >= 500 }
        return false
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

    static func hasGoogle(_ user: User) -> Bool {
        user.identities?.contains { $0.provider == "google" } ?? false
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

    /// Where a web sign-in (Google, and Apple in the Mac download) returns to: the app's own URL
    /// scheme, caught by the ASWebAuthenticationSession (it never reaches the app's URL handler).
    nonisolated static let webCallback = URL(string: "\(AppIdentity.scheme)://auth-callback")!

    /// Sign in with Google: Google's page in the system's secure browser sheet, through Supabase
    /// (PKCE: the app keeps the verifier, Supabase checks Google's state and nonce), then the
    /// one-time code is swapped for a session. A new Google account makes a new Amber Notes
    /// account; one whose email already has an account joins it (docs/Technical/google-sign-in.md).
    /// `hint` (an email) puts that Google account first in Google's chooser. Returns the account
    /// that's now signed in.
    @discardableResult
    func signInWithGoogle(hint: String? = nil) async throws -> UUID? {
        guard let client else { return nil }
        let session = try await client.auth.signInWithOAuth(provider: .google, redirectTo: Self.webCallback, queryParams: Self.googleQuery(hint: hint)) { url in
            try await WebAuthSession.run(url, callbackScheme: AppIdentity.scheme)
        }
        return session.user.id
    }

    /// Passed on to Google by Supabase: the account chooser every time, so someone with two
    /// Google accounts picks one, and the hinted account first.
    nonisolated static func googleQuery(hint: String?) -> [(name: String, value: String?)] {
        var query: [(name: String, value: String?)] = [(name: "prompt", value: "select_account")]
        if let hint = hint?.trimmingCharacters(in: .whitespacesAndNewlines), !hint.isEmpty {
            query.append((name: "login_hint", value: hint))
        }
        return query
    }

    /// Closing the browser sheet isn't an error worth showing.
    nonisolated static func isCanceled(_ error: Error) -> Bool {
        (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
    }

    /// Words for a Google sign-in that didn't work.
    nonisolated static func googleMessage(for error: Error) -> String {
        if error is URLError { return "Can't reach the server. Check your connection." }
        let raw = (error as? AuthError)?.message ?? error.localizedDescription
        let lower = raw.lowercased()
        if lower.contains("provider is not enabled") || lower.contains("unsupported provider") {
            return "Sign in with Google isn't available yet."
        }
        if lower.contains("not allowed") || lower.contains("hook") {
            return "Couldn't make an account with this Google account. Try Sign in with Apple or your email."
        }
        if lower.contains("email") && (lower.contains("verified") || lower.contains("confirm")) {
            return "Google hasn't confirmed this account's email. Confirm it with Google, then try again."
        }
        return "Sign in with Google didn't finish. Try again."
    }

    #if DIRECT

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
        let result = try await WebAuthSession.run(link.url, callbackScheme: AppIdentity.scheme)
        let session = try await client.auth.session(from: result)
        apple = Self.appleIdentity(of: session.user) ?? AppleIdentity(email: nil)
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

    /// A new account with email and password (at least 12 characters). Returns true when the
    /// server wants the email confirmed first: no session yet, and a 6-digit code is on its way
    /// (docs/Technical/email-confirmation.md). With confirmation off, the session starts at once.
    func signUp(email: String, password: String) async throws -> Bool {
        guard let client else { return false }
        let response = try await client.auth.signUp(email: email.trimmingCharacters(in: .whitespaces), password: password)
        return response.session == nil
    }

    /// The code from the confirmation email: confirms the address and signs in, so the normal
    /// first run follows from the session.
    func confirmSignUp(email: String, code: String) async throws {
        guard let client else { return }
        try await client.auth.verifyOTP(email: email.trimmingCharacters(in: .whitespaces), token: code, type: .signup)
    }

    /// A new confirmation code. Supabase sends at most one a minute to an address.
    func resendSignUpCode(email: String) async throws {
        guard let client else { return }
        try await client.auth.resend(email: email.trimmingCharacters(in: .whitespaces), type: .signup)
    }

    /// Signing in to an account whose email isn't confirmed yet.
    nonisolated static func isEmailNotConfirmed(_ error: Error) -> Bool {
        guard let auth = error as? AuthError else { return false }
        return auth.errorCode == .emailNotConfirmed || auth.message.lowercased().contains("email not confirmed")
    }

    /// Words for the code screen: a code that didn't work, or a resend too soon.
    nonisolated static func confirmMessage(for error: Error) -> String {
        if error is URLError { return "Can't reach the server. Check your connection and try again." }
        let code = (error as? AuthError)?.errorCode.rawValue
        let lower = ((error as? AuthError)?.message ?? error.localizedDescription).lowercased()
        if lower.contains("error sending") { return "Couldn't send the email with your code. Try again in a minute." }
        if code == "over_email_send_rate_limit" || code == "over_request_rate_limit" || lower.contains("rate limit") || lower.contains("only request this after") {
            return "We just sent a code. Wait a minute, then press Resend code."
        }
        if code == "otp_expired" || lower.contains("expired") || lower.contains("invalid") {
            return "That code didn't work. Check the newest email from Amber Notes, or press Resend code."
        }
        return "Couldn't confirm your email. Try again in a moment."
    }

    /// "Forgot password?": Supabase emails a link to ambernotes.app/reset-password, where the new
    /// password is chosen (docs/Technical/password-reset.md). A plain request rather than
    /// `auth.resetPasswordForEmail`, which adds a PKCE challenge: that link could only be opened in
    /// the browser that asked, and here nothing asks from a browser. Whatever the server answers
    /// counts as sent, so the screen says the same for every email; it throws only when the server
    /// can't be reached.
    func requestPasswordReset(email: String) async throws {
        guard let url = BackendConfig.url, let key = BackendConfig.key else { throw URLError(.notConnectedToInternet) }
        _ = try await AppNetwork.session.data(for: Self.passwordResetRequest(base: url, key: key, email: email))
    }

    nonisolated static func passwordResetRequest(base: URL, key: String, email: String) -> URLRequest {
        var request = URLRequest(url: base.appending(path: "auth/v1/recover"), timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["email": email.trimmingCharacters(in: .whitespacesAndNewlines)])
        return request
    }

    /// Words a person can act on, instead of raw server errors.
    nonisolated static func message(for error: Error, signingUp: Bool) -> String {
        if error is URLError { return "Can't reach the server. Check your connection." }
        let raw = (error as? AuthError)?.message ?? error.localizedDescription
        let lower = raw.lowercased()
        if lower.contains("error sending") { return "Couldn't send the email with your code. Try again in a minute." }
        if lower.contains("already") { return "That email already has an account. Sign in instead." }
        if lower.contains("invalid login") || lower.contains("invalid credentials") { return "That email and password didn't match." }
        if lower.contains("password") && signingUp { return "Pick a longer password: at least 12 characters." }
        if lower.contains("email") && lower.contains("invalid") { return "That doesn't look like an email address." }
        return raw
    }

    func signOut() async {
        // No more pushes for this account here: this device's token row goes while the session
        // can still delete it, then the device stops registering.
        await PushRegistration.shared.signingOut()
        try? await client?.auth.signOut()
    }
}
