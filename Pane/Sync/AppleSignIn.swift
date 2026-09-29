import AuthenticationServices
import CryptoKit
import Foundation
import SwiftUI

/// Sign in with Apple, handed to Supabase as an ID token.
///
/// Apple signs the SHA-256 of a one-time nonce into its ID token; Supabase gets the
/// raw nonce and checks the hash, so a token can't be replayed for another sign-in.
enum AppleSignIn {
    struct Credential: Equatable {
        var idToken: String
        var rawNonce: String
    }

    enum Failure: Error, Equatable {
        /// You closed the Apple sheet: not an error worth showing.
        case canceled
        /// This build can't use Sign in with Apple (unsigned development builds).
        case unavailable
        case failed(String)
    }

    /// A fresh random nonce: 32 characters from an unambiguous alphabet.
    static func makeNonce(length: Int = 32) -> String {
        let alphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        if SecRandomCopyBytes(kSecRandomDefault, length, &bytes) != errSecSuccess {
            bytes = (0..<length).map { _ in UInt8.random(in: 0...255) }
        }
        return String(bytes.map { alphabet[Int($0) % alphabet.count] })
    }

    /// What goes in Apple's request: the hex SHA-256 of the raw nonce.
    static func hashed(_ nonce: String) -> String {
        SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Reads the ID token out of Apple's answer.
    static func credential(from result: Result<ASAuthorization, Error>, rawNonce: String) -> Result<Credential, Failure> {
        switch result {
        case .success(let auth):
            guard let apple = auth.credential as? ASAuthorizationAppleIDCredential,
                  let data = apple.identityToken, let token = String(data: data, encoding: .utf8) else {
                return .failure(.failed("Apple didn't send a sign-in token. Try again."))
            }
            return .success(Credential(idToken: token, rawNonce: rawNonce))
        case .failure(let error):
            return .failure(failure(for: error))
        }
    }

    static func failure(for error: Error) -> Failure {
        if let e = error as? ASAuthorizationError {
            switch e.code {
            case .canceled: return .canceled
            // Unsigned builds lack the entitlement and fail straight away with these.
            case .unknown, .notHandled, .invalidResponse: return .unavailable
            default: break
            }
        }
        return .failed(error.localizedDescription)
    }

    static func message(for failure: Failure) -> String? {
        switch failure {
        case .canceled: nil
        case .unavailable: "Sign in with Apple isn't available in this build."
        case .failed(let why): why
        }
    }
}

/// Apple's own button, styled for the current appearance, producing a checked credential.
struct AppleAuthButton: View {
    var label: SignInWithAppleButton.Label = .signIn
    var height: CGFloat = 44
    let completion: (Result<AppleSignIn.Credential, AppleSignIn.Failure>) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var nonce = AppleSignIn.makeNonce()

    var body: some View {
        SignInWithAppleButton(label) { request in
            nonce = AppleSignIn.makeNonce()
            request.requestedScopes = [.email, .fullName]
            request.nonce = AppleSignIn.hashed(nonce)
        } onCompletion: { result in
            completion(AppleSignIn.credential(from: result, rawNonce: nonce))
        }
        .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
        .frame(height: height)
        // Re-create on appearance change so the button restyles.
        .id(scheme)
    }
}
