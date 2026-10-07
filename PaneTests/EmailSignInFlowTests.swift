import Foundation
import Supabase
import Testing
@testable import Pane

/// The email-first sign-in: one email field, then a password for an existing account or a new
/// one for a new email.
@Suite struct EmailSignInFlowTests {
    @Test func continueNeedsAnEmailThatLooksReal() {
        var f = EmailSignInFlow()
        #expect(f.buttonTitle == "Continue")
        #expect(!f.buttonEnabled)
        f.email = "you@"
        #expect(!f.buttonEnabled)
        let refused = f.beginCheck()
        #expect(!refused)
        f.email = "  you@example.com "
        #expect(f.buttonEnabled)
        let started = f.beginCheck()
        #expect(started)
        #expect(f.step == .checking)
        #expect(f.email == "you@example.com")
        #expect(!f.buttonEnabled, "no second Continue while checking")
        #expect(f.emailLocked)
    }

    @Test func anExistingAccountAsksForItsPassword() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.finishCheck(.password)
        #expect(f.step == .signIn(fallback: false))
        #expect(f.showsPassword)
        #expect(f.buttonTitle == "Sign in")
        #expect(!f.buttonEnabled)
        f.password = "x"
        #expect(f.buttonEnabled)
        #expect(f.action == .signIn)
    }

    @Test func aNewEmailChoosesAPasswordOf12OrMore() {
        var f = EmailSignInFlow(email: "new@example.com")
        _ = f.beginCheck()
        f.finishCheck(.new)
        #expect(f.step == .create)
        #expect(f.buttonTitle == "Create account")
        f.password = "short"
        #expect(!f.buttonEnabled)
        f.password = "twelve chars"
        #expect(f.buttonEnabled)
        #expect(f.action == .create)
    }

    @Test func anAppleAccountHasNoPasswordToAskFor() {
        var f = EmailSignInFlow(email: "apple@example.com")
        _ = f.beginCheck()
        f.finishCheck(.appleOnly)
        #expect(f.step == .apple)
        #expect(!f.showsPassword)
        #expect(f.buttonTitle == nil)
    }

    @Test func aFailedCheckStillLetsYouIn() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.finishCheck(nil)
        #expect(f.step == .signIn(fallback: true))
        #expect(f.showsPassword)
        f.password = "typed"
        f.chooseCreate()
        #expect(f.step == .create)
        #expect(f.password.isEmpty, "switching to a new account clears the password")
    }

    @Test func useADifferentEmailGoesBackAndClears() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.finishCheck(.password)
        f.password = "secret"
        f.back()
        #expect(f.step == .email)
        #expect(f.password.isEmpty)
        #expect(!f.emailLocked)
        #expect(f.email == "you@example.com", "the email stays so you can fix a typo")
    }

    /// Sign in with Apple folds away while a password is asked for (or reset), so the card keeps
    /// its main button in place and fits above the keyboard; everywhere else it's there.
    @Test func signInWithAppleFoldsAwayOnlyForThePassword() {
        var f = EmailSignInFlow(email: "you@example.com")
        #expect(f.showsApple)
        _ = f.beginCheck()
        #expect(f.showsApple, "still there while the email is checked")
        f.finishCheck(.password)
        #expect(!f.showsApple)
        f.back()
        #expect(f.showsApple, "Use a different email brings it back")
        _ = f.beginCheck()
        f.finishCheck(.new)
        #expect(!f.showsApple, "choosing a password too")
        f.back()
        _ = f.beginCheck()
        f.finishCheck(.appleOnly)
        #expect(f.showsApple, "an Apple account signs in with it")
    }

    @Test func aLateAnswerIsIgnoredOnceYouWentBack() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.back()
        f.finishCheck(.password)
        #expect(f.step == .email)
    }

    @Test func forgotPasswordSendsALinkAndComesBack() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.finishCheck(.password)
        #expect(f.offersReset)
        f.password = "half typed"
        f.forgotPassword()
        #expect(f.step == .forgot(sending: false))
        #expect(f.password.isEmpty)
        #expect(!f.showsPassword)
        #expect(f.emailLocked, "the link goes to the email already typed")
        #expect(!f.showsApple, "a password account stays on the password path")
        #expect(f.buttonTitle == "Email me a link")
        let first = f.beginReset()
        let second = f.beginReset()
        #expect(first)
        #expect(!second, "a second press while it goes out sends nothing")
        #expect(!f.buttonEnabled)
        f.finishReset(sent: true)
        #expect(f.step == .forgotSent)
        #expect(!f.showsApple)
        #expect(f.buttonTitle == "Back to sign in")
        f.backToSignIn()
        #expect(f.step == .signIn(fallback: false))
        #expect(f.showsPassword)
    }

    @Test func aResetThatDidntGoOutCanBeSentAgain() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.finishCheck(nil)
        #expect(f.offersReset, "offered when the check failed too")
        f.forgotPassword()
        _ = f.beginReset()
        f.finishReset(sent: false)
        #expect(f.step == .forgot(sending: false))
        #expect(f.buttonEnabled)
    }

    @Test func onlyAnAccountWithAPasswordIsOfferedAReset() {
        for status in [AccountStatus.new, .appleOnly] {
            var f = EmailSignInFlow(email: "you@example.com")
            _ = f.beginCheck()
            f.finishCheck(status)
            #expect(!f.offersReset)
            f.forgotPassword()
            #expect(f.step != .forgot(sending: false))
        }
        var f = EmailSignInFlow(email: "you@example.com")
        #expect(!f.offersReset, "not before the email is checked")
        f.forgotPassword()
        #expect(f.step == .email)
    }

    // MARK: Email confirmation (docs/Technical/email-confirmation.md)

    @Test func aSignUpThatNeedsConfirmingAsksForTheCode() {
        var f = EmailSignInFlow(email: "new@example.com")
        _ = f.beginCheck()
        f.finishCheck(.new)
        f.password = "twelve chars"
        let sent = Date(timeIntervalSince1970: 1_000)
        f.needsConfirmation(sentAt: sent)
        #expect(f.step == .confirm)
        #expect(f.password.isEmpty, "the code signs in; the password isn't kept")
        #expect(!f.showsPassword)
        #expect(!f.showsApple)
        #expect(!f.showsEmailField, "the address shows as text, with Use a different email")
        #expect(f.emailLocked)
        #expect(f.action == .verify)
        #expect(f.buttonTitle == "Confirm")
        #expect(!f.offersReset)
    }

    @Test func theCodeTakesSixDigitsAndNothingElse() {
        var f = EmailSignInFlow(step: .confirm, email: "new@example.com")
        f.code = "12 3-4a"
        #expect(f.code == "1234")
        #expect(!f.buttonEnabled)
        f.code = "123456789"
        #expect(f.code == "123456", "a paste of more keeps the first six")
        #expect(f.buttonEnabled)
        f.code = "١٢٣٤٥٦"
        #expect(f.code.isEmpty, "only ASCII digits: the server's code is")
    }

    @Test func resendWaitsAMinuteAfterEachCode() {
        let sent = Date(timeIntervalSince1970: 1_000)
        var f = EmailSignInFlow(email: "new@example.com")
        _ = f.beginCheck()
        f.finishCheck(.new)
        f.needsConfirmation(sentAt: sent)
        #expect(f.resendWait(now: sent) == 60)
        #expect(f.resendWait(now: sent.addingTimeInterval(59.2)) == 1)
        #expect(f.resendWait(now: sent.addingTimeInterval(60)) == 0)
        f.code = "123"
        f.codeResent(at: sent.addingTimeInterval(61))
        #expect(f.code.isEmpty, "the old code is no good")
        #expect(f.resendWait(now: sent.addingTimeInterval(61)) == 60)
    }

    @Test func signingInBeforeConfirmingGoesToTheCodeWithResendReady() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.finishCheck(.password)
        f.password = "secret"
        f.needsConfirmation(sentAt: nil)
        #expect(f.step == .confirm)
        #expect(f.password.isEmpty)
        #expect(f.resendWait(now: .now) == 0, "no code went out yet: the screen sends one straight away")
    }

    @Test func useADifferentEmailLeavesTheCodeScreen() {
        var f = EmailSignInFlow(email: "new@example.com")
        _ = f.beginCheck()
        f.finishCheck(.new)
        f.needsConfirmation(sentAt: .now)
        f.code = "12345"
        f.back()
        #expect(f.step == .email)
        #expect(f.code.isEmpty)
        #expect(f.codeSentAt == nil)
        #expect(f.showsApple)
    }

    @Test func onlyASignUpOrSignInLeadsToTheCode() {
        for step: EmailSignInFlow.Step in [.email, .checking, .apple, .forgot(sending: false), .forgotSent] {
            var f = EmailSignInFlow(step: step, email: "you@example.com")
            f.needsConfirmation(sentAt: .now)
            #expect(f.step == step)
        }
        var f = EmailSignInFlow(step: .email, email: "you@example.com")
        f.codeResent(at: .now)
        #expect(f.codeSentAt == nil, "a resend answer after leaving changes nothing")
    }

    @Test func confirmationErrorsSayWhatToDo() {
        func api(_ code: String, _ message: String) -> AuthError {
            .api(message: message, errorCode: ErrorCode(rawValue: code), underlyingData: Data(),
                 underlyingResponse: HTTPURLResponse(url: URL(string: "https://x.supabase.co")!, statusCode: 400, httpVersion: nil, headerFields: nil)!)
        }
        #expect(Backend.isEmailNotConfirmed(api("email_not_confirmed", "Email not confirmed")))
        #expect(!Backend.isEmailNotConfirmed(api("invalid_credentials", "Invalid login credentials")))
        #expect(Backend.confirmMessage(for: api("otp_expired", "Token has expired or is invalid")).contains("Resend code"))
        #expect(Backend.confirmMessage(for: api("over_email_send_rate_limit", "For security purposes, you can only request this after 42 seconds.")).contains("Wait a minute"))
        #expect(Backend.confirmMessage(for: URLError(.notConnectedToInternet)).contains("connection"))
        for m in [Backend.confirmMessage(for: api("otp_expired", "")), Backend.confirmMessage(for: api("x", "y")), SignInView.confirmLine, SignInView.confirmTitle] {
            #expect(!m.contains("\u{2014}") && !m.contains("\u{2013}"), "no dashes in what people read")
        }
    }

    @MainActor @Test func theResetRequestIsAPlainRecoverWithNoPKCE() throws {
        let r = Backend.passwordResetRequest(base: URL(string: "https://ref.supabase.co")!, key: "anon", email: " you@example.com ")
        #expect(r.url?.absoluteString == "https://ref.supabase.co/auth/v1/recover")
        #expect(r.httpMethod == "POST")
        #expect(r.value(forHTTPHeaderField: "apikey") == "anon")
        let data = try #require(r.httpBody)
        let body = try JSONSerialization.jsonObject(with: data) as? [String: String]
        #expect(body == ["email": "you@example.com"], "no code_challenge, no redirect: the email's link is the template's")
        #expect(r.url?.query == nil)
    }
}
