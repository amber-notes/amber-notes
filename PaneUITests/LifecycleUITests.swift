#if os(iOS)
import XCTest

/// Typing survives leaving the app and being killed there, on the on-disk store (`-local`:
/// no backend, the simulator's own library).
final class LifecycleUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-local"]
    }

    /// Opens the note list from wherever launch restored.
    func toList() {
        let compose = app.buttons["list.newNote"].firstMatch
        if compose.waitForExistence(timeout: 4) { return }
        // On the folder list or in a note: find the way to a list.
        if app.textViews["editor"].exists { app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap() }
        if !compose.waitForExistence(timeout: 2) {
            app.cells.element(boundBy: 0).tap()
        }
        XCTAssertTrue(compose.waitForExistence(timeout: 3))
    }

    func testTypingSurvivesBeingKilledInTheBackground() {
        app.launch()
        toList()
        app.buttons["list.newNote"].firstMatch.tap()
        let editor = app.textViews["editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 3))
        let marker = "Killed \(Int(Date().timeIntervalSince1970))"
        editor.typeText("\(marker)\nwritten just before leaving")
        // Leave at once, before the typing pause would write it, then get killed there.
        XCUIDevice.shared.press(.home)
        app.terminate()
        app.launch()
        let found = app.staticTexts[marker].firstMatch
        if !found.waitForExistence(timeout: 3) { toList() }
        XCTAssertTrue(found.waitForExistence(timeout: 3) || (editor.exists && (editor.value as? String ?? "").contains("written just before leaving")),
                      "the note typed before backgrounding is there after a kill")
    }
}
#endif
