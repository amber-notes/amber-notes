import AuthenticationServices
import CryptoKit
import Foundation
import Testing
@testable import Pane

@Suite struct AppleSignInTests {
    @Test func noncesAreLongRandomAndURLSafe() {
        let a = AppleSignIn.makeNonce(), b = AppleSignIn.makeNonce()
        #expect(a.count == 32)
        #expect(a != b)
        #expect(a.allSatisfy { $0.isLetter || $0.isNumber || "-._".contains($0) })
    }

    @Test func appleGetsTheHashSupabaseGetsTheRawNonce() {
        let raw = "abc"
        // SHA-256("abc"), the standard test vector, as lowercase hex.
        #expect(AppleSignIn.hashed(raw) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func cancelIsQuietOtherFailuresExplain() {
        #expect(AppleSignIn.failure(for: ASAuthorizationError(.canceled)) == .canceled)
        #expect(AppleSignIn.message(for: .canceled) == nil)
        #expect(AppleSignIn.failure(for: ASAuthorizationError(.unknown)) == .unavailable)
        #expect(AppleSignIn.message(for: .unavailable) != nil)
    }

    @Test @MainActor func refusedStrangersGetTold() {
        struct E: LocalizedError { var errorDescription: String? { "Signups not allowed for this instance" } }
        #expect(Backend.appleMessage(for: E(), linking: false).contains("isn't connected"))
        #expect(Backend.appleMessage(for: URLError(.notConnectedToInternet), linking: true).contains("connection"))
    }
}
