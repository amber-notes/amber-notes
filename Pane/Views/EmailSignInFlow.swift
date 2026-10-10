import Foundation

/// What the server says about an email (the `account-status` function).
enum AccountStatus: Equatable {
    /// An account that signs in with a password.
    case password
    /// An account with no password: it signs in with Apple or Google (the name stays from when
    /// Apple was the only one).
    case appleOnly
    /// Nobody has this email yet.
    case new
}

/// The email-first sign-in: type your email, Continue, and the screen asks for your password
/// or for a new one, depending on whether the email already has an account. Pure, so it's tested.
struct EmailSignInFlow: Equatable {
    enum Step: Equatable {
        /// Typing the email.
        case email
        /// Asking the server about it.
        case checking
        /// An existing account: enter its password. `fallback` means the check failed, so the
        /// screen also offers "New? Create an account" in case this email is new.
        case signIn(fallback: Bool)
        /// A new email: choose a password.
        case create
        /// The email belongs to an account that signs in with Apple or Google.
        case apple
        /// "Forgot password?": send a reset link to the email. `sending` while it goes out.
        case forgot(sending: Bool)
        /// The link was asked for. The words are the same whether or not an account uses the email.
        case forgotSent
        /// "Check your email": a new account (or one signing in before it was confirmed) types the
        /// 6-digit code the confirmation email carries (docs/Technical/email-confirmation.md).
        case confirm
    }

    /// What the full-width button does right now.
    enum Action: Equatable { case check, signIn, create, sendReset, backToSignIn, verify }

    static let minimumPassword = 12
    /// The confirmation code's digits (the project's mailer_otp_length).
    static let codeLength = 6
    /// How long Resend code waits after a code goes out: Supabase sends one email a minute per
    /// address (smtp_max_frequency).
    static let resendCooldown: TimeInterval = 60

    var step: Step = .email
    var email = ""
    var password = ""
    /// The code being typed or filled in by iOS from the email: digits only, at most six.
    var code = "" {
        didSet {
            let digits = String(code.filter(\.isASCII).filter(\.isNumber).prefix(Self.codeLength))
            if digits != code { code = digits }
        }
    }
    /// When the last code went out, for Resend code's cooldown.
    var codeSentAt: Date?

    var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Good enough to ask about: something@something.something.
    var emailLooksValid: Bool {
        trimmedEmail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    /// Once past the first step, the email is fixed until "Use a different email".
    var emailLocked: Bool { step != .email }

    /// The email stays a field while it's checked, so the keyboard stays up and the card doesn't
    /// jump; it can't be changed meanwhile (`emailLocked`). After that it's text.
    var showsEmailField: Bool { step == .email || step == .checking }

    /// Sign in with Apple and Google, above the email: everywhere but the password and reset steps, where
    /// the email has an account that signs in with a password ("Use a different email" brings
    /// it back).
    var showsApple: Bool {
        switch step {
        case .signIn, .create, .forgot, .forgotSent, .confirm: false
        default: true
        }
    }

    var showsPassword: Bool {
        switch step {
        case .signIn, .create: true
        default: false
        }
    }

    var action: Action? {
        switch step {
        case .email, .checking: .check
        case .signIn: .signIn
        case .create: .create
        case .apple: nil
        case .forgot: .sendReset
        case .forgotSent: .backToSignIn
        case .confirm: .verify
        }
    }

    var buttonTitle: String? {
        switch action {
        case .check: "Continue"
        case .signIn: "Sign in"
        case .create: "Create account"
        case .sendReset: "Email me a link"
        case .backToSignIn: "Back to sign in"
        case .verify: "Confirm"
        case nil: nil
        }
    }

    var buttonEnabled: Bool {
        switch step {
        case .email: emailLooksValid
        case .checking, .apple, .forgot(sending: true): false
        case .signIn: !password.isEmpty
        case .create: password.count >= Self.minimumPassword
        case .forgot(sending: false), .forgotSent: true
        case .confirm: code.count == Self.codeLength
        }
    }

    /// "Forgot password?" sits under the password of an account that has one (or might).
    var offersReset: Bool {
        if case .signIn = step { return true }
        return false
    }

    /// Continue (or Return in the email field): start asking. False if there's nothing to ask.
    mutating func beginCheck() -> Bool {
        guard step == .email, emailLooksValid else { return false }
        email = trimmedEmail
        step = .checking
        return true
    }

    /// The server's answer; nil when it couldn't answer (offline, rate-limited). Then the screen
    /// falls back to a password field, so nobody is stuck.
    mutating func finishCheck(_ status: AccountStatus?) {
        guard step == .checking else { return }
        switch status {
        case .password: step = .signIn(fallback: false)
        case .new: step = .create
        case .appleOnly: step = .apple
        case nil: step = .signIn(fallback: true)
        }
    }

    /// "Use a different email".
    mutating func back() {
        step = .email
        password = ""
        code = ""
        codeSentAt = nil
    }

    /// Sign-up answered "confirm your email first", or signing in found the email not confirmed
    /// yet: the code screen. `sentAt` is when a code went out (nil when none did, so Resend code
    /// is ready at once). The password isn't needed again: the code signs you in.
    mutating func needsConfirmation(sentAt: Date?) {
        switch step {
        case .create, .signIn: break
        default: return
        }
        step = .confirm
        password = ""
        code = ""
        codeSentAt = sentAt
    }

    /// Seconds until Resend code works again; 0 when it does.
    func resendWait(now: Date) -> Int {
        guard let sent = codeSentAt else { return 0 }
        return max(0, Int((sent.addingTimeInterval(Self.resendCooldown).timeIntervalSince(now)).rounded(.up)))
    }

    /// A new code went out.
    mutating func codeResent(at: Date) {
        guard step == .confirm else { return }
        codeSentAt = at
        code = ""
    }

    /// "Forgot password?".
    mutating func forgotPassword() {
        guard offersReset else { return }
        step = .forgot(sending: false)
        password = ""
    }

    /// "Email Me a Link": false if it's already going out.
    mutating func beginReset() -> Bool {
        guard step == .forgot(sending: false) else { return false }
        step = .forgot(sending: true)
        return true
    }

    /// The request went out (`sent`), or didn't reach the server: then the button is back.
    mutating func finishReset(sent: Bool) {
        guard step == .forgot(sending: true) else { return }
        step = sent ? .forgotSent : .forgot(sending: false)
    }

    /// "Back to Sign In", after asking for a link or instead of it: the password field again.
    mutating func backToSignIn() {
        switch step {
        case .forgot(sending: false), .forgotSent: step = .signIn(fallback: false)
        default: break
        }
    }

    /// "New? Create an account", offered only when the check failed.
    mutating func chooseCreate() {
        guard step == .signIn(fallback: true) else { return }
        step = .create
        password = ""
    }
}
