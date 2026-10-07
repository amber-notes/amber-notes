#if os(iOS)
import XCTest

/// The code boxes on the iPhone, with no backend (a capture screen): typing fills the boxes
/// left to right, backspace goes back, VoiceOver hears one "Verification code" field with its
/// digits, and the sixth digit confirms on its own.
final class CodeBoxesUITests: XCTestCase {
    func testTypingBackspaceAndTheSixthDigit() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "welcome-confirm"]
        app.launch()

        let code = app.textFields["signin.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 10))
        XCTAssertEqual(code.label, "Verification code")
        code.tap()
        code.typeText("123")
        XCTAssertEqual(code.value as? String, "1 2 3")
        code.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(code.value as? String, "1 2", "backspace takes the last digit")
        code.typeText("3456")
        // Six digits confirm without Confirm: with no backend the try ends at once, and the
        // field is still there with its six digits and no error.
        XCTAssertEqual(code.value as? String, "1 2 3 4 5 6")
        XCTAssertFalse(app.staticTexts["signin.error"].exists)
        XCTAssertTrue(app.buttons["signin.submit"].exists, "Confirm stays as a fallback")
    }
}
#endif
