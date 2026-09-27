#if os(macOS)
import XCTest

/// Imports one real Apple Note into an in-memory library and captures how it renders.
final class MacImportTests: XCTestCase {
    func testImportOneNote() throws {
        let target = ProcessInfo.processInfo.environment["PANE_IMPORT_NOTE"] ?? "Buy list"
        let app = XCUIApplication()
        app.launchArguments = ["-uitest"]
        app.launch()
        app.activate()
        app.menuBars.menuBarItems["File"].click()
        app.menuItems["Import from Apple Notes…"].click()
        let filter = app.textFields["Filter"].firstMatch
        XCTAssertTrue(filter.waitForExistence(timeout: 15))
        filter.click()
        filter.typeText(target)
        let box = app.checkBoxes.matching(NSPredicate(format: "label BEGINSWITH %@", target)).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 10))
        box.click()
        app.buttons["Import 1 note"].click()
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 20))
        app.buttons["Done"].click()
        let title = target.hasPrefix("# ") ? String(target.dropFirst(2)) : target
        app.descendants(matching: .any).matching(identifier: "note.\(title)").firstMatch.click()
        Thread.sleep(forTimeInterval: 1.5)
        let a = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
        a.name = "01-imported"
        a.lifetime = .keepAlways
        add(a)
        let editor = app.textViews["editor"].firstMatch
        let text = editor.value as? String ?? ""
        let b = XCTAttachment(string: text)
        b.name = "02-markdown"
        b.lifetime = .keepAlways
        add(b)
    }
}
#endif
