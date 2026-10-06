#if os(iOS)
import XCTest

/// Walks a fresh install through sign-in, the key gate and into the library at a person's pace,
/// for a screen recording of the whole flow (the sign-in jank audit). Writes `marks.txt` to
/// FLOW_DIR: one line per step, "<unix seconds> <step>", so frames can be tied to steps.
/// Needs PANE_EMAIL, PANE_PASSWORD, PANE_RECOVERY and FLOW_DIR; skips without them.
final class SignInFlowRecordingTests: XCTestCase {
    func testWholeFlow() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["PANE_EMAIL"], let password = env["PANE_PASSWORD"], let recovery = env["PANE_RECOVERY"],
              let dir = env["FLOW_DIR"] else { throw XCTSkip("no demo account") }
        var marks = ""
        func mark(_ step: String) {
            marks += "\(Date().timeIntervalSince1970) \(step)\n"
            try? marks.write(toFile: "\(dir)/marks.txt", atomically: true, encoding: .utf8)
        }
        func pause(_ s: TimeInterval = 1.5) { Thread.sleep(forTimeInterval: s) }

        let app = XCUIApplication()
        app.launchArguments = ["-synctest", "-signout", "-skipWelcome"]
        mark("launch")
        app.launch()
        let field = app.textFields["signin.email"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        mark("signin.shown"); pause(2)

        // A fresh simulator introduces its keyboard once: out of the way before the recording counts.
        field.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        app.staticTexts["Sign in to Amber Notes"].swipeDown(); pause()
        mark("email.tap"); field.tap(); pause()
        // The keyboard down and up again, the way a person does it.
        mark("keyboard.dismiss"); app.staticTexts["Sign in to Amber Notes"].swipeDown(); pause()
        mark("email.tap2"); field.tap(); pause()
        mark("email.type"); field.typeText(email); pause()
        mark("continue.tap"); app.buttons["signin.submit"].tap()
        let pw = app.secureTextFields["signin.password"]
        XCTAssertTrue(pw.waitForExistence(timeout: 15))
        mark("password.shown"); pause()
        // A wrong password first: the error line comes and goes.
        mark("password.typeWrong"); pw.tap(); pw.typeText("not-the-password-1"); pause(0.6)
        mark("signin.tapWrong"); app.buttons["signin.submit"].tap()
        let error = app.staticTexts["signin.error"]
        _ = error.waitForExistence(timeout: 15)
        mark("error.shown"); pause()
        pw.tap()
        pw.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 24))
        mark("password.type"); pw.typeText(password); pause(0.6)
        mark("signin.tap"); app.buttons["signin.submit"].tap()

        let useRecovery = app.buttons["e2ee.useRecovery"]
        let recoveryField = app.textFields["e2ee.recovery"]
        let gateDeadline = Date().addingTimeInterval(60)
        while Date() < gateDeadline && !useRecovery.exists { Thread.sleep(forTimeInterval: 0.2) }
        mark("gate.shown"); pause(3)
        mark("useRecovery.tap"); useRecovery.tap()
        XCTAssertTrue(recoveryField.waitForExistence(timeout: 10), "the recovery key screen")
        XCTAssertEqual(recoveryField.label, "Recovery key",
                       "VoiceOver must read \"Recovery key\" — not the placeholder")
        mark("recovery.shown"); pause()
        mark("recovery.tap"); recoveryField.tap(); pause()
        mark("recovery.type"); recoveryField.typeText(recovery); pause()
        mark("unlock.tap"); app.buttons["e2ee.submit"].tap()

        let go = app.buttons["e2ee.continue"]
        XCTAssertTrue(go.waitForExistence(timeout: 60), "the welcome screen")
        mark("welcome.shown"); pause(2)
        mark("welcome.tap"); go.tap()
        _ = app.navigationBars.firstMatch.waitForExistence(timeout: 30)
        mark("library.shown"); pause(5)
        mark("end")
    }
}
#endif
