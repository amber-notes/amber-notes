#if os(iOS)
import XCTest

/// Compose and search from the iPhone folder list (TestFlight 1.1.1): with the account's
/// connection alerts up as the notes first showed, the launch restore's push was dropped while
/// the folder and note stayed selected. The folder list then showed the note's toolbar, compose
/// added a note no editor opened (and it was discarded later), and search raised the keyboard
/// for a field that wasn't on screen.
final class ComposeFromFoldersUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/compose-\(name).png"))
    }

    var folderList: XCUIElement { app.navigationBars["Pinto Notes"] }

    /// Launches the way 1.1.1 was opened after unlocking: a note to restore and an alert on top.
    func launchUnderAlert() {
        app.launchArguments = ["-uitest", "-demo", "-open", "Groceries", "-launchAlert"]
        app.launch()
        let ok = app.alerts.buttons["OK"].firstMatch
        XCTAssertTrue(ok.waitForExistence(timeout: 5))
        ok.tap()
        XCTAssertTrue(folderList.waitForExistence(timeout: 3), "the folder list stays")
        Thread.sleep(forTimeInterval: 1)
    }

    func testFolderListKeepsItsOwnToolbarUnderALaunchAlert() {
        launchUnderAlert()
        shot("folders-after-alert")
        XCTAssertFalse(app.buttons["Checklist"].exists, "no note toolbar on the folder list")
        XCTAssertFalse(app.buttons["list.newNote"].exists, "no note list toolbar on the folder list")
        XCTAssertTrue(app.buttons["sidebar.newFolder"].exists, "the folder list's own New Folder")
        XCTAssertEqual(app.searchFields.count, 0, "no search for a list that isn't on screen")
        XCTAssertFalse(app.buttons["Search"].exists, "no search for a list that isn't on screen")
    }

    func testComposeOpensTheNewNote() {
        launchUnderAlert()
        let count = app.descendants(matching: .any).matching(identifier: "sidebar.all").firstMatch.value as? String
        app.buttons["New Note"].firstMatch.tap()
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 3), "compose opens the new note's editor")
        shot("editor")
        // Leaving it empty discards it, so the count is back where it was.
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()
        XCTAssertTrue(folderList.waitForExistence(timeout: 3))
        let all = app.descendants(matching: .any).matching(identifier: "sidebar.all").firstMatch
        XCTAssertEqual(all.value as? String, count, "an empty new note left behind is discarded")
    }

    func testComposeKeepsATypedNote() {
        app.launchArguments = ["-uitest", "-demo", "-showFolders"]
        app.launch()
        XCTAssertTrue(folderList.waitForExistence(timeout: 5))
        let all = app.descendants(matching: .any).matching(identifier: "sidebar.all").firstMatch
        let before = Int((all.value as? String ?? "").split(separator: " ").first ?? "") ?? -1
        app.buttons["New Note"].firstMatch.tap()
        let editor = app.textViews["editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 3))
        editor.typeText("Kept note")
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Kept note"].firstMatch.waitForExistence(timeout: 3), "back shows the note in its folder")
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()
        XCTAssertTrue(folderList.waitForExistence(timeout: 3))
        XCTAssertEqual(all.value as? String, "\(before + 1) notes")
    }

    /// Settings scrolled: the rows pass under the title, not through it (a picture to look at).
    func testSettingsScrolledUnderTheTitle() {
        app.launchArguments = ["-uitest", "-captureScreen", "settings"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        app.swipeUp()
        Thread.sleep(forTimeInterval: 1.5)
        shot("settings-scrolled")
    }
}
#endif
