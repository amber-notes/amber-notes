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

    /// Page / Text: the toolbar button shows the one you'd switch to.
    func mode(_ name: String) {
        let b = app.buttons["note.mode"].firstMatch
        XCTAssertTrue(b.waitForExistence(timeout: 5))
        if b.label == "Show \(name)" { b.tap() }
    }

    /// (a)-(e): text, Claude's page arriving, a tick on the page, the tick in the text, Undo.
    func testHabitTracker() {
        launch(["-open", "Habit tracker", "-aiPage", "Habit tracker=\(pages)/habit-tracker.html", "-aiPageBy", "Claude", "-aiAfter", "5"])
        mark("habit-start")
        pause(1.5)
        shot("01-habit-text")
        pause(4.5)
        XCTAssertTrue(app.buttons["note.mode"].waitForExistence(timeout: 5), "the page should arrive")
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

    /// Open-to-interactive, measured by the app (`-pageTimings`): the habit tracker opened from the
    /// list eight times; the first open of the launch is the cold one.
    func testPageTimings() {
        launch(["-seedPage", "Habit tracker=\(pages)/habit-tracker.html", "-pageTimings"])
        let all = app.staticTexts["All Notes"].firstMatch
        if all.waitForExistence(timeout: 4) { all.tap() }
        for _ in 0..<8 {
            let row = app.staticTexts["Habit tracker"].firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 5))
            row.tap()
            pause(2.5)
            app.navigationBars.buttons.element(boundBy: 0).tap()
            pause(1.0)
        }
    }

    /// (d) of the no-loss work: Claude's rewrite throws as it loads; the previous page comes back.
    func testFallback() {
        launch(["-open", "Habit tracker", "-seedPage", "Habit tracker=\(pages)/habit-tracker.html",
                "-aiPage", "Habit tracker=\(pages)/habit-tracker-broken.html", "-aiPageBy", "Claude", "-aiAfter", "3"])
        mark("fallback-start")
        pause(2.5)
        shot("13-fallback-before")
        pause(1.6)
        shot("14-fallback-notice")
        pause(3)
        app.buttons["editor.more"].firstMatch.tap()
        pause(1)
        shot("15-fallback-menu")
        app.buttons["editor.more"].firstMatch.tap()
        mark("fallback-end")
        pause(1)
    }

    /// The two Page / Text designs, for choosing: a toolbar button, or a choice in More.
    func testToggleButton() {
        launch(["-open", "Habit tracker", "-seedPage", "Habit tracker=\(pages)/habit-tracker.html"])
        pause(2.5)
        shot("toggle-a-page")
        mode("Text")
        pause(1.2)
        shot("toggle-a-text")
    }

    func testToggleMenu() {
        launch(["-open", "Habit tracker", "-seedPage", "Habit tracker=\(pages)/habit-tracker.html", "-pageToggle", "menu"])
        pause(2.5)
        shot("toggle-b-page")
        app.buttons["editor.more"].firstMatch.tap()
        pause(1.2)
        shot("toggle-b-menu")
    }

    /// Apps inside a note: Budget 2026 with three sub-notes shown as widgets.
    func testWidgets() {
        launch(["-open", "Budget 2026", "-widgetDemo", pages])
        mark("widgets-start")
        pause(3)
        shot("20-widgets-top")
        app.textViews["editor"].firstMatch.swipeUp(velocity: .slow)
        pause(1.5)
        shot("21-widgets-scrolled")
        // The first tap wakes the savings app; then its +500 adds a deposit to the app's data.
        let savings = app.descendants(matching: .any)["widget.Savings: Lisbon trip"].firstMatch
        if savings.waitForExistence(timeout: 3) { savings.tap() }
        pause(1.2)
        let plus = web("+500")
        if plus.waitForExistence(timeout: 4) { plus.tap() }
        pause(1.5)
        shot("22-widget-saved")
        // Open goes to the full screen.
        let open = app.buttons["widget.open.Spending by month"].firstMatch
        app.textViews["editor"].firstMatch.swipeDown(velocity: .slow)
        pause(1)
        if open.waitForExistence(timeout: 3) { open.tap() }
        pause(2.5)
        shot("23-widget-opened")
        mark("widgets-end")
        pause(1)
    }

    /// Scrolling a note with three widgets (or, with WIDGETS=links, the same note with plain
    /// links), for the app's frame probe: ten slow and fast scrolls after it has settled.
    func testWidgetScroll() {
        let links = ProcessInfo.processInfo.environment["WIDGETS"] == "links"
        launch(["-open", "Budget 2026", "-widgetDemo", pages, "-frameProbe"] + (links ? ["-widgetLinksOnly"] : []))
        pause(6)
        let editor = app.textViews["editor"].firstMatch
        for i in 0..<5 {
            editor.swipeUp(velocity: i % 2 == 0 ? .fast : .slow)
            editor.swipeDown(velocity: i % 2 == 0 ? .fast : .slow)
        }
        pause(1.5)
    }

    /// The app mark in the list, both designs.
    func testAppMark() {
        let style = ProcessInfo.processInfo.environment["APP_MARK"] ?? "detail"
        launch(["-seedPage", "Habit tracker=\(pages)/habit-tracker.html", "-appMark", style])
        let all = app.staticTexts["All Notes"].firstMatch
        if all.waitForExistence(timeout: 4) { all.tap() }
        pause(1.5)
        shot("mark-\(style)")
    }
}
