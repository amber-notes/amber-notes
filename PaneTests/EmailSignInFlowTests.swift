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
        #expect(f.buttonTitle == "Sign In")
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
        #expect(f.buttonTitle == "Create Account")
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

    @Test func aLateAnswerIsIgnoredOnceYouWentBack() {
        var f = EmailSignInFlow(email: "you@example.com")
        _ = f.beginCheck()
        f.back()
        f.finishCheck(.password)
        #expect(f.step == .email)
    }
}
