#if os(iOS)
import XCTest

/// Captures the app icon as it appears on the home screen.
final class HomeScreenTests: XCTestCase {
    func testIconOnHomeScreen() {
        let board = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        let icon = board.icons["Amber Notes"]
        var tries = 0
        while !icon.isHittable && tries < 4 { board.swipeLeft(); Thread.sleep(forTimeInterval: 0.8); tries += 1 }
        let shot = XCUIScreen.main.screenshot()
        if let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/01-home.png"))
        }
        XCTAssertTrue(icon.exists)
    }
}
#endif
