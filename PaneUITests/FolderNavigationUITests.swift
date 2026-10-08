#if os(iOS)
import XCTest

/// The iPhone folder list: every row can always be tapped to open its folder, and none is left
/// marked after you come back to the list, as in Notes.
final class FolderNavigationUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func launch(_ extra: [String] = [], demo: Bool = true) {
        app.launchArguments = ["-uitest"] + (demo ? ["-demo"] : []) + extra
        app.launch()
    }

    /// The folder list's navigation bar.
    var folderList: XCUIElement { app.navigationBars["Pinto Notes"] }

    func back(toFolders: Bool = true) {
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()
        if toFolders { XCTAssertTrue(folderList.waitForExistence(timeout: 3), "back leads to the folder list") }
    }

    /// Folder rows drawn as selected on the folder list.
    func markedRows() -> [String] {
        app.cells.allElementsBoundByIndex.filter { $0.isSelected }.map { $0.staticTexts.firstMatch.label }
    }

    /// Taps a folder row and checks its note list opens.
    func open(_ id: String, title: String, file: StaticString = #filePath, line: UInt = #line) {
        let row = app.cells.containing(.any, identifier: id).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 3), "\(id) is listed", file: file, line: line)
        XCTAssertEqual(markedRows(), [], "no folder row is left marked", file: file, line: line)
        row.tap()
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 3), "tapping \(id) opens \(title)", file: file, line: line)
    }

    func testEveryRowOpensAfterComingBack() {
        launch()
        // Launch restores the last folder (or All Notes); back out of it.
        if !folderList.waitForExistence(timeout: 2) { back() }
        for _ in 0..<2 {
            open("sidebar.all", title: "All Notes")
            back()
            open("folder.Travel", title: "Travel")
            back()
            open("folder.Travel", title: "Travel")
            back()
            open("sidebar.trash", title: "Recently Deleted")
            back()
        }
    }

    /// A note opened at launch pushes its folder and the note; backing out of both leaves nothing marked.
    func testFolderOpenedAtLaunchCanBeReopened() {
        launch(["-open", "Lisbon"])
        XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 4))
        back(toFolders: false)
        XCTAssertTrue(app.navigationBars["All Notes"].waitForExistence(timeout: 3), "the note list is under it")
        back()
        open("folder.Travel", title: "Travel")
        back()
        open("sidebar.all", title: "All Notes")
    }

    func testNewFolderOpensAndCanBeReopened() {
        launch(["-showFolders"])
        XCTAssertTrue(folderList.waitForExistence(timeout: 3))
        app.buttons["sidebar.newFolder"].firstMatch.tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("Personal")
        app.alerts.buttons["Create"].tap()
        XCTAssertTrue(app.navigationBars["Personal"].waitForExistence(timeout: 3), "a new folder opens, as in Notes")
        back()
        open("folder.Personal", title: "Personal")
    }

    /// A new account has one folder and no All Notes row: the case Emil hit.
    func testSingleFolderCanBeReopened() {
        launch(demo: false)
        if !folderList.waitForExistence(timeout: 2) { back() }
        open("folder.Notes", title: "Notes")
        back()
        open("folder.Notes", title: "Notes")
        back()
        // Going from two folders back to one, while on the folder list.
        app.buttons["sidebar.newFolder"].firstMatch.tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("Temp")
        app.alerts.buttons["Create"].tap()
        XCTAssertTrue(app.navigationBars["Temp"].waitForExistence(timeout: 3))
        back()
        app.cells.containing(.any, identifier: "folder.Temp").firstMatch.press(forDuration: 1.0)
        app.buttons["Delete Folder…"].firstMatch.tap()
        XCTAssertFalse(app.cells.containing(.any, identifier: "folder.Temp").firstMatch.waitForExistence(timeout: 1))
        open("folder.Notes", title: "Notes")
    }
}
#endif
