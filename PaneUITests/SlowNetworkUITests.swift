#if os(iOS)
import XCTest

/// The app on a slow or missing network, through the debug fault layer (`-netDelay`,
/// `-netOffline`). The build talks to the local stack; with it not running, every request that
/// gets through is refused, which is the "server down" case. Nothing here reaches production.
final class SlowNetworkUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func launch(_ args: [String]) {
        app.launchArguments = args + ["-signout", "-skipWelcome"]
        app.launch()
    }

    private func keep(_ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Slow: each step shows it's working, the screen stays usable, and the failure says why.
    func testSignInOnASlowDeadServer() {
        launch(["-netDelay", "2500"])
        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 8), "the sign-in screen comes up without waiting on the network")
        email.tap()
        email.typeText("qa-slow@example.com\n")
        keep("checking")
        // While the check is out, the screen still answers.
        XCTAssertTrue(app.buttons["signin.submit"].waitForExistence(timeout: 1))
        let password = app.secureTextFields["signin.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 10), "an unanswered check falls back to a password field")
        password.tap()
        password.typeText("not-a-real-password-123")
        let started = Date()
        app.buttons["signin.submit"].tap()
        keep("signing-in")
        let error = app.staticTexts["signin.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 15))
        keep("error")
        XCTAssertEqual(error.label, "Can't reach the server. Check your connection.")
        print("PERF slow dead server: sign-in error after \(Date().timeIntervalSince(started)) s")
        // You can try again straight away.
        XCTAssertTrue(app.buttons["signin.submit"].isEnabled)
    }

    func testSignInOffline() {
        launch(["-netOffline"])
        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 8))
        email.tap()
        email.typeText("qa-offline@example.com\n")
        let password = app.secureTextFields["signin.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 3), "offline, the check gives up at once")
        password.tap()
        password.typeText("not-a-real-password-123\n")
        let error = app.staticTexts["signin.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 3))
        XCTAssertEqual(error.label, "Can't reach the server. Check your connection.")
        XCTAssertEqual((password.value as? String)?.count, "not-a-real-password-123".count, "the password stays for another try")
        keep("offline-error")
    }
}
#endif
