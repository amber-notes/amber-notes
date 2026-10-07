#if os(iOS)
import XCTest

/// Forgot password? on the iPhone sign-in card, against the LOCAL stack: an existing account's
/// email, Continue, Forgot password?, Email me a link, and the same "we've sent it a link" for
/// every email. Run by hand with a build pointed at the local stack and an account made there
/// (docs/Technical/password-reset.md); skipped otherwise.
final class PasswordResetUITests: XCTestCase {
    let env = ProcessInfo.processInfo.environment

    func shot(_ name: String) {
        guard let dir = env["PANE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/reset-\(name).png"))
    }

    func testForgotPasswordSendsALink() throws {
        guard let address = env["PANE_RESET_EMAIL"] else { throw XCTSkip("No local account given") }
        let app = XCUIApplication()
        app.launchArguments = ["-synctest", "-signout", "-skipWelcome"]
        app.launch()

        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10), "sign-in screen")
        email.tap()
        email.typeText(address)
        app.buttons["signin.submit"].tap() // Continue
        XCTAssertTrue(app.secureTextFields["signin.password"].waitForExistence(timeout: 10), "an existing account asks for its password")
        let forgot = app.buttons["signin.forgot"]
        XCTAssertTrue(forgot.waitForExistence(timeout: 3))
        Thread.sleep(forTimeInterval: 0.8)
        shot("1-password")

        forgot.tap()
        XCTAssertTrue(app.staticTexts["signin.forgotNote"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.secureTextFields["signin.password"].exists, "no password field while asking for a link")
        XCTAssertEqual(app.buttons["signin.submit"].label, "Email me a link")
        Thread.sleep(forTimeInterval: 0.8)
        shot("2-forgot")

        app.buttons["signin.submit"].tap()
        XCTAssertTrue(app.staticTexts["signin.resetSent"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["signin.error"].exists)
        Thread.sleep(forTimeInterval: 0.8)
        shot("3-sent")

        app.buttons["signin.submit"].tap() // Back to sign in
        XCTAssertTrue(app.secureTextFields["signin.password"].waitForExistence(timeout: 3))
    }
}
#endif
