import XCTest

/// Note apps (prototype), the best-apps set: each app opened with its demo data and used, for the
/// recordings and screenshots of scripts/best-apps-ios.sh. Apps and data come from
/// demo/note-pages/best ($BEST_DIR); screenshots go to $PANE_SHOTS.
final class BestAppsUITests: XCTestCase {
    var app: XCUIApplication!
    let dir = ProcessInfo.processInfo.environment["BEST_DIR"] ?? ""
    let shots = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? "/tmp/pane-shots"
    var prefix: String { ProcessInfo.processInfo.environment["SHOT_PREFIX"] ?? "" }

    override func setUp() { continueAfterFailure = true }

    func launch(_ title: String, _ extra: [String] = []) {
        app = XCUIApplication()
        let libs = ProcessInfo.processInfo.environment["INLINE_LIBS"].flatMap { $0.isEmpty ? nil : ["-inlineLibs", $0] } ?? []
        app.launchArguments = ["-uitest", "-bestApps", dir, "-open", title] + libs + extra
        app.launch()
    }

    func shot(_ name: String) {
        try? FileManager.default.createDirectory(atPath: shots, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(shots)/\(prefix)\(name).png"))
    }

    /// A marker the recording script reads to trim the clip.
    func mark(_ name: String) {
        try? "\(Date().timeIntervalSince1970)".write(toFile: "\(shots)/mark-\(name).txt", atomically: true, encoding: .utf8)
    }

    func pause(_ s: Double) { Thread.sleep(forTimeInterval: s) }

    func web(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    func webBegins(_ label: String) -> XCUIElement {
        app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    }

    @discardableResult func tap(_ e: XCUIElement, wait: Double = 5, then: Double = 0.9) -> Bool {
        guard e.waitForExistence(timeout: wait) else { XCTFail("missing \(e)"); return false }
        e.tap()
        pause(then)
        return true
    }

    func type(_ e: XCUIElement, _ text: String) {
        guard e.waitForExistence(timeout: 5) else { XCTFail("missing field \(e)"); return }
        e.tap()
        pause(0.3)
        e.typeText(text)
    }

    func scroll(_ dy: CGFloat) {
        let w = app.webViews.firstMatch
        let start = w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        start.press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7 - dy)))
        pause(0.8)
    }

    /// Text / App: the toolbar button shows the one you'd switch to.
    func mode(_ name: String) {
        let b = app.buttons["note.mode"].firstMatch
        XCTAssertTrue(b.waitForExistence(timeout: 5))
        if b.label == "Show \(name)" { b.tap() }
        pause(1.2)
    }

    /// Still pictures of every app, at the top and scrolled.
    func testStills() {
        let only = ProcessInfo.processInfo.environment["ONLY"].flatMap { $0.isEmpty ? nil : $0 }.map { Set($0.split(separator: ",").map(String.init)) }
        for (dirName, title) in [("habits", "Habits"), ("money", "Money"), ("training", "Training"), ("reading", "Reading"),
                                 ("trip", "Rome"), ("people", "People"), ("kitchen", "Kitchen"), ("study", "Biology: the cell"), ("words", "Swedish words"), ("beat", "Beat"), ("shelf", "Bookshelf")] {
            guard FileManager.default.fileExists(atPath: "\(dir)/\(dirName)/app.html"), only?.contains(dirName) ?? true else { continue }
            launch(title)
            pause(1.5)
            if dirName == "trip" { allowHost(wait: 4); pause(3) }
            pause(1.5)
            shot("\(dirName)-top")
            scroll(0.55)
            shot("\(dirName)-scrolled")
            app.terminate()
        }
    }

    /// The system's own permission prompts (Reminders, notifications) on the simulator.
    func allowSystem(_ labels: [String] = ["Allow Full Access", "Allow", "OK"], wait: Double = 4) {
        let sb = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for l in labels {
            let b = sb.buttons[l].firstMatch
            if b.waitForExistence(timeout: l == labels.first ? wait : 0.5) { pause(0.6); b.tap(); pause(0.8); return }
        }
    }

    /// The app's own "This app wants to reach …" question.
    func allowHost(wait: Double = 6) {
        let b = app.alerts.buttons["Allow"].firstMatch
        if b.waitForExistence(timeout: wait) { pause(0.9); b.tap(); pause(0.6) }
    }

    /// A web button by its label; buttons with aria-pressed come through as toggles.
    func button(_ label: String) -> XCUIElement {
        let end = Date().addingTimeInterval(5)
        repeat {
            for q in [app.webViews.buttons, app.webViews.toggles, app.webViews.switches, app.webViews.cells] where q[label].firstMatch.exists { return q[label].firstMatch }
            pause(0.25)
        } while Date() < end
        let any = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        return any.exists ? any : app.webViews.buttons[label].firstMatch
    }

    /// A tab in the app's own tab bar.
    func tabTo(_ label: String) {
        // The tab bar is the lowest row of the page: pick the item whose label starts with this name.
        let snap = webSnapshot()
        let bottom = snap.filter { $0.label == label || $0.label.hasPrefix(label + " ") }.max { $0.frame.minY < $1.frame.minY }
        if let b = bottom { tapAt(b.frame); pause(1.0) } else { XCTFail("no tab \(label)") }
    }

    /// Today's note with the habits widget: tick from the widget, open the app, finish the day.
    func testHabits() {
        launch("Today")
        pause(4.0)
        mark("start")
        tap(app.descendants(matching: .any)["widget.Habits"].firstMatch, then: 1.0)
        tap(webBegins("Read,"), wait: 10, then: 1.2)
        tap(webBegins("Walk,"), then: 1.4)
        tap(app.buttons["widget.open.Habits"].firstMatch, then: 2.2)
        tap(webBegins("Stretch,"), then: 1.0)
        tap(webBegins("No phone in bed,"), then: 2.4)
        shot("habits-done")
        tabTo("Progress"); pause(1.0)
        scroll(0.5); pause(1.2)
        shot("habits-history")
        tabTo("Today"); pause(0.8)
        mode("Text"); pause(2.2)
        mark("end")
    }

    func testMoney() {
        launch("Money")
        pause(2.2)
        mark("start")
        tap(button("Add spending"), then: 0.8)
        app.typeText("149")
        type(app.webViews.textFields["What"].firstMatch, "Lunch at Bröd & Salt")
        tap(button("Eating out"), then: 0.5)
        tap(app.webViews.buttons.matching(NSPredicate(format: "label == 'Add'")).element(boundBy: 0), then: 1.8)
        tabTo("Budgets"); pause(1.6)
        tabTo("Spending")
        tap(button("Import from your bank"), then: 0.8)
        type(app.webViews.textViews.firstMatch, "2026-10-04;Willys Hornstull;-642,50\n2026-10-04;Swish Linnea Berg;-150,00\n2026-10-05;Voi scooter;-27,00\n2026-10-05;Max Burgers;-119,00")
        pause(1.0)
        tap(webBegins("Add 4"), then: 1.8)
        shot("money-imported")
        mode("Text"); pause(2.0)
        shot("money-text")
        mark("end")
    }

    func testTraining() {
        launch("Training")
        pause(2.2)
        mark("start")
        tap(button("Start"), then: 1.4)
        tap(button("Heavier"), then: 0.6)
        tap(button("Done"), then: 0.8)
        allowSystem(["Allow"], wait: 3)
        pause(1.8)
        shot("training-rest")
        tap(button("Skip rest"), then: 0.8)
        for _ in 0..<4 { tap(button("Done"), then: 0.6); tap(button("Skip rest"), then: 0.5) }
        pause(0.6)
        tap(button("Finish early"), then: 2.2)
        shot("training-record")
        tabTo("Plan"); pause(1.2)
        tabTo("Progress"); pause(1.6)
        mark("end")
    }

    func testReading() {
        launch("Reading")
        pause(2.2)
        mark("start")
        tap(app.webViews.buttons.matching(NSPredicate(format: "label == 'Update page'")).element(boundBy: 0), then: 0.9)
        let pg = app.webViews.textFields["Page"].firstMatch
        if pg.waitForExistence(timeout: 3) { pg.tap(); pg.doubleTap(); pause(0.3); app.typeText("348") }
        tap(button("Save"), then: 1.6)
        tap(button("Add a book"), then: 0.8)
        type(app.webViews.textFields["Title or author"].firstMatch, "Pippi Longstocking")
        tap(button("Search"), then: 0.4)
        allowHost()
        pause(3.5)
        allowHost(wait: 2)
        pause(2.5)
        shot("reading-search")
        tap(webBegins("Add Pippi"), then: 1.8)
        shot("reading-added")
        scroll(0.4); pause(1.4)
        mark("end")
    }

    func testTrip() {
        launch("Rome")
        pause(1.0)
        mark("start")
        allowHost(wait: 5)
        pause(2.8)
        shot("trip-top")
        tap(webBegins("Saturday"), then: 2.4)
        shot("trip-saturday")
        scroll(0.5); pause(0.8)
        tabTo("Packing")
        tap(app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == 'Passports'")).firstMatch, then: 0.8)
        tabTo("Costs")
        tap(button("Add a shared cost"), then: 0.8)
        type(app.webViews.textFields["What"].firstMatch, "Dinner at Da Remo")
        type(app.webViews.textFields["Amount (kr)"].firstMatch, "1140")
        tap(button("Linnea"), then: 0.4)
        tap(button("Add cost"), then: 2.4)
        shot("trip-costs")
        mark("end")
    }

    func testPeople() {
        launch("People")
        pause(2.2)
        mark("start")
        tap(app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS 'Talked today'")).element(boundBy: 1), then: 1.2)
        tap(button("Coffee"), then: 0.3)
        type(app.webViews.textViews.firstMatch, "Moving into the new flat in Malmö in November.")
        tap(button("Save"), then: 1.4)
        tap(webBegins("Remind me"), then: 0.5)
        allowSystem(["Allow Full Access", "Allow"], wait: 4)
        pause(1.2)
        shot("people-caught-up")
        tabTo("Birthdays"); pause(1.4)
        tabTo("Everyone")
        tap(button("Add someone"), then: 1.6)
        let kate = app.staticTexts["Kate Bell"].firstMatch
        if kate.waitForExistence(timeout: 4) { kate.tap(); pause(1.2) }
        tap(app.webViews.buttons.matching(NSPredicate(format: "label == 'Add'")).element(boundBy: 0), then: 1.6)
        scroll(0.5); pause(1.4)
        shot("people-everyone")
        mark("end")
    }

    func testKitchen() {
        launch("Kitchen")
        pause(2.2)
        mark("start")
        tabTo("Week")
        tap(webBegins("Wed"), then: 0.9)
        tap(webBegins("Shakshuka"), then: 1.4)
        tap(button("Make grocery list"), then: 1.6)
        scroll(0.3); pause(0.6)
        tap(button("Put it in the note"), then: 1.8)
        for name in ["2 dl crème fraîche", "1 avocado", "4 eggs"] {
            let e = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", name)).firstMatch
            if e.exists { e.tap(); pause(0.5) }
        }
        shot("kitchen-list")
        mode("Text"); pause(2.2); mode("App")
        tabTo("Tonight")
        tap(button("Start cooking"), then: 1.2)
        tap(webBegins("Start a 9 minute timer"), then: 0.6)
        allowSystem(["Allow"], wait: 3)
        pause(1.8)
        shot("kitchen-cook")
        mark("end")
    }

    func testStudy() {
        launch("Biology: the cell")
        pause(2.2)
        mark("start")
        tap(button("Study now"), then: 1.4)
        for g in ["Good", "Easy", "Good", "Again"] {
            tap(button("Show answer"), then: 1.3)
            tap(webBegins(g), then: 0.9)
        }
        shot("study-review")
        tap(button("Stop reviewing"), then: 1.2)
        tabTo("Cards")
        let s = button("Suggest cards")
        for _ in 0..<4 where !s.isHittable { scroll(0.5) }
        tap(s, then: 1.2)
        scroll(0.35); pause(0.8)
        shot("study-suggest")
        tap(webBegins("Add card"), then: 2.0)
        mark("end")
    }

    /// Undo on the receipt takes back what an app wrote: a cell, a whole section, and the app's own data.
    func testUndo() {
        var undo: XCUIElement { app.buttons["Undo"].firstMatch }
        launch("Habits")
        pause(3)
        tap(webBegins("Read, not done"), then: 1.2)
        XCTAssertTrue(webBegins("Read, done").waitForExistence(timeout: 3), "the tick shows")
        tap(undo, then: 1.5)
        XCTAssertTrue(webBegins("Read, not done").waitForExistence(timeout: 3), "Undo takes the tick back")
        shot("undo-habits")
        app.terminate()

        launch("Kitchen")
        pause(3)
        tap(button("Make grocery list"), then: 1.2)
        tap(button("Put it in the note"), then: 1.5)
        XCTAssertTrue(web("Coffee").exists)
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '0 of'")).firstMatch.waitForExistence(timeout: 3), "the list is written")
        tap(undo, then: 1.5)
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '1 of 2'")).firstMatch.waitForExistence(timeout: 3), "Undo brings the old list back")
        shot("undo-kitchen")
        app.terminate()

        launch("Training")
        pause(3)
        tap(button("Start workout"), then: 1.5)
        XCTAssertTrue(button("Discard").exists, "the workout started")
        tap(undo, then: 1.5)
        XCTAssertTrue(button("Start workout").waitForExistence(timeout: 3), "Undo takes the app's data back")
        shot("undo-training")
    }

    // MARK: The fun ones

    /// Everything on screen in the web view, read in one go (labels and frames), so a game can be
    /// played at a human pace instead of one slow query per tile.
    func webSnapshot() -> [(label: String, frame: CGRect)] {
        guard let root = try? app.webViews.firstMatch.snapshot() else { return [] }
        var out: [(String, CGRect)] = []
        func walk(_ s: XCUIElementSnapshot) { if !s.label.isEmpty { out.append((s.label, s.frame)) }; s.children.forEach(walk) }
        walk(root)
        return out
    }

    func tapAt(_ f: CGRect) {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: f.midX, dy: f.midY)).tap()
    }

    /// Word Rush, played: the pairs come from the note's own table.
    func testWords() {
        let md = (try? String(contentsOfFile: "\(dir)/words/note.md", encoding: .utf8)) ?? ""
        var answer: [String: String] = [:]
        for line in md.split(separator: "\n") where line.hasPrefix("| ") && !line.contains("---") {
            let c = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
            if c.count >= 2, c[0] != "Svenska" { answer[c[0]] = c[1] }
        }
        launch("Swedish words")
        pause(2.5)
        mark("start")
        tap(button("Play"), then: 0.6)
        let end = Date().addingTimeInterval(24)
        var missed = false
        while Date() < end {
            let snap = webSnapshot()
            let tiles = snap.filter { $0.frame.height > 40 && $0.frame.height < 120 }
            guard let left = tiles.first(where: { answer[$0.label] != nil }) else { pause(0.3); continue }
            let want = missed ? "" : answer[left.label]!
            // One honest mistake, early on, to show what a miss does.
            if !missed, Date() > end.addingTimeInterval(-16), let wrong = tiles.first(where: { $0.label != answer[left.label] && answer[$0.label] == nil && $0.frame.minX > left.frame.maxX }) {
                tapAt(left.frame); pause(0.15); tapAt(wrong.frame); pause(0.6); missed = true; continue
            }
            guard let right = tiles.first(where: { $0.label == (want.isEmpty ? answer[left.label]! : want) }) else { pause(0.3); continue }
            tapAt(left.frame); pause(0.12); tapAt(right.frame); pause(0.45)
        }
        shot("words-playing")
        // The round runs out on its own.
        let over = app.webViews.staticTexts["Round over"].firstMatch
        _ = over.waitForExistence(timeout: 12)
        pause(2.2)
        shot("words-result")
        mark("end")
    }

    /// Beat, played: the pattern runs, pads change the note, the Fill pattern follows.
    func testBeat() {
        launch("Beat")
        pause(2.5)
        mark("start")
        tap(button("Play"), then: 2.4)
        func pad(_ prefix: String) {
            let snap = webSnapshot()
            try? snap.map { "\($0.label) \($0.frame)" }.joined(separator: "\n").write(toFile: "\(shots)/beat-labels.txt", atomically: true, encoding: .utf8)
            if let p = snap.first(where: { $0.label.hasPrefix(prefix) && $0.frame.height > 20 }) { tapAt(p.frame); pause(0.8) } else { XCTFail("no pad \(prefix)") }
        }
        pad("Snare step 4"); pad("Clap step 8"); pad("Bass step 3"); pad("Bass step 3")
        pause(1.6)
        shot("beat-playing")
        tap(button("Fill"), then: 2.6)
        tap(button("Groove"), then: 1.6)
        mode("Text"); pause(2.2); mode("App"); pause(1.2)
        shot("beat-text")
        tap(button("Stop"), then: 0.8)
        mark("end")
    }

    /// The 3D bookshelf: look around, pull a book out, move it to another shelf. Logs the frame rate.
    func testShelf() {
        launch("Bookshelf")
        pause(3.5)
        mark("start")
        let canvas = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Bookshelf. Use'")).firstMatch
        guard canvas.waitForExistence(timeout: 6) else { XCTFail("no canvas"); return }
        let c = canvas.frame
        let mid = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: c.midX, dy: c.midY))
        mid.press(forDuration: 0.05, thenDragTo: mid.withOffset(CGVector(dx: 110, dy: 30)), withVelocity: XCUIGestureVelocity(70), thenHoldForDuration: 0.1)
        pause(1.2)
        mid.press(forDuration: 0.05, thenDragTo: mid.withOffset(CGVector(dx: -150, dy: -20)), withVelocity: XCUIGestureVelocity(70), thenHoldForDuration: 0.1)
        pause(1.4)
        let rate = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Frame rate'")).firstMatch
        if rate.exists { print("SHELF \(rate.label)"); try? rate.label.write(toFile: "\(shots)/shelf-fps-iphone.txt", atomically: true, encoding: .utf8) }
        // A book on the read shelf: pull it out.
        for (fx, fy) in [(0.42, 0.42), (0.5, 0.45), (0.38, 0.6), (0.55, 0.62)] {
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: c.minX + c.width * fx, dy: c.minY + c.height * fy)).tap()
            pause(1.6)
            if button("Up next").exists { break }
        }
        shot("shelf-picked")
        pause(1.2)
        tap(button("5 stars"), then: 1.0)
        tap(button("Up next"), then: 2.4)
        shot("shelf-moved")
        mid.press(forDuration: 0.05, thenDragTo: mid.withOffset(CGVector(dx: 80, dy: 40)), withVelocity: XCUIGestureVelocity(60), thenHoldForDuration: 0.1)
        pause(1.8)
        mark("end")
    }
}
