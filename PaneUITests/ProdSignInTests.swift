import XCTest

/// Signs in to the configured backend and waits for the first sync (needs PANE_EMAIL/PANE_PASSWORD).
final class ProdSignInTests: XCTestCase {
    func testSignInAndFirstSync() throws {
        let env = ProcessInfo.processInfo.environment
        guard let email = env["PANE_EMAIL"], let password = env["PANE_PASSWORD"] else { throw XCTSkip("no credentials") }
        let app = XCUIApplication()
        app.launchArguments = ["-synctest", "-signout"]
        app.launch()
        let field = app.textFields["signin.email"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap(); field.typeText(email)
        let pw = app.secureTextFields["signin.password"]
        pw.tap(); pw.typeText(password)
        app.buttons["signin.submit"].tap()
        let welcome = app.staticTexts["Welcome to Amber Notes"].firstMatch
        XCTAssertTrue(welcome.waitForExistence(timeout: 30), "first sync should seed the library")
        Thread.sleep(forTimeInterval: 4) // let the seed push
        if let dir = env["PANE_SHOTS"] { try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/01-signed-in.png")) }
    }
}
