#if os(iOS)
import XCTest

/// Email confirmation end to end on the iPhone, against a real project with confirmation on
/// (staging): Get started, a new email, Create account, Check your email, the 6-digit code from
/// the email, and into the first run. Run by hand with a build pointed at staging
/// (Config/Beta.xcconfig) and three variables (docs/Technical/email-confirmation.md):
/// PANE_CONFIRM_EMAIL, a new address; PANE_CONFIRM_PASSWORD, 12 characters or more; and
/// PANE_CONFIRM_CODE_FILE, a file the code is written to once the email has arrived. Skipped otherwise.
final class EmailConfirmUITests: XCTestCase {
    let env = ProcessInfo.processInfo.environment

    func shot(_ name: String) {
        guard let dir = env["PANE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/confirm-\(name).png"))
    }

    func testSignUpConfirmsWithTheEmailedCode() throws {
        guard let address = env["PANE_CONFIRM_EMAIL"], let password = env["PANE_CONFIRM_PASSWORD"],
              let codeFile = env["PANE_CONFIRM_CODE_FILE"] else { throw XCTSkip("No staging account given") }
        let app = XCUIApplication()
        app.launchArguments = ["-synctest", "-signout"]
        app.launch()

        let start = app.buttons["welcome.start"]
        XCTAssertTrue(start.waitForExistence(timeout: 15), "the welcome")
        start.tap()
        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["signin.title"].label, "Sign in or create your account")
        email.tap()
        email.typeText(address)
        app.buttons["signin.submit"].tap() // Continue

        let secret = app.secureTextFields["signin.password"]
        XCTAssertTrue(secret.waitForExistence(timeout: 15), "a new email chooses a password")
        XCTAssertEqual(app.buttons["signin.submit"].label, "Create account")
        XCTAssertEqual(app.staticTexts["signin.title"].label, "Create your account", "the heading follows the new email")
        secret.typeText(password)
        app.buttons["signin.reveal"].tap()
        XCTAssertTrue(app.textFields["signin.password"].waitForExistence(timeout: 3), "the eye shows the password")
        Thread.sleep(forTimeInterval: 0.8)
        shot("1-create")

        app.buttons["signin.submit"].tap() // Create account
        let code = app.textFields["signin.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 20), "Check your email")
        XCTAssertEqual(app.staticTexts["signin.title"].label, "Check your email")
        XCTAssertTrue(app.buttons["signin.resend"].exists)
        XCTAssertFalse(app.buttons["signin.resend"].isEnabled, "Resend code waits a minute")
        Thread.sleep(forTimeInterval: 0.8)
        shot("2-code")

        // Whoever runs this reads the email and writes the code to the file.
        var typed: String?
        for _ in 0..<300 {
            if let s = try? String(contentsOfFile: codeFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), s.count == 6 {
                typed = s
                break
            }
            Thread.sleep(forTimeInterval: 1)
        }
        let digits = try XCTUnwrap(typed, "no code arrived in \(codeFile)")
        code.tap()
        code.typeText(digits) // six digits confirm on their own

        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: code)
        waitForExpectations(timeout: 30)
        XCTAssertFalse(app.staticTexts["signin.error"].exists)
        Thread.sleep(forTimeInterval: 2)
        shot("3-in")
    }
}
#endif
