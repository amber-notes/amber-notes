#if os(iOS)
import XCTest

/// Where your key is kept, on a real screen: Remove asks first and says what is lost, and Add a
/// device opens its sheet. No account: the capture screens stand in (`AddDeviceCapture`).
final class AddDeviceUITests: XCTestCase {
    func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/add-device-\(name).png"))
    }

    func testRemoveAsksFirstAndSaysUnsyncedNotesAreErased() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "key-kept"]
        app.launch()
        let remove = app.buttons["privacy.removeDevice"].firstMatch
        XCTAssertTrue(remove.waitForExistence(timeout: 8))
        XCTAssertTrue(app.descendants(matching: .any)["privacy.safe"].firstMatch.exists, "a device seen today: safe")
        remove.tap()
        let confirm = app.buttons["privacy.confirmRemove"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "Remove asks before it does anything")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "haven\u{2019}t synced are erased")).firstMatch.exists,
                      "the question says what is lost")
        shot("remove-question")
    }

    func testAddADeviceOpensItsSheetFromPrivacyAndSecurity() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "key-kept-unconfirmed"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["privacy.unconfirmed"].firstMatch.waitForExistence(timeout: 8), "only a Keychain item: not called safe")
        XCTAssertFalse(app.descendants(matching: .any)["privacy.safe"].firstMatch.exists)
        app.buttons["privacy.addDevice"].firstMatch.tap()
        // A simulator has no camera, so the sheet opens on the typed code.
        XCTAssertTrue(app.textFields["addDevice.codeField"].waitForExistence(timeout: 5))
        shot("sheet")
    }
}
#endif
