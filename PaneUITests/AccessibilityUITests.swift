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

    /// Folder rows read as their name and count; the icon is decoration (it used to read "Move").
    func testFolderRowsReadAsTheirNames() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo", "-showFolders"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Amber Notes"].waitForExistence(timeout: 5))
        let travel = app.cells.containing(.any, identifier: "folder.Travel").firstMatch
        XCTAssertTrue(travel.waitForExistence(timeout: 3))
        let row = app.descendants(matching: .any).matching(identifier: "folder.Travel").firstMatch
        XCTAssertEqual(row.label, "Travel")
        XCTAssertEqual(row.value as? String, "4 notes")
        XCTAssertEqual(row.elementType, .other, "the row is one element, not an icon and two texts")
    }

    /// The largest accessibility text size: the folder list, a note list and a note stay usable.
    func testLargestDynamicType() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo", "-showFolders", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Amber Notes"].waitForExistence(timeout: 5))
        keep(app, "xxxl-folders")
        app.cells.containing(.any, identifier: "folder.Travel").firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Travel"].waitForExistence(timeout: 3))
        keep(app, "xxxl-list")
        let lisbon = app.staticTexts["Lisbon"].firstMatch
        XCTAssertTrue(lisbon.waitForExistence(timeout: 3))
        lisbon.tap()
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 3))
        keep(app, "xxxl-note")
        XCTAssertTrue(app.navigationBars.buttons.element(boundBy: 0).isHittable, "back stays reachable")
    }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
#endif
