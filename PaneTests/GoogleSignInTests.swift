import AuthenticationServices
import Foundation
import Supabase
import Testing
@testable import Pane

@Suite struct GoogleSignInTests {
    @Test func googleAlwaysShowsItsChooserAndPutsTheHintFirst() {
        let plain = Backend.googleQuery(hint: nil)
        #expect(plain.map(\.name) == ["prompt"])
        #expect(plain.first?.value == "select_account")
        #expect(Backend.googleQuery(hint: "  ").map(\.name) == ["prompt"])
        let hinted = Backend.googleQuery(hint: " sara@example.com ")
        #expect(hinted.map(\.name) == ["prompt", "login_hint"])
        #expect(hinted.last?.value == "sara@example.com")
    }

    @Test func itComesBackToTheAppsOwnScheme() {
        #expect(Backend.webCallback.absoluteString == "ambernotes://auth-callback")
    }

    @Test func closingTheSheetIsQuiet() {
        #expect(Backend.isCanceled(ASWebAuthenticationSessionError(.canceledLogin)))
        #expect(!Backend.isCanceled(ASWebAuthenticationSessionError(.presentationContextInvalid)))
        #expect(!Backend.isCanceled(URLError(.timedOut)))
    }

    @Test func failuresGetWordsAPersonCanActOn() {
        struct E: LocalizedError { let errorDescription: String? }
        #expect(Backend.googleMessage(for: URLError(.notConnectedToInternet)).contains("connection"))
        #expect(Backend.googleMessage(for: E(errorDescription: "Unsupported provider: provider is not enabled")) == "Sign in with Google isn't available yet.")
        #expect(Backend.googleMessage(for: E(errorDescription: "Signups not allowed for this instance")).contains("Couldn't make an account"))
        #expect(Backend.googleMessage(for: E(errorDescription: "Unverified email with google")).contains("hasn't confirmed"))
        // Anything else: a plain retry line, never the server's raw words.
        #expect(Backend.googleMessage(for: E(errorDescription: "server_error: Database error")) == "Sign in with Google didn't finish. Try again.")
    }

    /// Google's chooser can pick another Google account, which is another Amber Notes account:
    /// Start fresh must never run there.
    @Test func startFreshRunsOnlyOnTheAccountThatAskedForIt() {
        let a = UUID(), b = UUID()
        #expect(KeyGateView.sameAccount(before: a, after: a))
        #expect(!KeyGateView.sameAccount(before: a, after: b))
        #expect(!KeyGateView.sameAccount(before: nil, after: a))
        #expect(!KeyGateView.sameAccount(before: a, after: nil))
    }

    /// developers.google.com/identity/branding-guidelines: the light and dark buttons' colours.
    @Test func theButtonUsesGooglesColours() {
        #expect(GoogleAuthButton.colors(.light) == .init(fill: 0xFFFFFF, stroke: 0x747775, label: 0x1F1F1F))
        #expect(GoogleAuthButton.colors(.dark) == .init(fill: 0x131314, stroke: 0x8E918F, label: 0xE3E3E3))
    }

    @Test func theLogoKeepsGooglesProportionAtTheFormsRowHeights() {
        // Google's 18 pt logo on its 40 pt button; the iPhone row is 48, the Mac row 36.
        #expect(GoogleAuthButton.logoSize(height: 48) == 20)
        #expect(GoogleAuthButton.logoSize(height: 40) == 17)
        #expect(GoogleAuthButton.logoSize(height: 36) == 16)
        #expect(GoogleAuthButton.logoSize(height: 30) == 16)
    }

    @Test func theSignInScreenOffersGoogleAndSaysSoPlainly() {
        #expect(SignInView.offersGoogle)
        #expect(SignInView.noPasswordNote.contains("Apple or Google"))
        #expect(!SignInView.noPasswordNote.contains("\u{2014}"))
    }

    /// The Google button folds away with Apple's for the password, and comes back with it.
    @Test func googleFoldsAwayWithApple() {
        var flow = EmailSignInFlow()
        #expect(flow.showsApple)
        flow.email = "sara@example.com"
        var began = flow.beginCheck()
        #expect(began)
        flow.finishCheck(.password)
        #expect(!flow.showsApple)
        flow.back()
        #expect(flow.showsApple)
        flow.email = "sara@example.com"
        began = flow.beginCheck()
        #expect(began)
        flow.finishCheck(.appleOnly)
        #expect(flow.showsApple, "an account without a password keeps both buttons in view")
    }
}
