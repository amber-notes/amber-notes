#if DIRECT
import AppKit
import AuthenticationServices

/// Runs one web sign-in in the system's secure browser sheet and hands back the URL it
/// returned to (for Apple on the web in the Mac download).
@MainActor
enum WebAuthSession {
    static func run(_ url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let anchor = Anchor()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { result, error in
                _ = anchor // keep the presentation anchor alive until the sheet finishes
                if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: error ?? ASWebAuthenticationSessionError(.canceledLogin)) }
            }
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = false
            if !session.start() { continuation.resume(throwing: ASWebAuthenticationSessionError(.presentationContextInvalid)) }
        }
    }

    private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.windows.first ?? NSWindow() }
        }
    }
}
#endif
