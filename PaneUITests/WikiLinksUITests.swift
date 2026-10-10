#if os(iOS)
import XCTest

/// An Obsidian vault imported on iPhone, then used the way a person would: links followed by
/// tapping, a note a link names made from it, a link typed with `[[`, and "Linked from".
/// The vault comes from $WIKI_VAULT (scripts: TEST_RUNNER_WIKI_VAULT) through the real
/// importer, started by launch argument in place of the file picker. A screenshot per step goes
/// to $PANE_SHOTS.
final class WikiLinksUITests: XCTestCase {
    var app: XCUIApplication!
    var step = 0

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        let vault = ProcessInfo.processInfo.environment["WIKI_VAULT"] ?? ""
        app.launchArguments = ["-uitest", "-importVault", vault, "-openAfterImport", "Home"]
        app.launch()
    }

    func shot(_ name: String) {
        step += 1
        let dir = ProcessInfo.processInfo.environment["PANE_SHOTS"] ?? "/tmp/pane-shots"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(String(format: "%02d", step))-\(name).png"))
    }

    func pause(_ s: Double = 1.2) { Thread.sleep(forTimeInterval: s) }

    /// The editor's text, once it says `prefix` first.
    @discardableResult
    func editor(startingWith prefix: String) -> XCUIElement {
        let e = app.textViews["editor"]
        XCTAssertTrue(e.waitForExistence(timeout: 10))
        let deadline = Date.now.addingTimeInterval(10)
        while !((e.value as? String) ?? "").hasPrefix(prefix), Date.now < deadline { pause(0.2) }
        XCTAssertTrue(((e.value as? String) ?? "").hasPrefix(prefix), "expected \(prefix), got \(String(((e.value as? String) ?? "").prefix(40)))")
        return e
    }

    func tapLink(_ shown: String) {
        let link = app.textViews["editor"].links[shown]
        XCTAssertTrue(link.waitForExistence(timeout: 5), "no link \(shown)")
        link.tap()
    }

    func testFollowLinksInAnImportedVault() throws {
        editor(startingWith: "Home")
        pause(1.5)
        shot("home")

        tapLink("Inbox")
        editor(startingWith: "Inbox")
        pause()
        shot("inbox")

        tapLink("raised beds")
        editor(startingWith: "Garden")
        pause()
        shot("garden")

        // A link to a note that isn't written yet offers to make it.
        tapLink("Garden irrigation")
        let create = app.buttons["wiki.create"].firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        pause()
        shot("create-missing")
        create.tap()
        let made = editor(startingWith: "Garden irrigation")
        pause()
        // A fresh simulator's keyboard first explains slide to type.
        let onboarding = app.buttons["Continue"].firstMatch
        if onboarding.waitForExistence(timeout: 2) { onboarding.tap(); pause(0.6) }

        // Typing [[ offers titles in the bar above the keyboard.
        made.typeText("Drip line from the rain barrel to the [[kit")
        let suggestion = app.buttons["wiki.suggestion.0"].firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5))
        XCTAssertEqual(suggestion.label, "Kitchen remodel")
        pause()
        shot("typing-link")
        suggestion.tap()
        made.typeText(" plan.")
        pause()
        XCTAssertTrue(((made.value as? String) ?? "").contains("[[Kitchen remodel]] plan."))
        shot("typed-link")

        app.buttons["editor.done"].tap()
        pause()
        tapLink("Kitchen remodel")
        editor(startingWith: "Kitchen remodel")
        pause()
        shot("kitchen")

        // Linked from: every note that links here, including the one just written.
        app.buttons["editor.more"].firstMatch.tap()
        let linkedFrom = app.buttons["editor.backlinks"].firstMatch
        XCTAssertTrue(linkedFrom.waitForExistence(timeout: 5))
        pause()
        shot("more")
        linkedFrom.tap()
        pause(0.8)
        shot("linked-from-open")
        XCTAssertTrue(app.buttons["Garden irrigation"].firstMatch.waitForExistence(timeout: 5))
        pause()
        shot("linked-from")
        app.buttons["Budget 2026"].firstMatch.tap()
        editor(startingWith: "Budget 2026")
        pause(1.5)
        shot("budget")
    }
}
#endif
