import Foundation

/// What the server says about an email (the `account-status` function).
enum AccountStatus: Equatable {
    /// An account that signs in with a password.
    case password
    /// An account made with Sign in with Apple: it has no password.
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
        /// The email belongs to a Sign in with Apple account.
        case apple
    }

    /// What the full-width button does right now.
    enum Action: Equatable { case check, signIn, create }

    static let minimumPassword = 12

    var step: Step = .email
    var email = ""
    var password = ""

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
        }
    }

    var buttonTitle: String? {
        switch action {
        case .check: "Continue"
        case .signIn: "Sign In"
        case .create: "Create Account"
        case nil: nil
        }
    }

    var buttonEnabled: Bool {
        switch step {
        case .email: emailLooksValid
        case .checking, .apple: false
        case .signIn: !password.isEmpty
        case .create: password.count >= Self.minimumPassword
        }
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
    }

    /// "New? Create an account", offered only when the check failed.
    mutating func chooseCreate() {
        guard step == .signIn(fallback: true) else { return }
        step = .create
        password = ""
    }
}
