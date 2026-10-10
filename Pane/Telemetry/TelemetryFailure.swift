import Foundation
import Supabase
import SwiftData

// An error, as an event may say it: what type it was and its codes. Never its description or
// message: those are written for people, and can hold a file name, a title or an address.

extension FailureSummary {
    init(_ error: Error) {
        if let u = error as? URLError {
            let kind: FailureKind = switch u.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff, .callIsActive: .offline
            case .timedOut: .timeout
            case .cancelled: .cancelled
            default: .network
            }
            self.init(kind: kind, status: u.code.rawValue)
        } else if let p = error as? PostgrestError {
            self.init(kind: .database, status: nil, code: ServerCode(p.code), hint: ServerHint(p.hint))
        } else if let s = error as? StorageError {
            self.init(kind: .storage, status: s.statusCode.flatMap { Int($0) })
        } else if let a = error as? AuthError {
            if case .api(_, _, _, let response) = a {
                self.init(kind: .auth, status: response.statusCode)
            } else {
                self.init(kind: .auth, status: nil)
            }
        } else if case .httpError(let code, _)? = error as? FunctionsError {
            self.init(kind: .http, status: code)
        } else if error is Wire.Unsealable || error is NoteCrypto.Failure || error is E2EE.Failure {
            self.init(kind: .crypto, status: nil)
        } else if let e = error as? EncodingError, case .invalidValue(_, let c) = e, c.underlyingError is Wire.Unsealable {
            self.init(kind: .crypto, status: nil)
        } else if error is DecodingError || error is EncodingError {
            self.init(kind: .decoding, status: nil)
        } else if let c = error as? CocoaError {
            self.init(kind: .file, status: c.code.rawValue)
        } else if error is CancellationError {
            self.init(kind: .cancelled, status: nil)
        } else {
            self.init(kind: .other, status: nil)
        }
    }
}

extension SignInFailureKind {
    /// The kind and HTTP status of a sign-in that didn't work. Nil for one the person closed
    /// themselves, which isn't a failure.
    static func of(_ error: Error) -> (kind: SignInFailureKind, status: Int?)? {
        if Backend.isCanceled(error) || error is CancellationError { return nil }
        if error is URLError { return (.network, nil) }
        guard let auth = error as? AuthError else { return (.other, nil) }
        var status: Int?
        if case .api(_, _, _, let response) = auth { status = response.statusCode }
        let kind: SignInFailureKind = switch auth.errorCode.rawValue {
        case "invalid_credentials": .wrongCredentials
        case "email_not_confirmed": .emailNotConfirmed
        case "over_request_rate_limit", "over_email_send_rate_limit": .rateLimited
        case "signup_disabled", "user_banned", "provider_disabled", "email_provider_disabled": .notAllowed
        case "user_already_exists", "email_exists", "identity_already_exists": .alreadyExists
        case "weak_password": .weakPassword
        case "otp_expired": .badCode
        default: (status ?? 0) >= 500 ? .server : .other
        }
        return (kind, status)
    }
}

extension ErrorDomain {
    /// A store error's domain and number. The number says which error (a migration that failed,
    /// a full disk); the words that come with it are left behind.
    static func of(_ error: Error) -> (domain: ErrorDomain, code: Int) {
        let e = error as NSError
        let domain: ErrorDomain = switch e.domain {
        case NSCocoaErrorDomain: .cocoa
        case "NSSQLiteErrorDomain": .sqlite
        case NSPOSIXErrorDomain: .posix
        case let d where d.contains("SwiftData"): .swiftData
        default: .other
        }
        return (domain, e.code)
    }
}

/// A failure that keeps happening: said once it has lasted a minute over at least three tries,
/// so a train tunnel or one slow answer isn't reported.
struct FailureStreak: Equatable, Sendable {
    private(set) var runs = 0
    private var since: Date?
    private var said = false
    static let minimumRuns = 3
    static let minimumTime: TimeInterval = 60

    /// True the one time the streak becomes worth reporting.
    mutating func failed(at now: Date = .now) -> Bool {
        runs += 1
        let start = since ?? now
        since = start
        guard !said, runs >= Self.minimumRuns, now.timeIntervalSince(start) >= Self.minimumTime else { return false }
        said = true
        return true
    }

    mutating func succeeded() { self = FailureStreak() }
}

extension ModelContext {
    /// `try? save()`, with a failure reported: the caller goes on either way, as it always has, but
    /// a library that can't be written (a full disk, a store that didn't migrate) is no longer silent.
    func saveOrReport() {
        do { try save() } catch {
            let (domain, code) = ErrorDomain.of(error)
            Telemetry.shared.record(.storeSaveFailed(domain, code: code))
        }
    }
}
