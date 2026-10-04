import XCTest

/// Note pages (prototype), played for recordings: a habit tracker as text, a page arriving from
/// Claude, ticking a habit on the page, the tick in the text with Undo, a budget, and a page that
/// tries to send the note out. Pages come from demo/note-pages ($PAGES_DIR); screenshots go to
/// $PANE_SHOTS. Run with scripts/note-pages-ios.sh.
final class NotePagesUITests: XCTestCase {
    var app: XCUIApplication!
    let pages = ProcessInfo.processInfo.environment["PAGES_DIR"] ?? ""
    let shots = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? "/tmp/pane-shots"

    override func setUp() { continueAfterFailure = true }

    func launch(_ extra: [String]) {
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo", "-pageDemo"] + extra
        app.launch()
    }

    func shot(_ name: String) {
        try? FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/\(name).png"))
    }

    func mark(_ name: String) {
        // A marker the recording script reads to cut clips.
        try? "\(Date().timeIntervalSince1970)".write(toFile: "\(shots)/mark-\(name).txt", atomically: true, encoding: .utf8)
    }

    func pause(_ s: Double) { Thread.sleep(forTimeInterval: s) }

    func web(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func mode(_ name: String) {
        app.segmentedControls["note.mode"].buttons[name].firstMatch.tap()
    }

    /// (a)-(e): text, Claude's page arriving, a tick on the page, the tick in the text, Undo.
    func testHabitTracker() {
        launch(["-open", "Habit tracker", "-aiPage", "Habit tracker=\(pages)/habit-tracker.html", "-aiPageBy", "Claude", "-aiAfter", "5"])
        mark("habit-start")
        pause(1.5)
        shot("01-habit-text")
        pause(4.5)
        XCTAssertTrue(app.segmentedControls["note.mode"].waitForExistence(timeout: 5), "the page should arrive")
        pause(1.2)
        shot("02-habit-page-arrives")
        pause(3)
        shot("03-habit-page")
        mark("habit-tick")
        let read = web("Read")
        XCTAssertTrue(read.waitForExistence(timeout: 5))
        read.tap()
        pause(1.0)
        shot("04-habit-ticked-on-page")
        pause(1.5)
        mode("Text")
        pause(1.0)
        shot("05-habit-tick-in-text")
        pause(1.5)
        app.buttons["Undo"].firstMatch.tap()
        pause(1.5)
        shot("06-habit-undone-text")
        mode("Page")
        pause(2)
        shot("07-habit-undone-page")
        mark("habit-end")
        pause(1)
    }

    /// A second page: a budget with a total, adding an expense from the page.
    func testBudget() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/budget.html"])
        mark("budget-start")
        pause(2.5)
        shot("08-budget-page")
        let what = app.webViews.textFields["What"].firstMatch
        XCTAssertTrue(what.waitForExistence(timeout: 5))
        what.tap()
        what.typeText("Dinner")
        let amount = app.webViews.textFields["kr"].firstMatch
        amount.tap()
        amount.typeText("420")
        app.webViews.buttons["Add"].firstMatch.tap()
        pause(2)
        shot("09-budget-added")
        mode("Text")
        pause(2.5)
        shot("10-budget-text")
        mark("budget-end")
        pause(1)
    }

    /// (f): a page that slips past the server's check still can't send anything.
    func testSandbox() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/sandbox-test.html"])
        mark("sandbox-start")
        pause(2)
        shot("11-sandbox-before")
        let go = web("Try to send this note out")
        XCTAssertTrue(go.waitForExistence(timeout: 5))
        go.tap()
        pause(3)
        shot("12-sandbox-blocked")
        XCTAssertFalse(web("Sent").exists, "nothing may get out")
        mark("sandbox-end")
        pause(1.5)
    }
}
