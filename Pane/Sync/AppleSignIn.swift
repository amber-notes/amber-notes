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
    /// The Mac draws its own button; its title matches `label`.
    var title = "Sign in with Apple"
    /// The Mac download (DIRECT) can't carry the Sign in with Apple entitlement, so its button
    /// runs Apple's web sign-in instead; the call site passes that flow here.
    var web: (@MainActor () -> Void)? = nil
    let completion: (Result<AppleSignIn.Credential, AppleSignIn.Failure>) -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var nonce = AppleSignIn.makeNonce()

    var body: some View {
        #if os(macOS)
        // AppKit's Apple button keeps a small fixed height whatever frame it gets, so the Mac
        // draws its own at full height, per Apple's button guidelines: the logo, the standard
        // title, black on light and white on dark, never another colour.
        MacAppleButton(title: title, height: height, scheme: scheme) {
            #if DIRECT
            if let web { web(); return }
            #endif
            let raw = AppleSignIn.makeNonce()
            AppleAuthorizer.shared.run(nonce: raw) { completion(AppleSignIn.credential(from: $0, rawNonce: raw)) }
        }
        #else
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
        #endif
    }
}

#if os(macOS)
private struct MacAppleButton: View {
    let title: String
    let height: CGFloat
    let scheme: ColorScheme
    let action: () -> Void

    var body: some View {
        let dark = scheme == .dark
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "applelogo").font(.system(size: height * 0.4, weight: .medium))
                Text(title).font(.system(size: height * 0.4, weight: .medium))
            }
            .foregroundStyle(dark ? Color.black : Color.white)
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
            .background(dark ? Color.white : Color.black, in: .rect(cornerRadius: height * 0.22, style: .continuous))
            .contentShape(.rect(cornerRadius: height * 0.22, style: .continuous))
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(title)
    }
}

/// Runs Apple's sign-in sheet without Apple's button, for the Mac's custom one.
@MainActor
final class AppleAuthorizer: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    static let shared = AppleAuthorizer()
    private var finish: ((Result<ASAuthorization, Error>) -> Void)?
    private var controller: ASAuthorizationController?

    func run(nonce raw: String, finish: @escaping (Result<ASAuthorization, Error>) -> Void) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email, .fullName]
        request.nonce = AppleSignIn.hashed(raw)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.finish = finish
        self.controller = controller
        controller.performRequests()
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated { done(.success(authorization)) }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated { done(.failure(error)) }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.windows.first ?? NSWindow() }
    }

    private func done(_ result: Result<ASAuthorization, Error>) {
        finish?(result)
        finish = nil
        controller = nil
    }
}
#endif
