#if os(iOS)
import XCTest

/// The share extension for real: Safari's share sheet → Amber Notes → Save → the app files it.
/// Needs a build that carries the app group (sign ad hoc, not CODE_SIGNING_ALLOWED=NO), and a
/// simulator with network access for the page. Opt-in (AMBER_SHARE_E2E=1): ad-hoc simulator
/// builds get no App Group container, so Save only succeeds on a provisioned device.
final class ShareExtensionUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testShareAWebPageFromSafari() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["AMBER_SHARE_E2E"] == "1", "opt-in: set AMBER_SHARE_E2E=1")
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        // Type the address.
        let address = safari.textFields["TabBarItemTitle"].exists ? safari.textFields["TabBarItemTitle"] : safari.buttons["TabBarItemTitle"]
        if address.waitForExistence(timeout: 10) { address.tap() }
        let field = safari.textFields["URL"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "Safari's address field")
        field.typeText("https://example.com\n")
        // Safari exposes page text letter by letter, so wait on the page instead of its heading.
        _ = safari.webViews.firstMatch.waitForExistence(timeout: 30)
        sleep(3)

        // Share → Amber Notes.
        // iOS 26 Safari keeps Share inside its More (⋯) menu.
        let moreMenu = safari.buttons["MoreMenuButton"]
        if moreMenu.waitForExistence(timeout: 10) { moreMenu.tap() }
        let share = safari.buttons["Share"].firstMatch.exists ? safari.buttons["Share"].firstMatch : safari.buttons["ShareButton"]
        XCTAssertTrue(share.waitForExistence(timeout: 10), "Safari's Share")
        share.tap()
        var target = safari.cells["Pinto Notes"]
        if !target.waitForExistence(timeout: 5) {
            target = safari.buttons["Pinto Notes"]
        }
        if !target.waitForExistence(timeout: 5) {
            // Not in the row of apps yet: More reveals every share extension.
            let more = safari.cells["More"].exists ? safari.cells["More"] : safari.buttons["More"]
            if more.waitForExistence(timeout: 5) { more.tap() }
            target = safari.cells["Pinto Notes"].exists ? safari.cells["Pinto Notes"] : safari.buttons["Pinto Notes"]
        }
        XCTAssertTrue(target.waitForExistence(timeout: 10), "Pinto Notes in the share sheet")
        attach(safari, "share-sheet")
        target.tap()

        // The extension's own sheet.
        let save = safari.buttons["share.save"]
        XCTAssertTrue(save.waitForExistence(timeout: 15), "the extension's Save button")
        let deadline = Date().addingTimeInterval(10)
        while !save.isEnabled && Date() < deadline { usleep(200_000) }
        attach(safari, "extension-sheet")
        save.tap()
        sleep(1)
        attach(safari, "after-save")
        XCTAssertFalse(safari.staticTexts["share.error"].exists, "saving failed: " + safari.staticTexts["share.error"].label)
        XCTAssertTrue(save.waitForNonExistence(timeout: 10), "the sheet closes after saving")

        // The app files it on launch.
        let app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()
        let note = app.staticTexts["https://example.com/"].firstMatch
        let other = app.staticTexts["Example Domain"].firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 15) || other.exists, "the shared page arrived as a note")
        attach(app, "arrived")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
#endif
