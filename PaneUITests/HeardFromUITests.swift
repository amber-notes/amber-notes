#if os(iOS)
import XCTest

/// "How did you hear about Amber Notes?" over the library: one tap answers, Skip is one tap, and
/// "Something else" takes a few words first. `-forceHeardFrom` shows it without a server.
final class HeardFromUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo", "-forceHeardFrom"]
    }

    func shot(_ name: String) {
        let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? NSTemporaryDirectory()
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/heardfrom-\(name).png"))
    }

    func testOneTapAnswers() throws {
        app.launch()
        let row = app.buttons["heardFrom.tiktok"]
        XCTAssertTrue(row.waitForExistence(timeout: 8))
        shot("asking")
        row.tap()
        shot("tapped")
        XCTAssertTrue(app.buttons["list.select"].waitForExistence(timeout: 5))
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: row)
        wait(for: [gone], timeout: 3)
    }

    func testSkipIsOneTap() throws {
        app.launch()
        let skip = app.buttons["heardFrom.skip"]
        XCTAssertTrue(skip.waitForExistence(timeout: 8))
        skip.tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: skip)
        wait(for: [gone], timeout: 3)
    }

    func testSomethingElseTakesAFewWords() throws {
        app.launch()
        let other = app.buttons["heardFrom.other"]
        XCTAssertTrue(other.waitForExistence(timeout: 8))
        other.tap()
        let field = app.textFields["heardFrom.otherText"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.typeText("A newsletter")
        shot("other")
        app.buttons["heardFrom.otherDone"].tap()
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: field)
        wait(for: [gone], timeout: 3)
    }
}
#endif
