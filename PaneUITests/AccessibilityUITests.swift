#if os(iOS)
import XCTest

/// What VoiceOver hears on the main screens.
final class AccessibilityUITests: XCTestCase {
    func testLabelsOnListAndTable() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo"]
        app.launch()
        XCTAssertTrue(app.buttons["list.select"].waitForExistence(timeout: 5))
        let pinned = app.descendants(matching: .any)["note.Evening tracker"].firstMatch
        XCTAssertTrue(pinned.waitForExistence(timeout: 3))
        XCTAssertEqual(pinned.value as? String, "Pinned")
        app.staticTexts["Welcome to Amber Notes"].firstMatch.tap()
        let cell = app.descendants(matching: .any)["grid.1.0"].firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 5))
        XCTAssertEqual(cell.label, "⌘B, Shortcut, row 1")
        XCTAssertTrue(app.buttons["New Note"].firstMatch.exists, "toolbar buttons are named")
    }
}
#endif
