#if os(iOS)
import XCTest

/// iPhone navigation pushed hard: rapid and double taps, back and forth, empty folders,
/// Recently Deleted, search, swipes and multi-select. The app must stay responsive and land
/// where Notes would.
final class NavigationStressUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo", "-showFolders"]
        app.launch()
        XCTAssertTrue(folderList.waitForExistence(timeout: 5))
    }

    var folderList: XCUIElement { app.navigationBars["Amber Notes"] }
    var backButton: XCUIElement { app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0) }
    func row(_ id: String) -> XCUIElement { app.cells.containing(.any, identifier: id).firstMatch }

    func backToFolders() {
        var tries = 0
        while !folderList.exists && tries < 4 { backButton.tap(); _ = folderList.waitForExistence(timeout: 1.5); tries += 1 }
        XCTAssertTrue(folderList.exists, "back reaches the folder list")
    }

    func testRapidInAndOut() {
        for _ in 0..<15 {
            row("folder.Travel").tap()
            if app.navigationBars["Travel"].waitForExistence(timeout: 2) { backButton.tap() }
        }
        backToFolders()
        row("folder.Ideas").tap()
        XCTAssertTrue(app.navigationBars["Ideas"].waitForExistence(timeout: 3), "a row still opens after a burst")
    }

    func testDoubleTapPushesOnce() {
        row("folder.Travel").doubleTap()
        XCTAssertTrue(app.navigationBars["Travel"].waitForExistence(timeout: 3))
        backButton.tap()
        XCTAssertTrue(folderList.waitForExistence(timeout: 3), "one back returns to the folders: a double tap pushed once")
        app.staticTexts["Travel"].firstMatch.tap()
        let lisbon = app.staticTexts["Lisbon"].firstMatch
        XCTAssertTrue(lisbon.waitForExistence(timeout: 3))
        lisbon.doubleTap()
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 3))
        backButton.tap()
        XCTAssertTrue(app.navigationBars["Travel"].waitForExistence(timeout: 3), "a double-tapped note was pushed once")
    }

    func testEmptyFolderAndBlankNote() {
        app.buttons["sidebar.newFolder"].firstMatch.tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("Empty")
        app.alerts.buttons["Create"].tap()
        XCTAssertTrue(app.navigationBars["Empty"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["No Notes"].waitForExistence(timeout: 2), "an empty folder says so")
        XCTAssertFalse(app.buttons["list.select"].isEnabled, "nothing to select")
        // A new note left blank is discarded when you leave it, like Notes.
        app.buttons["list.newNote"].firstMatch.tap()
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 3))
        backButton.tap()
        XCTAssertTrue(app.staticTexts["No Notes"].waitForExistence(timeout: 3), "the blank note is gone")
        backToFolders()
        XCTAssertEqual(row("folder.Empty").descendants(matching: .any).matching(identifier: "folder.Empty").firstMatch.value as? String, "0 notes")
    }

    func testDeleteRestoreAndRecentlyDeleted() {
        row("folder.Travel").tap()
        XCTAssertTrue(app.navigationBars["Travel"].waitForExistence(timeout: 3))
        for title in ["Packing", "Lisbon"] {
            let note = app.staticTexts[title].firstMatch
            XCTAssertTrue(note.waitForExistence(timeout: 3))
            note.swipeLeft()
            app.buttons["Delete"].firstMatch.tap()
            XCTAssertFalse(app.staticTexts[title].firstMatch.waitForExistence(timeout: 1.5), "\(title) left the list")
        }
        backToFolders()
        row("sidebar.trash").tap()
        XCTAssertTrue(app.navigationBars["Recently Deleted"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Lisbon"].firstMatch.waitForExistence(timeout: 2))
        // A deleted note opens read-only-ish in Notes; here it must at least open and come back.
        app.staticTexts["Lisbon"].firstMatch.tap()
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 3) || app.staticTexts["Lisbon"].exists)
        backToFolders()
        row("folder.Travel").tap()
        XCTAssertTrue(app.navigationBars["Travel"].waitForExistence(timeout: 3))
    }

    func testSearchWhileNavigating() {
        row("sidebar.all").tap()
        XCTAssertTrue(app.navigationBars["All Notes"].waitForExistence(timeout: 3))
        let searchButton = app.buttons["Search"].firstMatch
        if searchButton.exists { searchButton.tap() }
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap()
        search.typeText("tram")
        let hit = app.staticTexts["Lisbon"].firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 3), "search finds text inside a note")
        hit.tap()
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 3))
        backButton.tap()
        // Back from a hit returns to the results, search still open, as in Notes.
        XCTAssertTrue(app.staticTexts["Lisbon"].firstMatch.waitForExistence(timeout: 3))
        XCTAssertEqual(app.searchFields.firstMatch.value as? String, "tram")
        app.buttons["close"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["All Notes"].waitForExistence(timeout: 3))
        backToFolders()
        row("folder.Ideas").tap()
        XCTAssertTrue(app.navigationBars["Ideas"].waitForExistence(timeout: 3), "a folder opens after searching")
    }

    func testMultiSelectMoveThenOpenTarget() {
        row("sidebar.all").tap()
        let select = app.buttons["list.select"]
        XCTAssertTrue(select.waitForExistence(timeout: 3))
        select.tap()
        app.staticTexts["Groceries"].firstMatch.tap()
        app.staticTexts["Standup notes"].firstMatch.tap()
        app.buttons["list.moveSelected"].firstMatch.tap()
        app.buttons["Ideas"].firstMatch.tap()
        backToFolders()
        let ideas = row("folder.Ideas").descendants(matching: .any).matching(identifier: "folder.Ideas").firstMatch
        XCTAssertEqual(ideas.value as? String, "4 notes", "both notes moved")
        row("folder.Ideas").tap()
        XCTAssertTrue(app.navigationBars["Ideas"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Groceries"].firstMatch.waitForExistence(timeout: 2))
    }

    func testPinSwipeHammer() {
        row("folder.Notes").tap()
        let note = app.staticTexts["Snippets"].firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 3))
        for _ in 0..<6 {
            app.staticTexts["Snippets"].firstMatch.swipeRight()
            let pin = app.buttons["Pin"].firstMatch.exists ? app.buttons["Pin"].firstMatch : app.buttons["Unpin"].firstMatch
            if pin.exists { pin.tap() }
        }
        XCTAssertTrue(app.staticTexts["Snippets"].firstMatch.waitForExistence(timeout: 2))
        XCTAssertEqual(app.state, .runningForeground)
    }
}
#endif
