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
        // The showcase brings its own notes; a first launch has no demo library at all.
        let base = extra.contains("-firstLaunch") ? ["-uitest"] : ["-uitest", "-demo"] + (extra.contains("-showcase") ? [] : ["-pageDemo"])
        app.launchArguments = base + extra.filter { $0 != "-firstLaunch" }
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

    /// The Text / App switch is gone (an app note is just the app): older recordings skip it.
    func mode(_ name: String) {
        let b = app.buttons["note.mode"].firstMatch
        if b.waitForExistence(timeout: 1), b.label == "Show \(name)" { b.tap() }
    }

    /// (a)-(e): text, Claude's page arriving, a tick on the page, the tick in the text, Undo.
    func testHabitTracker() {
        launch(["-open", "Habit tracker", "-aiPage", "Habit tracker=\(pages)/habit-tracker.html", "-aiPageBy", "Claude", "-aiAfter", "5"])
        mark("habit-start")
        pause(1.5)
        shot("01-habit-text")
        pause(4.5)
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 8), "the page should arrive")
        pause(1.2)
        shot("02-habit-page-arrives")
        pause(3)
        shot("03-habit-page")
        mark("habit-tick")
        let read = web("Read today")
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
        let style = ProcessInfo.processInfo.environment["APP_MARK"] ?? "soft"
        let look = ProcessInfo.processInfo.environment["APPEARANCE"] ?? "light"
        launch(["-seedPage", "Habit tracker=\(pages)/habit-tracker.html", "-appMark", style])
        let all = app.staticTexts["All Notes"].firstMatch
        if all.waitForExistence(timeout: 4) { all.tap() }
        pause(1.5)
        shot("mark-\(style)-\(look)-list")
        // The same mark on an embedded app's header.
        app.terminate()
        launch(["-open", "Budget 2026", "-widgetDemo", pages, "-appMark", style])
        pause(3.5)
        shot("mark-\(style)-\(look)-widget")
    }

    // MARK: Showcase

    /// Taps the system's own permission alert, whichever it is.
    func allowSystemAlert(_ labels: [String] = ["Allow Full Access", "Allow While Using App", "Allow", "OK"], timeout: Double = 6) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for _ in 0..<Int(timeout * 2) {
            for l in labels where springboard.buttons[l].exists { springboard.buttons[l].tap(); return }
            pause(0.5)
        }
    }

    func openNote(_ title: String) {
        let all = app.staticTexts["All Notes"].firstMatch
        if all.waitForExistence(timeout: 4) { all.tap() }
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        pause(2)
    }

    /// The habit tracker sets a daily reminder through Reminders' own prompt.
    func testShowcaseHabit() {
        launch(["-showcase", pages, "-open", "Habit tracker"])
        pause(2.5)
        shot("30-habit-app")
        let bell = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Remind me daily: Read'")).firstMatch
        XCTAssertTrue(bell.waitForExistence(timeout: 5))
        bell.tap()
        allowSystemAlert()
        pause(2)
        shot("31-habit-reminder-set")
        pause(1)
    }

    /// Meeting prep: today's events from Calendar, a person from Contacts' picker, on-device AI.
    func testShowcaseMeeting() {
        launch(["-showcase", pages, "-seedCalendar", "-open", "Meeting prep"])
        allowSystemAlert(timeout: 3)
        pause(3)
        shot("32-meeting-today")
        let lunch = web("Lunch with Jonas")
        if lunch.waitForExistence(timeout: 4) { lunch.tap() }
        pause(1)
        let add = web("Add a person…")
        if add.waitForExistence(timeout: 4) { add.tap() }
        pause(2)
        let kate = app.staticTexts["Kate Bell"].firstMatch
        if kate.waitForExistence(timeout: 5) { kate.tap() }
        pause(2)
        let ask = web("Suggest questions")
        if ask.waitForExistence(timeout: 4) { ask.tap() }
        pause(4)
        app.webViews.firstMatch.swipeUp(velocity: .slow)
        pause(1.5)
        shot("33-meeting-prepared")
        pause(1)
    }

    /// The trip log: location (system prompt), the map, the weather through an approved host, photos.
    func testShowcaseTrip() {
        launch(["-showcase", pages, "-open", "Lisbon trip log"])
        pause(2.5)
        shot("34-trip-empty")
        web("Where am I?").tap()
        allowSystemAlert()
        let allow = app.alerts.buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 8) {
            shot("35-trip-allow-host")
            allow.tap()
        }
        pause(3)
        shot("36-trip-here")
        web("Add photos").tap()
        pause(3)
        let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo'")).firstMatch
        if photo.waitForExistence(timeout: 5) {
            photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            for l in ["Add", "Done"] where app.buttons[l].firstMatch.exists { app.buttons[l].firstMatch.tap(); break }
        }
        pause(3)
        shot("37-trip-photos")
        pause(1)
    }

    /// The weather app needs an API key: the card, adding the key, the app working, the log.
    func testShowcaseWeather() {
        launch(["-showcase", pages, "-open", "Weather"])
        pause(3)
        shot("38-weather-needs-key")
        let add = app.buttons["keycard.add"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        pause(1.2)
        let value = app.secureTextFields["apikey.value"].firstMatch
        XCTAssertTrue(value.waitForExistence(timeout: 4))
        value.tap()
        value.typeText("demo-key-123")
        pause(0.6)
        shot("39-weather-add-key")
        app.buttons["apikey.save"].firstMatch.tap()
        pause(1)
        web("Try Again").tap()
        let allow = app.alerts.buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 6) { allow.tap() }
        pause(2.5)
        shot("40-weather-works")
        app.buttons["editor.more"].firstMatch.tap()
        pause(0.8)
        app.buttons["editor.appInfo"].firstMatch.tap()
        pause(1.5)
        shot("41-weather-log")
        pause(1)
    }

    /// Claude's new version arrives while a form is half filled: it waits behind the bar, and the
    /// typing comes along when you switch.
    func testLiveUpdate() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/budget.html",
                "-aiPage", "October budget=\(pages)/budget-v2.html", "-aiPageBy", "Claude", "-aiAfter", "9"])
        mark("live-start")
        pause(3)
        let what = app.webViews.textFields["What"].firstMatch
        XCTAssertTrue(what.waitForExistence(timeout: 5))
        what.tap()
        // The simulator's first keyboard shows a typing tip.
        let tip = app.buttons["Continue"].firstMatch
        if tip.waitForExistence(timeout: 1.5) { tip.tap(); what.tap() }
        for c in "Dinn" { what.typeText(String(c)); pause(0.5) }
        let bar = app.buttons["app.switch"].firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 12), "the new version should wait")
        pause(1.5)
        shot("50-live-waiting")
        bar.tap()
        pause(2.5)
        shot("51-live-switched")
        let again = app.webViews.textFields["What"].firstMatch
        XCTAssertEqual(again.value as? String, "Dinn", "what you typed comes along")
        pause(0.5)
        again.typeText("er")
        pause(1.5)
        shot("52-live-continue")
        mark("live-end")
        pause(1)
    }

    // MARK: Discovery

    /// A new account: next to the welcome note, a habit tracker that is already an app.
    func testFirstLaunch() {
        launch(["-firstLaunch"])
        mark("first-start")
        pause(2.5)
        let all = app.staticTexts["All Notes"].firstMatch
        if all.waitForExistence(timeout: 4) { all.tap() }
        pause(2)
        shot("60-first-list")
        let row = app.staticTexts["Habit tracker"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 4))
        row.tap()
        pause(3)
        shot("61-first-app")
        mode("Text")
        pause(2)
        shot("62-first-text")
        mark("first-end")
        pause(1)
    }

    /// A note that looks like a tracker suggests itself once; with no AI connected, the sheet leads
    /// to connecting one, then the prompt.
    func testMakeItAnApp() {
        launch(["-open", "Evening tracker"] + (ProcessInfo.processInfo.environment["AI_CONNECTED"] == "1" ? ["-aiConnected"] : []))
        mark("make-start")
        let chip = app.buttons["makeApp.chip"].firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 6), "the suggestion shows")
        pause(1.2)
        shot("63-make-chip")
        chip.tap()
        pause(1.5)
        shot("64-make-sheet")
        let connect = app.buttons["makeApp.connect"].firstMatch
        if connect.exists {
            connect.tap()
            pause(2)
            shot("65-make-connect")
            // Settings opens on the account (sign-in first, without one); back to the prompt.
            app.swipeDown(velocity: .fast)
            pause(1.2)
            app.buttons["makeApp.showPrompt"].firstMatch.tap()
            pause(1.2)
        }
        shot("66-make-prompt")
        app.buttons["makeApp.copy"].firstMatch.tap()
        pause(1.5)
        shot("67-make-copied")
        mark("make-end")
        pause(1)
    }

    /// More › App Info: only what Amber Notes alone does for an app (internet, Previous, Remove).
    func testAppInfo() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/budget.html"])
        mark("info-start")
        pause(3)
        app.buttons["editor.more"].firstMatch.tap()
        pause(1.2)
        shot("70-more-menu")
        app.buttons["editor.appInfo"].firstMatch.tap()
        pause(1.5)
        shot("71-app-info")
        app.buttons["appInfo.done"].firstMatch.tap()
        pause(1)
        mark("info-end")
        pause(1)
    }

    // MARK: Libraries

    /// Chart.js, bundled: a dashboard over the October budget.
    func testLibDashboard() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/budget-dashboard.html"])
        mark("lib-start")
        pause(3.5)
        shot("80-lib-dashboard")
        app.webViews.firstMatch.swipeUp(velocity: .slow)
        pause(1.5)
        shot("81-lib-dashboard-scrolled")
        mark("lib-end")
        pause(1)
    }

    /// three.js, bundled: a reading list as a stack of books. Drag turns it; a tap marks a book read.
    func testLibStack() {
        launch(["-seedNote", "\(pages)/reading-stack.md", "-open", "Reading stack", "-seedPage", "Reading stack=\(pages)/reading-stack.html"])
        mark("lib-start")
        pause(4)
        shot("82-lib-stack")
        let web = app.webViews.firstMatch
        let middle = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
        middle.press(forDuration: 0.1, thenDragTo: web.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55)))
        pause(1.5)
        middle.tap()
        pause(2)
        shot("83-lib-stack-read")
        mark("lib-end")
        pause(1)
    }

    /// A pinned npm package (qrcode-generator 1.4.4, checked by hash): a Wi-Fi card with a QR code,
    /// then App Info showing the one-time download.
    func testLibNpm() {
        launch(["-seedNote", "\(pages)/wifi-card.md", "-open", "Wi-Fi at home", "-seedPage", "Wi-Fi at home=\(pages)/wifi-card.html"])
        mark("lib-start")
        pause(5)
        shot("84-lib-npm")
        app.buttons["editor.more"].firstMatch.tap()
        pause(0.8)
        app.buttons["editor.appInfo"].firstMatch.tap()
        pause(1.5)
        shot("85-lib-npm-settings")
        mark("lib-end")
        pause(1)
    }

    // MARK: Round 6

    /// A receipt never sits on a field you're typing in: it steps away when a field gets focus.
    func testReceiptStaysClear() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/budget.html"])
        mark("receipt-start")
        pause(2.5)
        let what = app.webViews.textFields["What"].firstMatch
        XCTAssertTrue(what.waitForExistence(timeout: 5))
        what.tap()
        what.typeText("Dinner")
        let amount = app.webViews.textFields["kr"].firstMatch
        amount.tap()
        amount.typeText("420")
        app.webViews.buttons["Add"].firstMatch.tap()
        pause(1.2)
        shot("90-receipt-after-add")
        what.tap()
        pause(1.2)
        shot("91-receipt-while-typing")
        what.typeText("Coffee")
        pause(1)
        shot("92-receipt-still-clear")
        mark("receipt-end")
        pause(1)
    }

    /// Preact, htm and the router: a packing list with two screens.
    func testPacking() {
        launch(["-seedNote", "\(pages)/packing.md", "-open", "Packing for Lisbon", "-seedPage", "Packing for Lisbon=\(pages)/packing.html"])
        mark("packing-start")
        pause(3)
        shot("93-packing")
        web("Walking shoes").tap()
        pause(1.2)
        web("Add Item").tap()
        pause(1.2)
        shot("94-packing-add")
        let field = app.webViews.textFields.firstMatch
        if field.waitForExistence(timeout: 3) { field.tap() }
        pause(1.2)
        shot("94b-packing-sheet-keyboard")
        field.typeText("Sun hat")
        pause(0.6)
        app.webViews.buttons["Add"].firstMatch.tap()
        pause(1.5)
        shot("95-packing-added")
        mark("packing-end")
        pause(1)
    }


    /// Preact: Training as three screens with a tab bar (Today, Plan, Progress), a pushed screen
    /// and the app's own settings.
    func testTraining() {
        launch(["-seedNote", "\(pages)/training.md", "-open", "Training", "-seedPage", "Training=\(pages)/training.html"])
        mark("training-start")
        pause(3)
        shot("t1-today")
        let weight = app.webViews.textFields["Weight for Bench press"].firstMatch
        if weight.waitForExistence(timeout: 3) { weight.tap(); weight.typeText("65") }
        let log = app.webViews.buttons["Log"].firstMatch
        if log.waitForExistence(timeout: 2) { log.tap() }
        pause(1.5)
        shot("t2-logged")
        web("Plan").tap()
        pause(1.2)
        shot("t3-plan")
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Wed · Lower")).firstMatch.tap()
        pause(1.2)
        shot("t4-plan-day")
        web("Back").tap()
        pause(0.8)
        web("Progress").tap()
        pause(1.5)
        shot("t5-progress")
        web("Squat").tap()
        pause(1)
        web("Settings").tap()
        pause(1)
        shot("t6-settings")
        web("lb").tap()
        pause(0.8)
        web("Back").tap()
        pause(1.2)
        shot("t7-progress-lb")
        mark("training-end")
        pause(1)
    }

    /// What a page sees of the keyboard and the bottom edge (for best-apps).
    func testViewportProbe() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/viewport-probe.html"])
        pause(2.5)
        shot("vp1-rest")
        let f = app.webViews.textFields["Probe field"].firstMatch
        if f.waitForExistence(timeout: 3) { f.tap() }
        pause(1.5)
        shot("vp2-keyboard")
    }

    /// An app that restyles everything amber-base.css gives it.
    func testLedger() {
        launch(["-open", "October budget", "-seedPage", "October budget=\(pages)/budget-ledger.html"])
        mark("ledger-start")
        pause(2.5)
        shot("l1-ledger")
        let item = app.webViews.textFields["Item"].firstMatch
        if item.waitForExistence(timeout: 3) { item.tap(); item.typeText("Books") }
        let amount = app.webViews.textFields["Amount"].firstMatch
        if amount.waitForExistence(timeout: 2) { amount.tap(); amount.typeText("349") }
        pause(0.8)
        shot("l2-typing")
        app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "Enter")).firstMatch.tap()
        pause(1.5)
        shot("l3-entered")
        mark("ledger-end")
        pause(1)
    }

    func webStarting(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    }

    /// Training as a scaffolded project (index.html, src/main.jsx, App.jsx, screens, components,
    /// styles.css, data.js) on amber-ui: a sheet with the keyboard, tabs, a pushed screen, settings.
    func testTrainingProject() {
        launch(["-seedNote", "\(pages)/training.md", "-open", "Training", "-seedPage", "Training=\(pages)/training-app.json"])
        mark("project-start")
        pause(3.5)
        shot("p1-today")
        webStarting("Bench press").tap()
        pause(1.5)
        shot("p2-sheet-keyboard")
        let field = app.webViews.textFields.firstMatch
        if field.waitForExistence(timeout: 2) { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5) + "65") }
        pause(0.6)
        app.webViews.buttons["Log Set"].firstMatch.tap()
        pause(1.5)
        shot("p3-logged")
        web("Plan").tap()
        pause(1.2)
        shot("p4-plan")
        webStarting("Wed · Lower").tap()
        pause(1.2)
        shot("p5-plan-day")
        web("Back").tap()
        pause(0.8)
        web("Progress").tap()
        pause(1.5)
        shot("p6-progress")
        web("Settings").tap()
        pause(1)
        web("lb").tap()
        pause(0.8)
        shot("p7-settings")
        web("Back").tap()
        pause(1.2)
        shot("p8-progress-lb")
        mark("project-end")
        pause(1)
    }

    /// No Text side: the app note opens straight into the app; its data is JSON, imported once
    /// from the note's tables; the note list shows the app's summary line.
    func testAppOnly() {
        launch(["-seedNote", "\(pages)/training.md", "-open", "Training", "-seedPage", "Training=\(pages)/training-app.json"])
        mark("apponly-start")
        pause(3.5)
        shot("a1-opens-in-app")
        app.buttons["editor.more"].firstMatch.tap()
        pause(1)
        shot("a2-more")
        app.buttons["editor.appInfo"].firstMatch.tap()
        pause(1)
        app.buttons["appInfo.done"].firstMatch.tap()
        pause(0.8)
        webStarting("Barbell row").tap()
        pause(1.2)
        let field = app.webViews.textFields.firstMatch
        if field.waitForExistence(timeout: 2) { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5) + "52.5") }
        app.webViews.buttons["Log Set"].firstMatch.tap()
        pause(1.5)
        shot("a3-data-receipt")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(1.5)
        shot("a4-list-summary")
        mark("apponly-end")
        pause(1)
    }
}
