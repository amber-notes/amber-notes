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

    /// Shipped bug (1.2 and before): the sheet was attached to a form section and never came up
    /// on iPhone, so "Save a recovery key…" did nothing after Face ID. It hangs on its button now.
    func testSaveARecoveryKeyOpensItsSheet() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "key-kept-only"]
        app.launch()
        let save = app.buttons["privacy.saveRecovery"].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["privacy.recoveryStatus"].firstMatch.label.contains("Not saved"), "no other way in is known: not called optional")
        save.tap()
        XCTAssertTrue(app.descendants(matching: .any)["recovery.key"].firstMatch.waitForExistence(timeout: 5), "the sheet with the key comes up")
        XCTAssertTrue(app.buttons["recovery.copy"].firstMatch.exists)
        shot("save-recovery-key")
    }

    func testCantConfirmSaysItInTwoSentencesAndShowsWhereToLookOnRequest() {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-captureScreen", "key-kept-unconfirmed"]
        app.launch()
        let how = app.buttons["privacy.howToCheck"].firstMatch
        XCTAssertTrue(how.waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts["privacy.howToCheckDetail"].firstMatch.exists)
        shot("cant-confirm")
        how.tap()
        XCTAssertTrue(app.staticTexts["privacy.howToCheckDetail"].firstMatch.waitForExistence(timeout: 3))
        shot("cant-confirm-how-to-check")
    }
}
#endif
