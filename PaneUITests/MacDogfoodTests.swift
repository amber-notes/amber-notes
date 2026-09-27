#if os(macOS)
import XCTest

/// The Mac version of the everyday flow: keyboard-first, with drag and drop.
final class MacDogfoodTests: XCTestCase {
    var app: XCUIApplication!
    var step = 0

    override func setUp() {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-uitest", "-demo"]
        app.launch()
        app.activate()
    }

    func shot(_ name: String) {
        step += 1
        let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? "/tmp/pane-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let shot = app.windows.firstMatch.screenshot()
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(String(format: "%02d", step))-\(name).png"))
        let a = XCTAttachment(screenshot: shot)
        a.name = "\(String(format: "%02d", step))-\(name)"
        a.lifetime = .keepAlways
        add(a)
    }

    func pause(_ s: Double = 0.7) { Thread.sleep(forTimeInterval: s) }

    func row(_ title: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: "note.\(title)").firstMatch }
    func sidebar(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    func testMacFlow() throws {
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 5))
        pause(1)
        shot("launch")

        row("Welcome to Pane").click()
        pause(1)
        shot("welcome")

        // New note with ⌘N and write.
        app.typeKey("n", modifierFlags: .command)
        pause()
        let editor = app.textViews["editor"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 3))
        editor.typeText("Book club\n")
        editor.typeText("Next meeting is **Thursday**.\n\n")
        editor.typeText("## To read\n- [ ] Piranesi\nKlara and the Sun\n\n")
        editor.typeText("| Book | Rating |\n| --- | --- |\n| Piranesi | 5 |\n| Circe | 4 |\n\n")
        editor.typeText("Done for now.")
        pause()
        shot("typed")

        // Click away from the editor so the syntax hides.
        row("Groceries").click()
        pause()
        row("Book club").click()
        pause()
        shot("read")

        // Drag the note into the Ideas folder.
        let ideas = sidebar("folder.Ideas")
        row("Book club").press(forDuration: 0.4, thenDragTo: ideas)
        pause(1)
        ideas.click()
        pause(1)
        shot("dragged-into-ideas")
        XCTAssertTrue(row("Book club").waitForExistence(timeout: 2), "Note should be in Ideas after the drop")

        // Search.
        let search = app.searchFields.firstMatch
        search.click()
        search.typeText("piranesi")
        pause(1)
        shot("search")
        search.typeKey(.escape, modifierFlags: [])
        pause()

        // Delete with the keyboard.
        sidebar("sidebar.all").click()
        pause()
        row("App ideas").click()
        pause()
        app.typeKey(.delete, modifierFlags: .command)
        pause()
        sidebar("sidebar.trash").click()
        pause(1)
        shot("recently-deleted")
    }
}
#endif
