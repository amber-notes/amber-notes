#if os(iOS)
import XCTest

/// iPhone: the note list opens with its large title showing, at launch just as
/// when you tap into a folder (it used to open collapsed at launch).
final class ListTitleUITests: XCTestCase {
    func testListOpensWithItsLargeTitle() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo"]
        app.launch()
        XCTAssertTrue(app.buttons["list.select"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.5)
        let atLaunch = app.staticTexts["Pinned"].firstMatch.frame.minY
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["All Notes"].firstMatch.waitForExistence(timeout: 3))
        app.staticTexts["All Notes"].firstMatch.tap()
        Thread.sleep(forTimeInterval: 1)
        let tappedIn = app.staticTexts["Pinned"].firstMatch.frame.minY
        if let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/title-reentered.png"))
        }
        XCTAssertEqual(atLaunch, tappedIn, accuracy: 2, "the first section sits under the large title both times")
    }
}
#endif
