import XCTest

/// Uses the app the way a person would, at a watchable pace, saving a
/// screenshot per step to $PANE_SHOTS (default /tmp/pane-shots).
final class DogfoodTests: XCTestCase {
    var app: XCUIApplication!
    var step = 0

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo"]
        app.launch()
    }

    func shot(_ name: String) {
        step += 1
        let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? "/tmp/pane-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: "\(dir)/\(String(format: "%02d", step))-\(name).png"))
    }

    func pause(_ s: Double = 0.8) { Thread.sleep(forTimeInterval: s) }

    func testEverydayFlow() throws {
        pause(1.5)
        shot("list")

        // Open the welcome note and read it.
        app.staticTexts["Welcome to Pane"].firstMatch.tap()
        pause(1.2)
        shot("welcome-note")

        // Write a new note with markdown.
        let editor = app.textViews["editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 3))
        #if os(iOS)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause()
        app.buttons["list.newNote"].firstMatch.tap()
        #else
        app.buttons["list.newNote"].firstMatch.tap()
        #endif
        pause()
        let newEditor = app.textViews["editor"]
        XCTAssertTrue(newEditor.waitForExistence(timeout: 3))
        newEditor.tap()
        newEditor.typeText("Weekend plan\n")
        newEditor.typeText("Keep it **light** and *slow*.\n\n")
        newEditor.typeText("## Saturday\n")
        newEditor.typeText("- Farmers market\nCoffee with Sam\n\n")
        newEditor.typeText("- [ ] Book the table\nWater the plants\n\n")
        newEditor.typeText("> Nothing urgent.\n")
        pause()
        shot("typed-note")

        // Check off an item by tapping its circle.
        let text = newEditor.value as? String ?? ""
        XCTAssertTrue(text.contains("- Coffee with Sam"), "Return should continue a bullet list")
        XCTAssertTrue(text.contains("- [ ] Water the plants"), "Return should continue a checklist")

        // Format menu.
        app.buttons["editor.format"].firstMatch.tap()
        pause()
        shot("format-menu")
        app.buttons["Bold"].firstMatch.tap()
        pause()

        #if os(iOS)
        // Hide the keyboard and go back to the list.
        app.buttons["editor.done"].firstMatch.tap()
        pause()
        shot("note-read")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause()
        shot("list-after-new")

        // Search.
        let searchButton = app.buttons["Search"].firstMatch
        if searchButton.exists { searchButton.tap(); pause(0.5) }
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.typeText("lisbon")
        pause(1.2)
        shot("search")
        let close = app.buttons["Close"].firstMatch
        if close.exists { close.tap() } else { app.buttons["Cancel"].firstMatch.tap() }
        pause()

        // Swipe to delete.
        let row = app.staticTexts["Packing"].firstMatch
        if row.exists {
            row.swipeLeft()
            pause()
            shot("swipe")
            app.buttons["Delete"].firstMatch.tap()
            pause()
        }

        // Folders.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(1.2)
        shot("folders")
        app.buttons["sidebar.newFolder"].firstMatch.tap()
        pause()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("Personal")
        shot("new-folder")
        app.alerts.buttons["Create"].tap()
        pause(1.2)
        shot("in-new-folder")
        #endif
    }
}
