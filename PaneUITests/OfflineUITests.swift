#if os(iOS)
import XCTest

/// Amber Notes on a plane, in the simulator, against a local stack (never production). Run in
/// order by scripts/offline-ios.sh, which makes the account and checks the server afterwards:
///
/// 1. Sign in, write a note, go offline with the debug toggle (DebugOffline), write and edit while
///    offline, look at Settings, come back: the offline line goes and everything goes up.
/// 2. Open the app with no network at all (`-netOffline`), the key already on the device: the notes
///    open at once, can be edited, and a file that isn't downloaded says so.
/// 3. Open it again online: what was written offline goes up.
///
/// Needs PANE_EMAIL and PANE_PASSWORD (TEST_RUNNER_ prefixed); PANE_SHOTS keeps the screenshots.
final class OfflineUITests: XCTestCase {
    var app: XCUIApplication!
    var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["PANE_SHOTS"] {
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        }
    }

    /// The debug toggle, through a Darwin notification the app listens for.
    private func network(up: Bool) {
        let name = up ? "dev.emilwagman.pane.debug.online" : "dev.emilwagman.pane.debug.offline"
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
    }

    private var offlineLine: XCUIElement { app.descendants(matching: .any)["sync.offline"].firstMatch }

    /// Sheets a new account may see first.
    private func dismissFirstRunSheets() {
        for id in ["e2ee.continue", "heardFrom.skip", "shareAsk.notNow", "whatsNew.dismiss"] {
            let b = app.buttons[id]
            if b.waitForExistence(timeout: 1.5) { b.tap() }
        }
    }

    /// Launch reopens the note you were in: back to its list.
    private func toList() {
        let compose = app.buttons["list.newNote"]
        for _ in 0..<3 where !compose.waitForExistence(timeout: 2) { back() }
    }

    private func newNote(_ text: String) {
        toList()
        let compose = app.buttons["list.newNote"]
        XCTAssertTrue(compose.waitForExistence(timeout: 10))
        compose.tap()
        let editor = app.textViews["editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.typeText(text)
        back()
    }

    private func back() {
        app.navigationBars.element(boundBy: 0).buttons.element(boundBy: 0).tap()
    }

    /// Back to the folder list, from wherever launch put us.
    private func toFolders() {
        for _ in 0..<3 where !app.navigationBars["Amber Notes"].exists { back(); _ = app.navigationBars["Amber Notes"].waitForExistence(timeout: 1.5) }
    }

    func test1_WorkOfflineAndComeBack() throws {
        guard let email = env["PANE_EMAIL"], let password = env["PANE_PASSWORD"] else { throw XCTSkip("No account configured") }
        app.launchArguments = ["-signout", "-skipWelcome", "-netToggle", "-offlineSampleFile"]
        app.launch()
        let field = app.textFields["signin.email"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        field.typeText(email)
        app.buttons["signin.submit"].tap()
        let pw = app.secureTextFields["signin.password"]
        XCTAssertTrue(pw.waitForExistence(timeout: 10))
        pw.tap()
        pw.typeText(password)
        app.buttons["signin.submit"].tap()
        dismissFirstRunSheets()

        newNote("Packing list\n- [ ] Passport\n- [ ] Charger")
        // Synced before the network goes.
        Thread.sleep(forTimeInterval: 3)
        XCTAssertFalse(offlineLine.exists, "online: no line")

        network(up: false)
        XCTAssertTrue(offlineLine.waitForExistence(timeout: 5), "offline: the line shows")
        XCTAssertEqual(offlineLine.label, "Offline")
        shot("offline-list")

        newNote("Written on the plane\nThe notes work as usual.")
        XCTAssertTrue(offlineLine.waitForExistence(timeout: 3))
        XCTAssertEqual(offlineLine.label, "Offline \u{00B7} changes sync later", "edits are waiting")
        shot("offline-changes-waiting")

        toFolders()
        XCTAssertTrue(offlineLine.waitForExistence(timeout: 3), "the folder list says it too")
        shot("offline-folders")
        app.buttons["sidebar.settings"].tap()
        let note = app.staticTexts["settings.offline"]
        XCTAssertTrue(note.waitForExistence(timeout: 5), "Settings says what needs the internet")
        XCTAssertFalse(app.buttons["connect.guide.chatgpt"].isEnabled, "connecting an AI waits for the internet")
        shot("offline-settings")
        app.buttons["Done"].tap()

        network(up: true)
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: offlineLine)
        waitForExpectations(timeout: 15)
        shot("back-online")
    }

    func test2_OpenOfflineWithTheKeyHere() throws {
        app.launchArguments = ["-netOffline", "-netToggle", "-skipWelcome", "-forgetDownloads"]
        let started = Date()
        app.launch()
        // The list, or the note you were in (launch reopens it).
        let open = app.buttons["list.newNote"].exists || app.textViews["editor"].exists
        let notes = NSPredicate { _, _ in self.app.buttons["list.newNote"].exists || self.app.textViews["editor"].exists }
        if !open { expectation(for: notes, evaluatedWith: NSNull()); waitForExpectations(timeout: 10) }
        let took = Date().timeIntervalSince(started)
        print("PERF launch with no network: notes after \(String(format: "%.2f", took)) s (including the app's launch)")
        XCTAssertFalse(app.textFields["signin.email"].exists, "still signed in")
        toList()
        XCTAssertTrue(offlineLine.waitForExistence(timeout: 5))
        shot("launch-offline")

        newNote("Landed soon\nWritten after opening the app offline.")
        Thread.sleep(forTimeInterval: 1)
        toFolders()
        let trip = app.cells.containing(.any, identifier: "folder.Trip").firstMatch
        XCTAssertTrue(trip.waitForExistence(timeout: 5))
        trip.tap()
        let file = app.descendants(matching: .any)["file.Boarding pass.txt"].firstMatch
        // Earlier runs leave notes above it, and a list makes rows only as they come into view.
        _ = app.buttons["list.newNote"].waitForExistence(timeout: 5)
        for _ in 0..<8 where !(file.exists && file.isHittable) { app.swipeUp() }
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        // The note just written is still sliding in above it.
        Thread.sleep(forTimeInterval: 1)
        file.tap()
        XCTAssertTrue(app.descendants(matching: .any)["file.notDownloaded"].firstMatch.waitForExistence(timeout: 5), "a file that isn't here says so, at once")
        shot("file-not-downloaded")

        // Back online, the file comes by itself.
        network(up: true)
        XCTAssertTrue(app.descendants(matching: .any)["file.preview"].firstMatch.waitForExistence(timeout: 20), "back online, it opens")
        shot("file-downloaded")
    }
}
#endif
