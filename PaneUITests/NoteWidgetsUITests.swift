import XCTest

/// Note page widgets (prototype), played for recordings: the habit tracker's widgets put on the
/// home screen, the Walk button pressed there, and the tick in the note with its receipt.
/// Screenshots go to $PANE_SHOTS. Run with scripts/note-widgets-ios.sh.
final class NoteWidgetsUITests: XCTestCase {
    var app: XCUIApplication!
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let pages = ProcessInfo.processInfo.environment["PAGES_DIR"] ?? ""
    let shots = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? "/tmp/pane-shots"

    override func setUp() { continueAfterFailure = true }

    func shot(_ name: String) {
        try? FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/\(name).png"))
    }

    func dump(_ name: String) {
        try? springboard.debugDescription.write(toFile: "\(shots)/\(name).txt", atomically: true, encoding: .utf8)
    }

    func mark(_ name: String) {
        try? "\(Date().timeIntervalSince1970)".write(toFile: "\(shots)/mark-\(name).txt", atomically: true, encoding: .utf8)
    }

    func pause(_ s: Double) { Thread.sleep(forTimeInterval: s) }

    func launch() {
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo", "-widgetDemo", "-seedWidget", "Habit tracker=\(pages)/habit-tracker.widget.json",
                               "-open", "Habit tracker", "-seedPage", "Habit tracker=\(pages)/habit-tracker.html"]
        app.launch()
    }

    /// Long-press the wallpaper, then Edit > Add Widget, find Amber Notes, pick a size, add it.
    func addWidget(sizeIndex: Int) {
        let screen = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62)).press(forDuration: 1.6)
        pause(1)
        let edit = springboard.buttons["Edit"].firstMatch
        if edit.waitForExistence(timeout: 3) {
            edit.tap()
            pause(0.8)
            let add = springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Add Widget'")).firstMatch
            if add.waitForExistence(timeout: 3) { add.tap() }
        } else {
            let plus = springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Add Widget'")).firstMatch
            if plus.waitForExistence(timeout: 3) { plus.tap() }
        }
        pause(1.5)
        dump("gallery")
        let search = springboard.searchFields.firstMatch
        if search.waitForExistence(timeout: 3) {
            search.tap()
            let clear = search.buttons.firstMatch
            if clear.exists { clear.tap() }
            search.typeText("Amber")
            pause(1.5)
        }
        shot("step-search-\(sizeIndex)")
        dump("search")
        let amber = springboard.cells.containing(NSPredicate(format: "label CONTAINS 'Amber'")).firstMatch
        let amberAny = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Amber Notes'")).firstMatch
        if amber.exists { amber.tap() } else if amberAny.waitForExistence(timeout: 3) { amberAny.tap() }
        pause(1.5)
        dump("sizes")
        for _ in 0..<sizeIndex {
            springboard.swipeLeft()
            pause(0.8)
        }
        shot("gallery-size-\(sizeIndex)")
        let addButton = springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Add Widget'")).firstMatch
        if addButton.waitForExistence(timeout: 3) { addButton.tap() }
        pause(2)
        shot("step-added-\(sizeIndex)")
        dump("added-\(sizeIndex)")
        _ = screen
    }

    func done() {
        let done = springboard.buttons["Done"].firstMatch
        if done.waitForExistence(timeout: 2) { done.tap() } else { XCUIDevice.shared.press(.home) }
        pause(1)
    }

    /// The small and medium habit widgets on the home screen; Walk pressed there; back in the app.
    func testHabitWidgets() {
        launch()
        pause(3)
        shot("01-app-page")
        XCUIDevice.shared.press(.home)
        pause(1.5)
        addWidget(sizeIndex: 1)
        addWidget(sizeIndex: 0)
        done()
        pause(2)
        dump("home")
        shot("02-home-widgets")
        mark("press")
        let walk = springboard.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Walk'")).firstMatch
        XCTAssertTrue(walk.waitForExistence(timeout: 5), "the widget's Walk button")
        walk.tap()
        pause(2.5)
        shot("03-home-walk-pressed")
        dump("home-pressed")
        mark("open-app")
        app.activate()
        pause(2.5)
        shot("04-app-after-press")
        // Page / Text: the tick in the note's own table, tinted.
        let text = app.buttons["Text"].firstMatch
        if text.waitForExistence(timeout: 3) { text.tap() }
        pause(1.5)
        shot("05-app-text-tinted")
        mark("end")
    }

    /// Exploration: the Lock Screen widgets (circular and rectangular).
    func testLockScreenWidgets() {
        launch()
        pause(3)
        XCUIDevice.shared.press(.home)
        pause(1)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        pause(1.5)
        // Wake it, then hold on the Lock Screen to customize.
        XCUIDevice.shared.press(.home)
        pause(1.5)
        shot("lock-01")
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4)).press(forDuration: 2.0)
        pause(2)
        shot("lock-02")
        dump("lock-02")
        let customize = springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Customize'")).firstMatch
        if customize.waitForExistence(timeout: 3) { customize.tap() }
        pause(2)
        shot("lock-03")
        springboard.buttons["grouped-widgets-reticle-view"].firstMatch.tap()
        pause(2)
        shot("lock-04")
        dump("lock-04")
        let search = springboard.searchFields.firstMatch
        if search.waitForExistence(timeout: 2) { search.tap(); search.typeText("Amber"); pause(1.5) }
        let amber = springboard.descendants(matching: .any).matching(NSPredicate(format: "label == 'Amber Notes'")).firstMatch
        if amber.waitForExistence(timeout: 3) { amber.tap() }
        pause(2)
        shot("lock-05")
        dump("lock-05")
        let tiles = springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Note page'"))
        for i in 0..<min(tiles.count, 2) { tiles.element(boundBy: i).tap(); pause(1.2) }
        shot("lock-06")
        let close = springboard.buttons.matching(NSPredicate(format: "label == 'Close' OR identifier == 'Close'")).firstMatch
        if close.exists { close.tap() } else { springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap() }
        pause(1.2)
        let done = springboard.buttons["editing-done"].firstMatch
        if done.waitForExistence(timeout: 3) { done.tap() }
        pause(2)
        dump("lock-07")
        shot("lock-07")
        // Back to the Lock Screen itself.
        let lockDone = springboard.buttons.matching(NSPredicate(format: "label == 'Done'")).firstMatch
        if lockDone.exists { lockDone.tap() }
        pause(1)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        pause(1.5)
        XCUIDevice.shared.press(.home)
        pause(2)
        shot("lock-08")
    }
}
