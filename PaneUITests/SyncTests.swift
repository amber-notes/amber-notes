import XCTest

/// Sync against the local Supabase stack: sign in, pull, live AI edits, push.
/// Needs PANE_MCP_URL, PANE_TOKEN, PANE_EMAIL, PANE_PASSWORD (TEST_RUNNER_ prefixed).
final class SyncTests: XCTestCase {
    var env: [String: String] { ProcessInfo.processInfo.environment }
    var step = 0

    func shot(_ app: XCUIApplication, _ name: String) {
        step += 1
        let shot = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: shot)
        a.name = String(format: "%02d-%@", step, name)
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["PANE_SHOTS"] {
            try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(dir)/\(a.name!).png"))
        }
    }

    func mcp(_ tool: String, _ args: [String: Any]) throws -> [String: Any] {
        var req = URLRequest(url: URL(string: env["PANE_MCP_URL"]!)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("Bearer \(env["PANE_TOKEN"]!)", forHTTPHeaderField: "authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": ["name": tool, "arguments": args]])
        let done = expectation(description: tool)
        var out: [String: Any] = [:]
        URLSession.shared.dataTask(with: req) { data, _, _ in
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            out = (obj?["result"] as? [String: Any])?["structuredContent"] as? [String: Any] ?? [:]
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 15)
        return out
    }

    func testSignInPullLiveEditAndPush() throws {
        guard env["PANE_TOKEN"] != nil else { throw XCTSkip("No backend configured") }
        let stamp = String(UUID().uuidString.prefix(6))
        // A note that exists only on the server before the app starts.
        let created = try mcp("create_note", ["body": "Sync check \(stamp)\n\nWritten by the AI before sign-in.", "folder": "Sync"])
        let id = ((created["created"] as? [String: Any])?["id"] as? String) ?? ""
        XCTAssertFalse(id.isEmpty)

        let app = XCUIApplication()
        app.launchArguments = ["-synctest", "-signout"]
        app.launch()

        // Email first: type it, Continue, and the password field appears for an existing account.
        let email = app.textFields["signin.email"]
        XCTAssertTrue(email.waitForExistence(timeout: 10), "sign-in screen")
        shot(app, "sign-in")
        email.tap()
        email.typeText(env["PANE_EMAIL"]!)
        app.buttons["signin.submit"].tap() // Continue
        let password = app.secureTextFields["signin.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 10), "an existing account asks for its password")
        password.tap()
        password.typeText(env["PANE_PASSWORD"]!)
        app.buttons["signin.submit"].tap()

        let row = app.staticTexts["Sync check \(stamp)"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "the server's note should arrive")
        shot(app, "pulled")
        row.tap()
        let editor = app.textViews["editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 1)

        // The AI edits the open note; it should appear without touching anything.
        _ = try mcp("append_to_note", ["id": id, "text": "- [ ] Added live by the AI"])
        let live = NSPredicate(format: "value CONTAINS %@", "Added live by the AI")
        expectation(for: live, evaluatedWith: editor)
        waitForExpectations(timeout: 10)
        shot(app, "live-ai-edit")

        // Type in the app; the server should get it.
        editor.tap()
        editor.typeText("\nTyped on the phone \(stamp)")
        var body = ""
        for _ in 0..<20 {
            Thread.sleep(forTimeInterval: 1)
            body = (try mcp("read_note", ["id": id]))["markdown"] as? String ?? ""
            if body.contains("Typed on the phone \(stamp)") { break }
        }
        XCTAssertTrue(body.contains("Typed on the phone \(stamp)"), "the app's edit should reach the server: \(body)")
        shot(app, "pushed")
        _ = try mcp("delete_note", ["id": id])
    }
}
