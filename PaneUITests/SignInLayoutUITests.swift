#if os(iOS)
import XCTest

/// The iPhone sign-in card (TestFlight 1.1.1): it jumped when the keyboard came up and again
/// while Continue worked, the address was cut short beside "Use a different email", and the
/// password field wasn't focused, so a paste landed on the email row. Then (the video takes):
/// the password step put Sign In under the keyboard.
final class SignInLayoutUITests: XCTestCase {
    func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/signin-\(name).png"))
    }

    func testCardStaysPutAndTheAddressFits() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "signin"]
        app.launch()
        let apple = app.descendants(matching: .any)["signin.apple"].firstMatch
        XCTAssertTrue(apple.waitForExistence(timeout: 5))
        let title = app.staticTexts["Sign in to Amber Notes"]
        let top = title.frame.minY
        let email = app.textFields["signin.email"]
        email.tap()
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(title.frame.minY, top, accuracy: 1, "the keyboard doesn't move the card")
        let submit = app.buttons["signin.submit"]
        let buttonTop = submit.frame.minY
        let address = "appreview@norditech.se"
        email.typeText(address)
        shot("email")
        app.buttons["signin.submit"].tap()
        let password = app.secureTextFields["signin.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 3))
        Thread.sleep(forTimeInterval: 1)
        shot("password")
        XCTAssertTrue((password.value(forKey: "hasKeyboardFocus") as? Bool) ?? false, "the password field has the keyboard")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "the keyboard stays up for the password")
        let locked = app.staticTexts["signin.lockedEmail"]
        XCTAssertEqual(locked.label, address, "the whole address shows")
        let back = app.buttons["signin.back"]
        XCTAssertGreaterThanOrEqual(back.frame.minY, locked.frame.maxY, "Use a different email sits on its own line")
        XCTAssertEqual(title.frame.minY, top, accuracy: 1, "the card keeps its place through the check")
        // Sign in with Apple folds away for the password, so the button never drops below where
        // Continue was, above the keyboard (it went under it, and tapping it scrolled the card up
        // in one jump). With Google's row folding too, it rises by that row.
        XCTAssertFalse(apple.exists, "the Apple row folds away for the password")
        XCTAssertLessThanOrEqual(submit.frame.minY, buttonTop + 2, "the main button never drops")
        XCTAssertLessThanOrEqual(submit.frame.maxY, app.keyboards.firstMatch.frame.minY, "the main button is above the keyboard")
        // Back to the email: Sign in with Apple comes back. The tap lands mid-row, right of the
        // words, which did nothing while only the words took taps.
        app.buttons["signin.back"].tap()
        XCTAssertTrue(apple.waitForExistence(timeout: 3), "Use a different email brings Sign in with Apple back")
    }

    /// Sign in with Google: directly under Sign in with Apple (which stays first, App Review
    /// guideline 4.8), the same size, above the email; it folds away with Apple's for a password.
    func testGoogleSitsUnderAppleAtTheSameSize() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "signin"]
        app.launch()
        let apple = app.descendants(matching: .any)["signin.apple"].firstMatch
        let google = app.buttons["signin.google"]
        XCTAssertTrue(apple.waitForExistence(timeout: 5))
        XCTAssertTrue(google.exists, "Sign in with Google is offered")
        XCTAssertEqual(google.label, "Sign in with Google")
        XCTAssertGreaterThanOrEqual(google.frame.minY, apple.frame.maxY, "Google comes after Apple")
        XCTAssertLessThanOrEqual(google.frame.minY - apple.frame.maxY, 16, "directly under it")
        XCTAssertEqual(google.frame.height, apple.frame.height, accuracy: 1, "the same height")
        XCTAssertEqual(google.frame.width, apple.frame.width, accuracy: 1, "the same width")
        let email = app.textFields["signin.email"]
        XCTAssertGreaterThan(email.frame.minY, google.frame.maxY, "the email comes after both")
        shot("google")
        email.tap()
        email.typeText("appreview@norditech.se")
        app.buttons["signin.submit"].tap()
        XCTAssertTrue(app.secureTextFields["signin.password"].waitForExistence(timeout: 3))
        XCTAssertFalse(google.exists, "the Google row folds away for the password")
        app.buttons["signin.back"].tap()
        XCTAssertTrue(google.waitForExistence(timeout: 3), "and comes back with Apple's")
    }
}
#endif
