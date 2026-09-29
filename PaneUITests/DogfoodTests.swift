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
        app.staticTexts["Welcome to Amber Notes"].firstMatch.tap()
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
        search.tap()
        search.typeText("lisbon")
        pause(1.2)
        shot("search")
        let close = app.buttons["close"].firstMatch.exists ? app.buttons["close"].firstMatch : app.buttons["Close"].firstMatch
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

    func testSubNotes() throws {
        pause(1)
        #if os(iOS)
        openNote("Lisbon")
        #endif
        let chip = app.descendants(matching: .any).matching(identifier: "subnote.Hotel booking").firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 5), "the sub-note shows as a link in its parent")
        shot("subnote-link")
        chip.tap()
        let back = app.descendants(matching: .any).matching(identifier: "subnote.parent").firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 3), "a sub-note leads back to its parent")
        pause(1)
        shot("subnote-open")
    }

    func testFiles() throws {
        pause(1)
        #if os(iOS)
        openNote("Trip documents")
        #endif
        let pdf = app.descendants(matching: .any).matching(identifier: "file.Flight itinerary.pdf").firstMatch
        XCTAssertTrue(pdf.waitForExistence(timeout: 5), "the PDF shows as a file card")
        pause(2)
        shot("files-in-note")
        pdf.tap()
        pause(2)
        shot("pdf-quicklook")
        closePreview()
        pause(1)
        app.descendants(matching: .any).matching(identifier: "file.Tracker export.csv").firstMatch.tap()
        pause(2)
        shot("csv-quicklook")
        closePreview()
        pause(1)
        app.swipeUp()
        pause(2)
        shot("image-and-link")
    }

    /// Scrolls the list until the note is on screen, then opens it.
    func openNote(_ title: String) {
        let row = app.staticTexts[title].firstMatch
        if !(row.exists && row.isHittable) { app.swipeDown(); app.swipeDown() }
        var tries = 0
        while !(row.exists && row.isHittable) && tries < 6 {
            app.swipeUp()
            tries += 1
        }
        row.tap()
    }

    func closePreview() {
        for label in ["Done", "Close", "Dismiss"] where app.buttons[label].firstMatch.exists {
            app.buttons[label].firstMatch.tap()
            return
        }
        app.swipeDown(velocity: .fast)
    }

    func testTracker() throws {
        pause(1)
        #if os(iOS)
        openNote("Evening tracker")
        #endif
        let cell = app.descendants(matching: .any).matching(identifier: "grid.1.0").firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 5), "typed tables show as the same grid as plain tables")
        pause(1)
        shot("tracker-grid")
        let yes = app.descendants(matching: .any).matching(identifier: "grid.1.4").firstMatch
        if yes.exists { yes.tap() }
        pause(1)
        shot("tracker-ticked")
    }

    /// The demo: every feature at a watchable pace.
    func testTour() throws {
        pause(2.5)
        // Tracker: a typed table, ticked in place.
        openNote("Evening tracker")
        pause(2)
        let tick = app.descendants(matching: .any).matching(identifier: "grid.1.4").firstMatch
        if tick.exists { tick.tap() }
        pause(2.5)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(1.2)

        // A sub-note.
        openNote("Lisbon")
        pause(1.5)
        app.descendants(matching: .any).matching(identifier: "subnote.Hotel booking").firstMatch.tap()
        pause(2.5)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(1.2)

        // Files.
        openNote("Trip documents")
        pause(2)
        app.descendants(matching: .any).matching(identifier: "file.Flight itinerary.pdf").firstMatch.tap()
        pause(2.5)
        closePreview()
        pause(1)
        app.swipeUp()
        pause(2)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(1.2)

        // Write a note.
        app.swipeDown(); app.swipeDown()
        app.buttons["list.newNote"].firstMatch.tap()
        pause(1)
        let editor = app.textViews["editor"]
        editor.typeText("Sunday reset\n")
        editor.typeText("Plan the week, **slowly**.\n\n")
        editor.typeText("## Must do\n- [ ] Book the dentist\nCall the bank\n\n")
        editor.typeText("> One thing at a time.")
        pause(1.5)
        app.buttons["editor.done"].firstMatch.tap()
        pause(2.5)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(1.5)

        // Search and folders.
        let searchButton = app.buttons["Search"].firstMatch
        if searchButton.exists { searchButton.tap(); pause(0.6) }
        app.searchFields.firstMatch.tap()
        app.searchFields.firstMatch.typeText("lisbon")
        pause(2)
        closeSearch()
        pause(1)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(2.5)
    }

    func closeSearch() {
        let close = app.buttons["close"].firstMatch.exists ? app.buttons["close"].firstMatch : app.buttons["Close"].firstMatch
        if close.exists { close.tap() } else if app.buttons["Cancel"].firstMatch.exists { app.buttons["Cancel"].firstMatch.tap() }
    }
}
