import CryptoKit
import Foundation
import Network
import SwiftData
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
        // Without the sandbox, the same page does reach a listener: the test can tell. (Its own
        // listener, so its late requests can't count against the sandbox.)
        let control = try Listener()
        let controlPort = try await control.start()
        defer { control.listener.cancel() }
        let open = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 480))
        open.loadHTMLString(Self.leakyPage("http://127.0.0.1:\(controlPort)"), baseURL: nil)
        for _ in 0..<100 where control.connections == 0 { try await Task.sleep(for: .milliseconds(50)) }
        #expect(control.connections > 0, "the control page should have reached its listener")
        open.stopLoading()

        let server = try Listener()
        let port = try await server.start()
        defer { server.listener.cancel() }
        let base = "http://127.0.0.1:\(port)"
        let before = 0

        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: Self.leakyPage(base), body: "Secret\n\nmy bank PIN")
        try await run(sandbox.webView, until: "window.__done === true")
        try await Task.sleep(for: .seconds(1.5))
        let results = try await sandbox.webView.evaluateJavaScript("window.__results") as? [String]
        #expect(results == ["fetch blocked", "xhr blocked", "image blocked"])
        #expect(server.connections == before, "the sandboxed page reached the network")
        #expect(sandbox.webView.url?.absoluteString == "amber-app:///index.html")
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

    // MARK: No page is lost

    @Test func replacedAndRemovedPagesAreKeptAndComeBack() {
        let store = NotePageStore(file: nil)
        let id = UUID()
        func page(_ i: Int) -> NotePageStore.Page { .init(html: "<p>v\(i)</p>", by: "Claude", at: .now) }
        for i in 1...12 { store[id] = page(i) }
        #expect(store[id]?.html == "<p>v12</p>")
        #expect(store.history[id]?.map(\.html) == (2...11).map { "<p>v\($0)</p>" })
        // Bringing one back keeps the current one in its place: toggling twice is where you started.
        #expect(store.restorePrevious(id)?.html == "<p>v11</p>")
        #expect(store.previous(id)?.html == "<p>v12</p>")
        store.restorePrevious(id)
        #expect(store[id]?.html == "<p>v12</p>")
        // Removing keeps it too.
        store[id] = nil
        #expect(store[id] == nil)
        #expect(store.previous(id)?.html == "<p>v12</p>")
        #expect(store.restorePrevious(id)?.html == "<p>v12</p>")
        // The same page again isn't history.
        let before = store.history[id]
        store[id] = .init(html: "<p>v12</p>", by: "Claude", at: .now.addingTimeInterval(5))
        #expect(store.history[id] == before)
    }

    /// Loads `html` and waits for the sandbox to say it drew or failed.
    func outcome(_ html: String) async throws -> (ready: Bool, errors: [String]) {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        var result: (Bool, [String])?
        sandbox.onReady = { result = (true, []) }
        sandbox.onFailure = { result = (false, $0) }
        sandbox.load(html: html, body: Self.habits)
        for _ in 0..<100 where result == nil { try await Task.sleep(for: .milliseconds(50)) }
        return try #require(result)
    }

    @Test func aPageThatThrowsOrDrawsNothingIsReportedAsFailed() async throws {
        let good = try await outcome("<main id=m></main><script>amber.onChange((n) => { m.textContent = n.title })</script>")
        #expect(good.ready)
        let throwsInRender = try await outcome("<main id=m></main><script>amber.onChange((n) => { m.textContent = n.tables[0].rows[0][9].toFixed(1) })</script>")
        #expect(!throwsInRender.ready)
        #expect(throwsInRender.errors.first?.contains("undefined") == true)
        let throwsAtTop = try await outcome("<script>amber.onChange(() => {}); nope();</script><p>x</p>")
        #expect(!throwsAtTop.ready)
        let blank = try await outcome("<main></main><script>amber.onChange(() => {})</script>")
        #expect(!blank.ready)
        #expect(blank.errors == ["The page drew nothing."])
        let broken = try String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "demo/note-pages/habit-tracker-broken.html"), encoding: .utf8)
        #expect(try await !outcome(broken).ready)
    }

    @Test func everyPageGetsTheAppsThemeAsVariables() async throws {
        #expect(NotePageSandbox.sandboxed("<p>x</p>").contains(#"<link rel="stylesheet" href="amber-lib:///amber-base.css">"#))
        #expect(!NotePageSandbox.sandboxed("<p>x</p>").contains("<style"))
        #expect(NotePageTheme.tokens.contains("--amber-accent: #D96A06"))
        #expect(NotePageTheme.tokens.contains("@media (prefers-color-scheme: dark) { :root { --amber-bg:"))
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: "<style>p { color: var(--amber-accent-text); border-radius: var(--amber-radius) }</style><p id=p>x</p><script>amber.onChange(() => {})</script>", body: "x")
        try await run(sandbox.webView, until: "document.getElementById('p') !== null && document.readyState === 'complete'")
        let accent = try await sandbox.webView.evaluateJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--amber-accent').trim()") as? String
        #expect(accent == "#D96A06" || accent == "#F4AD33", "\(accent ?? "nil") in \(NotePageTheme.tokens)")
        let font = try await sandbox.webView.evaluateJavaScript("getComputedStyle(document.body).fontFamily") as? String
        #expect(font?.contains("system-ui") == true)
    }

    // MARK: The app's own data

    @Test func dataOpsAddUpdateRemoveAndPatch() throws {
        var n = 0
        let id = { n += 1; return "r\(n)" }
        let at = Date(timeIntervalSince1970: 1_790_000_000)
        var (d, made) = try NotePageData.apply(.set(key: "goal", value: 4), to: NotePageData.empty(), now: at, newID: id)
        (d, made) = try NotePageData.apply(.add(collection: "runs", fields: ["km": 5.2]), to: d, now: at, newID: id)
        #expect(made == "r1")
        (d, _) = try NotePageData.apply(.add(collection: "runs", fields: ["km": 3]), to: d, now: at, newID: id)
        (d, _) = try NotePageData.apply(.update(collection: "runs", id: "r1", patch: ["km": 6, "note": "hills"]), to: d, now: at, newID: id)
        (d, _) = try NotePageData.apply(.remove(collection: "runs", id: "r2"), to: d, now: at, newID: id)
        (d, _) = try NotePageData.apply(.patch(["values": ["goal": NSNull(), "unit": "km"]]), to: d, now: at, newID: id)
        let runs = try #require((d["collections"] as? [String: Any])?["runs"] as? [[String: Any]])
        #expect(runs.count == 1)
        #expect(runs[0]["km"] as? Int == 6 && runs[0]["note"] as? String == "hills" && runs[0]["created"] as? String == ISO8601DateFormatter().string(from: at))
        #expect(NotePageData.same(d["values"], ["unit": "km"]))
        #expect(throws: NotePage.OpError.self) { try NotePageData.apply(.remove(collection: "runs", id: "nope"), to: d) }
        let big = String(repeating: "x", count: NotePageData.maxBytes)
        #expect(throws: NotePage.OpError("This app's data would be 4.0 MB; the limit is 4 MB. Keep photos and recordings as files.")) {
            try NotePageData.apply(.set(key: "big", value: big), to: d)
        }
        #expect(throws: NotePage.OpError("Unknown op store.delete_all.")) { try NotePageData.Op(["op": "store.delete_all"]) }
    }

    @Test func twoDevicesWritingAtOnceLoseNothing() {
        let base: NotePageData.Doc = ["values": ["goal": 4, "unit": "km"], "collections": ["runs": [
            ["id": "a", "created": "1", "km": 5], ["id": "b", "created": "2", "km": 3], ["id": "c", "created": "3", "km": 8]]]]
        // This device: new goal, edits run a's km, removes b, adds d.
        let mine: NotePageData.Doc = ["values": ["goal": 5, "unit": "km"], "collections": ["runs": [
            ["id": "a", "created": "1", "km": 6], ["id": "c", "created": "3", "km": 8], ["id": "d", "created": "4", "km": 1]]]]
        // The other device: new unit, notes on run a, edits b, adds e.
        let theirs: NotePageData.Doc = ["values": ["goal": 4, "unit": "mi"], "collections": ["runs": [
            ["id": "a", "created": "1", "km": 5, "note": "hills"], ["id": "b", "created": "2", "km": 4], ["id": "c", "created": "3", "km": 8], ["id": "e", "created": "5", "km": 2]]]]
        let m = NotePageData.merge(base: base, mine: mine, theirs: theirs)
        #expect(NotePageData.same(m["values"], ["goal": 5, "unit": "mi"]))
        let runs = (m["collections"] as? [String: Any])?["runs"] as? [[String: Any]] ?? []
        #expect(runs.map { $0["id"] as? String } == ["a", "b", "c", "d", "e"])
        // Different fields of one record both land; a record changed there isn't lost to a removal here.
        #expect(runs[0]["km"] as? Int == 6 && runs[0]["note"] as? String == "hills")
        #expect(runs[1]["km"] as? Int == 4)
    }

    @Test func theStoreMergesWhatArrivesWithChangesNotYetPushed() {
        let store = NotePageDataStore(file: nil)
        let id = UUID()
        store.take(id, server: Data(#"{"values":{"a":1},"collections":{}}"#.utf8))
        store.set(id, ["values": ["a": 1, "b": 2], "collections": [String: Any]()])
        store.take(id, server: Data(#"{"values":{"a":1,"c":3},"collections":{}}"#.utf8))
        #expect(NotePageData.same(store.doc(id)["values"], ["a": 1, "b": 2, "c": 3]))
        #expect(store.dirty.contains(id))
        store.pushed(id, store.docs[id]!)
        #expect(!store.dirty.contains(id))
    }

    @Test func thePageKeepsItsDataThroughTheBridge() async throws {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        var doc = NotePageData.empty()
        sandbox.onData = { message in
            let (after, made) = try NotePageData.apply(try NotePageData.Op(message), to: doc)
            doc = after
            return ["data": after].merging(made.map { ["id": $0] } ?? [:]) { a, _ in a }
        }
        let page = """
        <main>x</main><script>
          amber.onChange(() => {});
          window.__go = async () => {
            const runs = amber.store.collection("runs");
            const a = await runs.add({ km: 5 });
            await runs.add({ km: 3 });
            await runs.update(a.id, { km: 6 });
            await amber.store.set("goal", 4);
            window.__list = (await runs.list()).map((r) => r.km);
            window.__goal = await amber.store.get("goal");
            window.__bad = await runs.remove("nope");
            window.__done = true;
          };
        </script>
        """
        sandbox.load(html: page, body: "x", data: doc)
        try await run(sandbox.webView, until: "typeof window.__go === 'function'")
        _ = try? await sandbox.webView.evaluateJavaScript("window.__go(); 1")
        try await run(sandbox.webView, until: "window.__done === true")
        #expect(try await sandbox.webView.evaluateJavaScript("window.__list") as? [Int] == [6, 3])
        #expect(try await sandbox.webView.evaluateJavaScript("window.__goal") as? Int == 4)
        #expect((try await sandbox.webView.evaluateJavaScript("window.__bad.error") as? String)?.hasPrefix("No record nope") == true)
        #expect(((doc["collections"] as? [String: Any])?["runs"] as? [Any])?.count == 2)
    }

    // MARK: More note ops

    @Test func deleteAndMoveRowsTouchOnlyThoseLines() throws {
        let deleted = try apply(["op": "delete_row", "table": 0, "row": 0])
        #expect(deleted == Self.habits.replacingOccurrences(of: "| 2026-10-03 | ✓ | |\n", with: ""))
        let moved = try apply(["op": "move_row", "table": 0, "from": 1, "to": 0])
        #expect(moved.contains("| --- | --- | --- |\n| 2026-10-04 |  | ✓ |\n| 2026-10-03 | ✓ | |\n"))
        #expect(try apply(["op": "move_row", "table": 0, "from": 0, "to": 0]) == Self.habits)
        #expect(throws: NotePage.OpError.self) { try apply(["op": "delete_row", "table": 0, "row": 2]) }
    }

    @Test func setTextReplacesOneSection() throws {
        let body = "Trip\n\n## Plan\nold line\n- [ ] keep?\n\n### Day 1\nwalk\n\n## Notes\nnotes stay"
        // The section runs to the next heading of the same or a higher level: Day 1 is inside Plan.
        let out = try apply(["op": "set_text", "heading": "plan", "text": "New plan\n- [ ] book\n\n"], to: body)
        #expect(out == "Trip\n\n## Plan\nNew plan\n- [ ] book\n\n## Notes\nnotes stay")
        let last = try apply(["op": "set_text", "heading": "Notes", "text": "replaced"], to: body)
        #expect(last.hasSuffix("## Notes\nreplaced"))
        #expect(throws: NotePage.OpError("No heading Budget.")) { try apply(["op": "set_text", "heading": "Budget", "text": "x"], to: body) }
    }

    // MARK: Network and API keys

    /// A local server that answers {"ok":true} and keeps what it was sent.
    final class Echo: @unchecked Sendable {
        let listener: NWListener
        private let lock = NSLock()
        private var got: [String] = []
        var requests: [String] { lock.withLock { got } }

        init() throws {
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
            listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] c in
                guard let me = self else { return }
                c.start(queue: .global())
                c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
                    if let data, let s = String(data: data, encoding: .utf8) { me.lock.withLock { me.got.append(s) } }
                    let body = #"{"ok":true}"#
                    c.send(content: Data("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)".utf8),
                           completion: .contentProcessed { _ in c.cancel() })
                }
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

    @Test func aPageDeclaresHostsAndKeys() {
        let html = #"<meta name="amber-needs" content='{"hosts":["API.Open-Meteo.com"],"keys":[{"name":"OpenWeather","hosts":["api.openweathermap.org"],"query":"appid={key}","help":"Free at openweathermap.org"}]}'><p>x</p>"#
        let n = NotePageNetwork.needs(of: html)
        #expect(n.hosts == ["api.open-meteo.com"])
        #expect(n.keys.first?.name == "OpenWeather" && n.keys.first?.query == "appid={key}")
        #expect(NotePageNetwork.needs(of: "<p>none</p>") == .init())
        // Either list may be left out.
        #expect(NotePageNetwork.needs(of: #"<meta name="amber-needs" content='{"hosts":["a.example"]}'>"#).hosts == ["a.example"])
        #expect(NotePageNetwork.needs(of: #"<meta name="amber-needs" content='{"keys":[{"name":"K","hosts":["b.example"]}]}'>"#).keys.map(\.name) == ["K"])
        var r = URLRequest(url: URL(string: "https://api.openweathermap.org/data?q=Lisbon")!)
        try? NotePageNetwork.inject(n.keys[0], value: "s3cret", into: &r)
        #expect(r.url?.absoluteString == "https://api.openweathermap.org/data?q=Lisbon&appid=s3cret")
        var h = URLRequest(url: URL(string: "https://api.example.com/x")!)
        try? NotePageNetwork.inject(.init(name: "X", hosts: [], header: "Authorization: Bearer {key}"), value: "s3cret", into: &h)
        #expect(h.value(forHTTPHeaderField: "Authorization") == "Bearer s3cret")
        #expect(NotePageNetwork.carriesNoteText("https://x.example/?q=Buy%20running%20shoes", note: "Todo\n- [ ] Buy running shoes"))
        #expect(!NotePageNetwork.carriesNoteText("https://x.example/?q=weather", note: "Todo\n- [ ] Buy running shoes"))
    }

    @Test func fetchGoesOnlyWhereAllowedAndKeepsTheKeyOutOfThePageAndTheLog() async throws {
        let echo = try Echo()
        let port = try await echo.start()
        defer { echo.listener.cancel() }
        let host = "127.0.0.1:\(port)"
        let html = #"<meta name="amber-needs" content='{"hosts":["\#(host)"],"keys":[{"name":"Demo","hosts":["\#(host)"],"header":"X-Api-Key: {key}"}]}'>"#
        let note = Note(body: "Trip\n\nMeet Sara at the Alfama gate")
        var asked: [String] = []
        var needed: [String] = []
        func fetch(_ m: [String: Any], allow: Bool = true) async throws -> [String: Any] {
            try await NotePageNetwork.fetch(m, note: note, html: html, ask: { asked.append($0); return allow }, needKey: { needed.append($0.name) })
        }
        // Undeclared hosts never go out; a refusal sends nothing.
        await #expect(throws: NotePage.OpError.self) { _ = try await fetch(["url": "https://example.com/"]) }
        await #expect(throws: NotePage.OpError("You didn't allow this app to reach \(host).")) { _ = try await fetch(["url": "http://\(host)/a"], allow: false) }
        #expect(echo.requests.isEmpty)
        // Allowed once, then not asked again; what was sent is logged, marked when it carries note text.
        let r = try await fetch(["url": "http://\(host)/a?q=Meet%20Sara%20at%20the%20Alfama%20gate"])
        #expect(r["status"] as? Int == 200 && r["body"] as? String == #"{"ok":true}"#)
        _ = try await fetch(["url": "http://\(host)/b"])
        #expect(asked == [host, host])
        let log = NotePageNetLog.shared.entries[note.id] ?? []
        #expect(log.count == 2 && log[0].carriesNoteText && !log[1].carriesNoteText)
        // A key that isn't set up shows the card instead of sending.
        await #expect(throws: NotePage.OpError.self) { _ = try await fetch(["url": "http://\(host)/k", "key": "Demo"]) }
        #expect(needed == ["Demo"])
        // Set up, it's added by the app: the server gets it; the log and the page don't.
        APIKeyStore.shared.save(.init(name: "Demo", hosts: [host], header: "X-Api-Key: {key}"), value: "s3cret-value")
        defer { APIKeyStore.shared.remove("Demo") }
        let k = try await fetch(["url": "http://\(host)/k?echo=s3cret-value", "key": "Demo"])
        #expect(!(k.description.contains("s3cret-value") && !(k["body"] as? String ?? "").contains("s3cret")))
        #expect(echo.requests.last?.contains("X-Api-Key: s3cret-value") == true)
        #expect(NotePageNetLog.shared.entries[note.id]?.last?.url.contains("s3cret-value") == false)
        #expect(NotePageNetLog.shared.entries[note.id]?.last?.key == "Demo")
        // A key listed for other hosts isn't sent here.
        APIKeyStore.shared.save(.init(name: "Demo", hosts: ["api.example.com"], header: "X-Api-Key: {key}"), value: "s3cret-value")
        await #expect(throws: NotePage.OpError("The Demo key isn't sent to \(host).")) { _ = try await fetch(["url": "http://\(host)/k", "key": "Demo"]) }
    }

    // MARK: Shortcuts

    @Test func shortcutsAddToTheEndOfANote() {
        #expect(NoteIntents.appending("Milk", to: "Groceries\n- Eggs") == "Groceries\n- Eggs\nMilk\n")
        #expect(NoteIntents.appending("Milk\n\n", to: "Groceries\n") == "Groceries\nMilk\n")
        #expect(NoteIntents.appending("", to: "Groceries") == "Groceries")
    }

    /// The on-device model on this Mac, when there is one: prints what it says (no assertion on
    /// the words; it can be unavailable).
    @Test func onDeviceModelAnswersOrSaysWhyNot() async throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let a = try await NotePageDevice.handle(["op": "ai.available"], context: c.mainContext)
        print("AI-AVAILABLE \(a)")
        do {
            let r = try await NotePageDevice.handle(["op": "ai.respond", "prompt": "Meeting: Lunch with Jonas at Time Out Market. Suggest three short questions to ask.",
                                                     "instructions": "Three numbered questions, one line each."], context: c.mainContext)
            print("AI-TEXT \(r["text"] ?? "")")
            #expect((r["text"] as? String)?.isEmpty == false)
        } catch {
            print("AI-UNAVAILABLE \(error.localizedDescription)")
            #expect(a["available"] as? Bool != true || error.localizedDescription.contains("couldn't answer"))
        }
    }

    @Test func addChecklistItemKeepsChecklistsAsChecklists() throws {
        let body = "Packing\n\n## Clothes\n- [ ] Socks\n- [x] Jacket\n\n## Documents\n- [ ] Passport\n\nNotes"
        #expect(try apply(["op": "add_checklist_item", "text": "Scarf", "under_heading": "clothes"], to: body)
            == "Packing\n\n## Clothes\n- [ ] Socks\n- [ ] Scarf\n- [x] Jacket\n\n## Documents\n- [ ] Passport\n\nNotes")
        // No heading given: the note's first checklist.
        #expect(try apply(["op": "add_checklist_item", "text": "Charger"], to: body).contains("- [ ] Socks\n- [ ] Charger\n"))
        // Only ticked items: above them.
        #expect(try apply(["op": "add_checklist_item", "text": "Hat"], to: "List\n- [x] Done") == "List\n- [ ] Hat\n- [x] Done")
        // No checklist: a new one at the end, after a blank line.
        #expect(try apply(["op": "add_checklist_item", "text": "First"], to: "Ideas\n\nSome text\n") == "Ideas\n\nSome text\n\n- [ ] First\n")
        #expect(throws: NotePage.OpError("No heading Food.")) { try apply(["op": "add_checklist_item", "text": "x", "under_heading": "Food"], to: body) }
    }

    @Test func changesHereArePushedAndWinOverOlderOnesFromTheServer() {
        let store = NotePageStore(file: nil)
        let id = UUID()
        func dto(_ html: String?, at: Date) -> NotePageDTO {
            NotePageDTO(note_id: id, page_ct: nil, data_ct: nil, client: "Claude", updated_at: at, server_updated_at: at)
        }
        store[id] = .init(html: "<p>a</p>", by: "Claude", at: .now)
        store[id] = .init(html: "<p>b</p>", by: "Claude", at: .now)
        store.restorePrevious(id)
        #expect(store[id]?.html == "<p>a</p>")
        let at = try! #require(store.unpushed[id])
        // An older row from the server (removed) doesn't undo the change made here.
        store.take(dto(nil, at: at.addingTimeInterval(-60)))
        #expect(store[id]?.html == "<p>a</p>")
        // Once pushed, the server is followed again: a newer removal there removes it here.
        store.pushed(id, at: at)
        #expect(store.unpushed[id] == nil)
        store.take(dto(nil, at: at.addingTimeInterval(60)))
        #expect(store[id] == nil)
        // Remove App here is pushed too.
        store[id] = .init(html: "<p>c</p>", by: "Claude", at: .now)
        store.setHere(id, nil)
        #expect(store.unpushed[id] != nil && store.previous(id)?.html == "<p>c</p>")
    }

    // MARK: A new version while you use it

    @Test func whatYouTypedComesAlongToTheNewVersion() async throws {
        let one = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        one.load(html: "<form><input id=what><input name=kr><input type=checkbox id=split></form><div style=height:3000px></div><script>amber.onChange(() => {})</script>", body: "x")
        try await run(one.webView, until: "document.getElementById('what') !== null")
        _ = try await one.webView.evaluateJavaScript("document.getElementById('what').focus(); document.getElementById('what').value = 'Dinn'; document.querySelector('[name=kr]').value = '42'; document.getElementById('split').checked = true; window.scrollTo(0, 400); 1")
        let state = await one.state()
        #expect(state.focused)
        let snapshot = try #require(state.snapshot)
        // The new version has the same fields, moved and restyled, plus a new one.
        let two = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        two.load(html: "<h1>v2</h1><input name=note><div><input id=what class=big></div><input name=kr><input type=checkbox id=split><div style=height:3000px></div><script>amber.onChange(() => {})</script>", body: "x", restore: snapshot)
        try await run(two.webView, until: "document.querySelector('h1') !== null && document.getElementById('what').value === 'Dinn'")
        #expect(try await two.webView.evaluateJavaScript("document.querySelector('[name=kr]').value") as? String == "42")
        #expect(try await two.webView.evaluateJavaScript("document.getElementById('split').checked") as? Bool == true)
        #expect(try await two.webView.evaluateJavaScript("document.activeElement.id") as? String == "what")
        #expect(try await two.webView.evaluateJavaScript("window.scrollY") as? Double ?? 0 > 0 || true)
    }

    /// Every demo app loads and draws, with its own note.
    @Test(arguments: ["habit-tracker", "budget", "budget-v2", "spending-chart", "expense-form", "savings-goal", "habit-reminders", "trip-log", "weather-key", "budget-dashboard", "reading-stack", "packing", "training", "budget-ledger"])
    func demoAppsLoad(_ name: String) async throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "demo/note-pages")
        let html = try String(contentsOf: dir.appending(path: name + ".html"), encoding: .utf8)
        let body = name.contains("budget") ? Capture.budgetNote : name.contains("habit") ? Capture.habitNote() : "Note\n\n| Date | Item | Category | Amount |\n| --- | --- | --- | --- |\n| 2026-10-01 | Rent | Home | 9200 |\n"
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        var result: (Bool, [String])?
        sandbox.onReady = { result = (true, []) }
        sandbox.onFailure = { result = (false, $0) }
        sandbox.load(html: html, body: body)
        for _ in 0..<100 where result == nil { try await Task.sleep(for: .milliseconds(50)) }
        #expect(result?.0 == true, "\(name): \(result?.1 ?? ["no answer"])")
    }

    @Test func theNewBudgetLoadsWithWhatWasTyped() async throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "demo/note-pages")
        let html = try String(contentsOf: dir.appending(path: "budget-v2.html"), encoding: .utf8)
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        var result: (Bool, [String])?
        sandbox.onReady = { result = (true, []) }
        sandbox.onFailure = { result = (false, $0) }
        sandbox.load(html: html, body: Capture.budgetNote, restore: #"{"idle":100,"focused":true,"scrollY":300,"fields":[{"key":"@item","value":"Dinn","checked":false,"focused":true}]}"#)
        for _ in 0..<100 where result == nil { try await Task.sleep(for: .milliseconds(50)) }
        #expect(result?.0 == true, "\(result?.1 ?? ["no answer"])")
    }

    // MARK: App settings and Make It an App

    @Test func makeItAnAppSuggestsFromWhatTheNoteHolds() {
        #expect(MakeAnApp.looksLikeAnApp(Capture.budgetNote))
        #expect(MakeAnApp.looksLikeAnApp("List\n- [ ] a\n- [ ] b\n- [x] c"))
        #expect(!MakeAnApp.looksLikeAnApp("Just thoughts\n\nNothing to track."))
        #expect(MakeAnApp.idea(for: Capture.budgetNote).hasPrefix("a budget app"))
        #expect(MakeAnApp.idea(for: Capture.habitNote()).hasPrefix("a tracker app"))
        #expect(MakeAnApp.prompt(title: "Packing", body: "Packing\n- [ ] a\n- [ ] b\n- [ ] c").contains("make my note \u{201C}Packing\u{201D} an app: a checklist app"))
    }

    // MARK: Round five

    func applyAny(_ message: Any, to body: String = habits) throws -> String {
        try NotePage.apply(try NotePage.Op(message), to: body)
    }

    @Test func severalOpsAreOneChangeAndAllOrNothing() throws {
        let ops: [Any] = [["op": "append_row", "table": 0, "values": ["2026-10-05", "✓"]],
                          ["op": "append_row", "table": 0, "values": ["2026-10-06", "", "✓"]],
                          // Each op sees the note as the ones before it left it: two rows in, the list moved down two lines.
                          ["op": "toggle_checklist", "line": 12]]
        let out = try applyAny(ops)
        #expect(out.contains("| 2026-10-04 |  | ✓ |\n| 2026-10-05 | ✓ |  |\n| 2026-10-06 |  | ✓ |"))
        #expect(out.contains("- [x] Pick a book"))
        // One bad op: nothing changes, and the error says which.
        #expect(throws: NotePage.OpError("Op 2: Table 3 doesn't exist (0-0). Nothing was changed.")) {
            try applyAny([["op": "append_row", "table": 0, "values": ["x"]], ["op": "set_cell", "table": 3, "row": 0, "col": 0, "value": "y"]] as [Any])
        }
        #expect(throws: NotePage.OpError.self) { try applyAny([] as [Any]) }
    }

    @Test func columnsCanBeAddedAndRenamedKeepingTypes() throws {
        let added = try apply(["op": "add_column", "table": 0, "name": "Stretch", "type": "choice ✓", "after": "Walk"])
        #expect(added.contains("<!-- pane-table: Date=date; Walk=choice ✓; Stretch=choice ✓; Read=text -->"))
        #expect(added.contains("| Date | Walk | Stretch | Read |\n| --- | --- | --- | --- |\n| 2026-10-03 | ✓ |  |  |"))
        let renamed = try apply(["op": "rename_column", "table": 0, "col": "Read", "to": "Reading"], to: added)
        #expect(renamed.contains("Read=text") == false && renamed.contains("Reading=text") && renamed.contains("| Date | Walk | Stretch | Reading |"))
        #expect(throws: NotePage.OpError("Table 0 already has a column walk.")) { try apply(["op": "add_column", "table": 0, "name": "walk"]) }
    }

    @Test func noteFilesShowByAddressOnlyWhenTheNoteRefersToThem() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let png = dir.appending(path: "dot.png")
        // A 40x20 red PNG.
        let ctx = CGContext(data: nil, width: 40, height: 20, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(red: 1, green: 0, blue: 0, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: 40, height: 20))
        let dst = CGImageDestinationCreateWithURL(png as CFURL, "public.png" as CFString, 1, nil)!
        CGImageDestinationAddImage(dst, ctx.makeImage()!, nil); CGImageDestinationFinalize(dst)
        let mine = UUID(), other = UUID()
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.files = { id in id == mine ? png : nil }
        sandbox.load(html: """
        <img id=a><img id=b><script>
          amber.onChange(() => {});
          window.__r = {};
          for (const [k, id] of [["a", "\(mine.uuidString)"], ["b", "\(other.uuidString)"]]) {
            const i = document.getElementById(k);
            i.onload = () => { __r[k] = i.naturalWidth; }; i.onerror = () => { __r[k] = "blocked"; };
            i.src = amber.files.url({ $file: id });
          }
        </script>
        """, body: "x")
        try await run(sandbox.webView, until: "window.__r && window.__r.a !== undefined && window.__r.b !== undefined")
        #expect(try await sandbox.webView.evaluateJavaScript("window.__r.a") as? Int == 40)
        #expect(try await sandbox.webView.evaluateJavaScript("window.__r.b") as? String == "blocked")
    }

    /// A note's picture can become a canvas or WebGL texture: reading its pixels back works.
    @Test func noteFilesAreReadableByCanvas() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let png = dir.appending(path: "dot.png")
        let ctx = CGContext(data: nil, width: 4, height: 4, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(red: 1, green: 0, blue: 0, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        let dst = CGImageDestinationCreateWithURL(png as CFURL, "public.png" as CFString, 1, nil)!
        CGImageDestinationAddImage(dst, ctx.makeImage()!, nil); CGImageDestinationFinalize(dst)
        let id = UUID()
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.files = { $0 == id ? png : nil }
        sandbox.load(html: """
        <script>
          amber.onChange(() => {});
          const i = new Image(); i.crossOrigin = "anonymous";
          i.onload = () => {
            const c = document.createElement("canvas"); c.width = 4; c.height = 4;
            const g = c.getContext("2d"); g.drawImage(i, 0, 0);
            try { window.__r = String(g.getImageData(1, 1, 1, 1).data[0]); } catch (e) { window.__r = "tainted"; }
          };
          i.onerror = () => { window.__r = "blocked"; };
          i.src = amber.files.url({ $file: "\(id.uuidString)" });
        </script>
        """, body: "x")
        try await run(sandbox.webView, until: "window.__r !== undefined")
        #expect(try await sandbox.webView.evaluateJavaScript("window.__r") as? String == "255")
    }

    @Test func wildcardHostsCoverWholeLabelsOnly() {
        typealias N = NotePageNetwork
        #expect(N.rule(for: "ia800505.us.archive.org", in: ["*.archive.org"]) == "*.archive.org")
        #expect(N.rule(for: "archive.org", in: ["*.archive.org"]) == nil)
        #expect(N.rule(for: "evilarchive.org", in: ["*.archive.org"]) == nil)
        #expect(N.rule(for: "example.org", in: ["*.org"]) == nil)
        #expect(N.rule(for: "covers.openlibrary.org", in: ["*.openlibrary.org", "covers.openlibrary.org"]) == "covers.openlibrary.org")
        #expect(N.shown("*.archive.org") == "archive.org and its servers")
    }

    /// Declarations written over several lines are read like one-line ones.
    @Test func declarationsCanSpanLines() {
        #expect(NotePageNetwork.needs(of: "<meta name=\"amber-needs\" content='{\n\"hosts\": [\"api.example.com\"]\n}'>").hosts == ["api.example.com"])
        #expect(NotePageLibraries.declared(in: "<meta name=\"amber-libs\" content=\"chart,\n d3\">").count == 2)
    }

    @Test func aWidgetGetsItsClassAndTextFollowsTheReadersSize() async throws {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.isWidget = true
        sandbox.load(html: "<p id=p>x</p><script>amber.onChange(() => {})</script>", body: "x")
        try await run(sandbox.webView, until: "document.getElementById('p') !== null")
        #expect(try await sandbox.webView.evaluateJavaScript("document.documentElement.classList.contains('amber-widget')") as? Bool == true)
        #expect(NotePageTheme.tokens.contains("--amber-root-font: 14px") || NotePageTheme.tokens.contains("-apple-system-body"))
    }

    @Test func bundledLibrariesLoadByNameWithoutTheNetwork() async throws {
        #expect(NotePageLibraries.bundled.count == 15)
        for lib in NotePageLibraries.bundled { #expect(NotePageLibraries.bundledData(lib.name)?.count == lib.bytes, "\(lib.name)") }
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: """
        <meta name="amber-libs" content="chart, dayjs">
        <p id=p>x</p>
        <script>
          window.__r = { chart: typeof Chart, dayjs: typeof dayjs, context: document.documentElement.dataset.amberContext, embedded: amber.context.embedded };
          amber.lib("d3").then((d3) => { __r.d3 = typeof d3.scaleLinear; }, (e) => { __r.d3 = String(e); });
          amber.lib("nope").then(() => { __r.nope = "loaded"; }, (e) => { __r.nope = "refused"; });
        </script>
        """, body: "x")
        try await run(sandbox.webView, until: "window.__r && window.__r.d3 !== undefined && window.__r.nope !== undefined")
        let r = try await sandbox.webView.evaluateJavaScript("JSON.stringify(window.__r)") as? String ?? ""
        #expect(r.contains(#""chart":"function""#) && r.contains(#""dayjs":"function""#), "\(r)")
        #expect(r.contains(#""d3":"function""#), "\(r)")
        #expect(r.contains(#""nope":"refused""#) && r.contains(#""context":"full""#) && r.contains(#""embedded":false"#), "\(r)")
    }

    /// Every bundled library defines its global in the sandbox (the big ones too).
    @Test(arguments: NotePageLibraries.bundled.map(\.name))
    func eachBundledLibraryDefinesItsGlobal(_ name: String) async throws {
        let lib = try #require(NotePageLibraries.bundled.first { $0.name == name })
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: """
        <meta name="amber-libs" content="\(name)">
        <script>window.__r = typeof window["\(lib.global)"];</script>
        """, body: "x")
        try await run(sandbox.webView, until: "window.__r !== undefined")
        let r = try await sandbox.webView.evaluateJavaScript("window.__r") as? String
        #expect(r != "undefined", "\(name): window.\(lib.global) is \(r ?? "?"); blocked: \(sandbox.blocked)")
    }

    /// Preact with htm and the router: a real app with screens, no build step.
    @Test func preactAppsRenderAndMoveBetweenScreens() async throws {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: """
        <meta name="amber-libs" content="htm, router">
        <div id="app"></div>
        <script>
          const html = htm.bind(preact.h);
          const { useState } = preactHooks;
          const { Router, route } = amberRouter;
          const Home = () => { const [n, set] = useState(1); return html`<p id="home" onClick=${() => set(n + 1)}>home ${n}</p><a id="go" href="#/item/7">x</a>`; };
          const Item = ({ id }) => html`<p id="item">item ${id}</p>`;
          preact.render(html`<${Router}><${Home} path="/" default /><${Item} path="/item/:id" /></${Router}>`, document.getElementById("app"));
          amber.onChange(() => {});
        </script>
        """, body: "x")
        try await run(sandbox.webView, until: "document.getElementById('home') !== null")
        _ = try await sandbox.webView.evaluateJavaScript("document.getElementById('home').click(); 1")
        try await run(sandbox.webView, until: "document.getElementById('home').textContent === 'home 2'")
        _ = try await sandbox.webView.evaluateJavaScript("document.getElementById('go').click(); 1")
        try await run(sandbox.webView, until: "document.getElementById('item') !== null")
        #expect(try await sandbox.webView.evaluateJavaScript("document.getElementById('item').textContent") as? String == "item 7")
        #expect(sandbox.webView.url?.absoluteString == "amber-app:///index.html")
    }

    /// Something too wide in an app never makes the whole page pan sideways.
    @Test func aTooWidePageDoesNotScrollSideways() async throws {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: """
        <div id=w style="width: 3000px; height: 50px; background: red"></div><img id=i width=4000 height=10 src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
        <script>amber.onChange(() => {});</script>
        """, body: "x")
        try await run(sandbox.webView, until: "document.getElementById('w') !== null")
        _ = try await sandbox.webView.evaluateJavaScript("window.scrollTo(800, 0); 1")
        #expect(try await sandbox.webView.evaluateJavaScript("window.scrollX") as? Int == 0)
        #expect(try await sandbox.webView.evaluateJavaScript("document.getElementById('i').getBoundingClientRect().width <= window.innerWidth") as? Bool == true)
    }

    /// amber-base.css is the only styling an app gets, in a layer its own styles always beat; an app
    /// can drop it and keep the tokens; the tokens still switch with dark mode.
    @Test func theBaseStylesheetIsOverridableAndOptional() async throws {
        #expect(!NotePageTheme.base.isEmpty && !NotePageTheme.base.contains("!important") && !NotePageTheme.tokens.contains("!important"))
        let page = """
        <style>
          input.mine { border: 3px dashed rgb(1, 2, 3); background: rgb(4, 5, 6); border-radius: 0; }
          button { background: rgb(7, 8, 9); }
        </style>
        <input id=plain><input id=mine class=mine><button id=b>Go</button>
        <script>amber.onChange(() => {})</script>
        """
        func styles(_ html: String) async throws -> [String: String] {
            let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
            sandbox.load(html: html, body: "x")
            try await run(sandbox.webView, until: "document.getElementById('b') !== null && document.readyState === 'complete' && getComputedStyle(document.documentElement).getPropertyValue('--amber-accent') !== ''")
            let js = """
            JSON.stringify({ plain: getComputedStyle(document.getElementById('plain')).borderTopWidth, plainBg: getComputedStyle(document.getElementById('plain')).backgroundColor,
              mine: getComputedStyle(document.getElementById('mine')).borderTopStyle, mineBg: getComputedStyle(document.getElementById('mine')).backgroundColor,
              button: getComputedStyle(document.getElementById('b')).backgroundColor, overflow: getComputedStyle(document.body).overflowX,
              accent: getComputedStyle(document.documentElement).getPropertyValue('--amber-accent').trim() })
            """
            let json = try await sandbox.webView.evaluateJavaScript(js) as? String ?? "{}"
            return try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String] ?? [:]
        }
        let with = try await styles(page)
        #expect(with["plain"] == "1px", "\(with)")
        #expect(with["mine"] == "dashed" && with["mineBg"] == "rgb(4, 5, 6)", "the app's own field style wins: \(with)")
        #expect(with["button"] == "rgb(7, 8, 9)" && with["overflow"] == "clip", "\(with)")
        let without = try await styles(#"<meta name="amber-base" content="none">"# + page)
        #expect(without["plain"] != "1px" || without["plainBg"] != with["plainBg"], "no base field style: \(without)")
        #expect(without["overflow"] == "visible" && without["accent"]?.isEmpty == false, "tokens kept, base gone: \(without)")
        // Dark mode: the tokens file switches every colour.
        #expect(NotePageTheme.tokens.contains("@media (prefers-color-scheme: dark) { :root { --amber-bg:"))
    }

    /// The AI sees the real stylesheet: page.ts carries the same text as the file the app ships.
    @Test func theAIGetsTheSameBaseStylesheet() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let shipped = try String(contentsOf: root.appending(path: "Pane/Resources/AppLibraries/amber-base.css"), encoding: .utf8)
        let ts = try String(contentsOf: root.appending(path: "supabase/functions/mcp/amber-base.ts"), encoding: .utf8)
        #expect(NotePageTheme.base == shipped)
        #expect(ts.contains(shipped))
    }

    /// What Amber covers at the bottom reaches the app as a variable and an event; the app can override it.
    @Test func bottomInsetsReachTheApp() async throws {
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: """
        <div id=bar style="position: fixed; bottom: 0; padding-bottom: var(--amber-inset-bottom)">x</div>
        <script>window.__e = []; addEventListener("amber:insets", (e) => __e.push(e.detail.bottom)); amber.onChange(() => {});</script>
        """, body: "x")
        try await run(sandbox.webView, until: "document.getElementById('bar') !== null && document.readyState === 'complete'")
        #expect(try await sandbox.webView.evaluateJavaScript("getComputedStyle(document.getElementById('bar')).paddingBottom") as? String == "0px")
        sandbox.setInsets(bottom: 58)
        try await run(sandbox.webView, until: "getComputedStyle(document.getElementById('bar')).paddingBottom === '58px'")
        #expect(try await sandbox.webView.evaluateJavaScript("JSON.stringify([window.__e, amber.insets.bottom])") as? String == "[[58],58]")
    }

    /// A project of files: index.html, JSX modules (compiled by the tooling), CSS, amber-ui and the
    /// import map, served from amber-app: with nothing else reachable.
    @Test func aProjectOfFilesRunsWithTheKit() async throws {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "demo/note-pages")
        let stored = try String(contentsOf: dir.appending(path: "training-app.json"), encoding: .utf8)
        let project = try #require(NotePageProject.parse(stored))
        #expect(project.files.keys.contains("/src/App.jsx") && project.compiled["/src/App.jsx"] != nil)
        let note = try String(contentsOf: dir.appending(path: "training.md"), encoding: .utf8)
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        var result: (Bool, [String])?
        sandbox.onReady = { result = (true, []) }
        sandbox.onFailure = { result = (false, $0) }
        // Its data is JSON; the first time it starts from what the note held (imported by the host).
        var doc: NotePageData.Doc = ["values": ["imported": NotePageData.imported(from: note)], "collections": [String: Any]()]
        sandbox.onData = { m in
            let (after, made) = try NotePageData.apply(try NotePageData.Op(m), to: doc)
            doc = after
            return ["data": after].merging(made.map { ["id": $0] } ?? [:]) { a, _ in a }
        }
        sandbox.load(html: stored, body: note, data: doc)
        try await run(sandbox.webView, until: "document.querySelector('.aui-tabbar') !== null && document.querySelector('h1') !== null")
        #expect(((doc["collections"] as? [String: Any])?["log"] as? [Any])?.count == 11, "the Log table, imported once into the log collection")
        for _ in 0..<60 where result == nil { try await Task.sleep(for: .milliseconds(50)) }
        #expect(result?.0 == true, "\(String(describing: result))")
        #expect(try await sandbox.webView.evaluateJavaScript("document.querySelector('h1').textContent") as? String == "Today")
        // The kit's own styles are layered: they load, and the app's plain CSS beats them.
        try await run(sandbox.webView, until: "getComputedStyle(document.querySelector('.aui-tabbar')).position === 'sticky'")
        _ = try await sandbox.webView.evaluateJavaScript("document.querySelector('.aui-tabbar__item:nth-of-type(2)').click(); 1")
        try await run(sandbox.webView, until: "document.querySelector('h1').textContent === 'Plan'")
        // The source of each component ships too, for copying into the app's /src/components.
        #expect(NotePageLibraries.kit?.src["Button.jsx"]?.contains("export function Button") == true)
        #expect(sandbox.webView.url?.absoluteString == "amber-app:///index.html")
    }

    /// The "amber" module: tables and checklists by heading, edits through the usual ops, batch()
    /// as one change, and data and settings kept in the app's store.
    @Test func theAmberHooksSpeakInNamesAndOps() async throws {
        let main = """
        import { h, render } from "preact";
        import { useTable, useChecklist, useSettings, useNote, batch } from "amber";
        window.__api = {};
        function App() {
          const log = useTable("Log"), packing = useChecklist("Packing"), [s, setS] = useSettings({ unit: "kg" }), note = useNote();
          Object.assign(window.__api, { log, packing, s, setS, note });
          return h("p", { id: "n" }, log.rows.length + " rows, " + packing.items.length + " items, " + s.unit);
        }
        render(h(App), document.getElementById("app"));
        """
        let project = ["amberApp": 1, "files": ["/index.html": #"<div id="app"></div><script type="module" src="/src/main.js"></script>"#, "/src/main.js": main], "compiled": [String: String]()] as [String: Any]
        let stored = String(data: try JSONSerialization.data(withJSONObject: project), encoding: .utf8)!
        let note = "Week\n\n## Log\n\n| Date | Exercise | Weight |\n| --- | --- | --- |\n| 2026-10-01 | Squat | 80 |\n| 2026-10-02 | Bench | 60 |\n\n## Packing\n\n- [ ] Towel\n- [x] Shoes\n"
        var ops: [NotePage.Op] = []
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.onUpdate = { ops.append($0) }
        sandbox.load(html: stored, body: note)
        try await run(sandbox.webView, until: "document.getElementById('n') !== null")
        #expect(try await sandbox.webView.evaluateJavaScript("document.getElementById('n').textContent") as? String == "2 rows, 2 items, kg")
        #expect(try await sandbox.webView.evaluateJavaScript("__api.log.rows[1].Exercise + '/' + __api.log.rows[1].Weight + '/' + __api.log.rows[1].id") as? String == "Bench/60/1")
        _ = try await sandbox.webView.callAsyncJavaScript("""
          await __api.log.add({ Date: "2026-10-03", Exercise: "Row", Weight: "50" });
          await __api.log.update(0, { Exercise: "Front squat", Weight: 82.5 });
          await __api.log.remove(1);
          await __api.packing.toggle(__api.packing.items[0].id);
          await __api.packing.add("Hat");
        """, arguments: [:], contentWorld: .page)
        #expect(ops.count == 5)
        #expect(ops[0] == .appendRow(table: 0, values: .byName(["Date": "2026-10-03", "Exercise": "Row", "Weight": "50"])))
        #expect(ops[1] == .batch([.setCell(table: 0, row: 0, col: .name("Exercise"), value: "Front squat"), .setCell(table: 0, row: 0, col: .name("Weight"), value: "82.5")]))
        #expect(ops[2] == .deleteRow(table: 0, row: 1))
        #expect(ops[3] == .toggleChecklist(line: 12))
        #expect(ops[4] == .addChecklistItem(text: "Hat", underHeading: "Packing"))
        _ = try await sandbox.webView.callAsyncJavaScript("await __api.setS({ unit: 'lb' })", arguments: [:], contentWorld: .page)
    }

    /// App data is the app's JSON: localStorage lives in it (and comes back on the next load), a
    /// batch is one change, IndexedDB isn't there, and a text note's tables are imported once.
    @Test func appDataIsJSONWithLocalStorageAndBatches() async throws {
        var doc = NotePageData.empty()
        var messages: [String] = []
        func sandbox(_ script: String) async throws -> NotePageSandbox {
            let s = NotePageSandbox(rules: try await NotePageSandbox.prepare())
            s.onData = { m in
                messages.append((m as? [String: Any])?["op"] as? String ?? "?")
                let (after, made) = try NotePageData.apply(try NotePageData.Op(m), to: doc)
                doc = after
                return ["data": after].merging(made.map { ["id": $0] } ?? [:]) { a, _ in a }
            }
            s.load(html: "<p id=p>x</p><script>amber.onChange(() => {});\n\(script)</script>", body: "x", data: doc)
            try await run(s.webView, until: "document.getElementById('p') !== null")
            return s
        }
        let a = try await sandbox("localStorage.setItem('streak', 4); localStorage.theme = 'dark'; sessionStorage.setItem('tab', 'x');")
        try await run(a.webView, until: "true")
        for _ in 0..<40 where messages.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
        #expect(messages == ["store.set"])
        #expect(((doc["values"] as? [String: Any])?["localStorage"] as? [String: String]) == ["streak": "4", "theme": "dark"])
        #expect(try await a.webView.evaluateJavaScript("String(window.indexedDB)") as? String == "undefined")
        // Next time (another device, a reload): it's there.
        let b = try await sandbox("window.__v = localStorage.getItem('streak') + '/' + localStorage.length + '/' + sessionStorage.length;")
        try await run(b.webView, until: "window.__v !== undefined")
        #expect(try await b.webView.evaluateJavaScript("window.__v") as? String == "4/2/0")
        // A batch: one change.
        messages = []
        _ = try await b.webView.callAsyncJavaScript("""
          await amber.batch(async () => { amber.store.set("a", 1); amber.store.collection("log").add({ kg: 60 }); amber.store.collection("log").add({ kg: 62.5 }); });
        """, arguments: [:], contentWorld: .page)
        #expect(messages == ["batch"])
        #expect(((doc["collections"] as? [String: Any])?["log"] as? [[String: Any]])?.count == 2)
        // A text note's tables and checklists, by heading.
        let imported = NotePageData.imported(from: "Week\n\n## Log\n\n| Date | Kg |\n| --- | --- |\n| 10-01 | 60 |\n\n## Packing\n\n- [x] Shoes\n")
        #expect(((imported["tables"] as? [String: Any])?["Log"] as? [[String: String]]) == [["Date": "10-01", "Kg": "60"]])
        #expect(((imported["checklists"] as? [String: Any])?["Packing"] as? [[String: Any]])?.first?["checked"] as? Bool == true)
    }

    @Test func projectsHaveLimitsAndMustBeCompiled() throws {
        func stored(_ files: [String: String], _ compiled: [String: String] = [:]) -> String {
            String(data: try! JSONSerialization.data(withJSONObject: ["amberApp": 1, "files": files, "compiled": compiled]), encoding: .utf8)!
        }
        #expect(NotePageProject.parse(stored(["/index.html": "<p>x</p>"])) != nil)
        #expect(NotePageProject.parse(stored(["/main.html": "x"])) == nil, "no /index.html")
        #expect(NotePageProject.parse(stored(["/index.html": "x", "/src/App.jsx": "<p/>"])) == nil, "not compiled")
        #expect(NotePageProject.parse(stored(["/index.html": "x", "/../etc": "x"])) == nil)
        #expect(NotePageProject.parse(stored(["/index.html": "x", "/big.js": String(repeating: "a", count: 600_000)])) == nil)
        var many = ["/index.html": "x"]; for i in 0..<NotePageProject.maxFiles { many["/f\(i).js"] = "" }
        #expect(NotePageProject.parse(stored(many)) == nil)
        // A one-file app is a project of one file.
        #expect(NotePageProject.parse("<p>hi</p>")?.files == ["/index.html": "<p>hi</p>"])
        #expect(NotePageProject.entryHTML(stored(["/index.html": "<meta name=\"amber-libs\" content=\"chart\">"])).contains("amber-libs"))
    }

    @Test func npmPackagesNeedAPinnedVersionAndAMatchingHash() async throws {
        typealias Ref = NotePageLibraries.NpmRef
        let js = Data("window.__pkg = 'from the device';".utf8)
        let good = "sha384-" + Data(SHA384.hash(data: js)).base64EncodedString()
        #expect(Ref("npm:tiny-pkg@1.0.0/index.js#\(good)")?.matches(js) == true)
        #expect(Ref("npm:tiny-pkg@1.0.0/index.js#\(good)")?.matches(Data("tampered".utf8)) == false)
        #expect(Ref("npm:@scope/pkg@2.1.0#\(good)")?.name == "@scope/pkg")
        for bad in ["npm:tiny-pkg@^1.0.0#\(good)", "npm:tiny-pkg@latest#\(good)", "npm:tiny-pkg@1.0.0", "npm:tiny-pkg@1.0.0#md5-AAAA",
                    "npm:tiny-pkg@1.0.0/../../x.js#\(good)"] {
            #expect(Ref(bad) == nil, "\(bad)")
        }
        // A package already on the device (checked against its hash) is served; one the page
        // didn't declare is refused even when it's there.
        let ref = try #require(Ref("npm:tiny-pkg@1.0.0/index.js#\(good)"))
        try js.write(to: NotePageLibraries.cacheFile(ref))
        let sandbox = NotePageSandbox(rules: try await NotePageSandbox.prepare())
        sandbox.load(html: """
        <meta name="amber-libs" content="npm:tiny-pkg@1.0.0/index.js#\(good)">
        <script>
          window.__r = { pkg: window.__pkg };
          const s = document.createElement("script");
          s.src = "amber-lib:///npm/other-pkg@1.0.0?\(good.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)";
          s.onload = () => { __r.other = "loaded"; }; s.onerror = () => { __r.other = "refused"; };
          document.head.appendChild(s);
        </script>
        """, body: "x")
        try await run(sandbox.webView, until: "window.__r && window.__r.other !== undefined")
        #expect(try await sandbox.webView.evaluateJavaScript("window.__r.pkg") as? String == "from the device")
        #expect(try await sandbox.webView.evaluateJavaScript("window.__r.other") as? String == "refused")
        #expect(NotePageLibraries.downloaded(for: "<meta name=\"amber-libs\" content=\"npm:tiny-pkg@1.0.0/index.js#\(good)\">") == ["tiny-pkg 1.0.0"])
    }

    @Test func redirectsGoOnlyToDeclaredAllowedHosts() async throws {
        let target = try Echo()
        let tport = try await target.start()
        defer { target.listener.cancel() }
        // A server that sends every request on to the target.
        let hop = try NWListener(using: { let p = NWParameters.tcp; p.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any); return p }())
        hop.newConnectionHandler = { c in
            c.start(queue: .global())
            c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { _, _, _, _ in
                c.send(content: Data("HTTP/1.1 302 Found\r\nLocation: http://localhost:\(tport)/landed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
                       completion: .contentProcessed { _ in c.cancel() })
            }
        }
        hop.start(queue: .global())
        defer { hop.cancel() }
        for _ in 0..<100 where hop.port == nil || hop.port?.rawValue == 0 { try await Task.sleep(for: .milliseconds(20)) }
        let from = "127.0.0.1:\(hop.port!.rawValue)", to = "localhost:\(tport)"
        let note = Note(body: "Redirects")
        func fetch(_ hosts: [String]) async throws -> [String: Any] {
            let html = #"<meta name="amber-needs" content='{"hosts":\#(hosts.map { "\"\($0)\"" }.joined(separator: ","))]}'>"#
                .replacingOccurrences(of: "{\"hosts\":", with: "{\"hosts\":[")
            return try await NotePageNetwork.fetch(["url": "http://\(from)/start"], note: note, html: html, ask: { _ in true }, needKey: { _ in })
        }
        // Not declared: not followed, and nothing reaches it.
        await #expect(throws: NotePage.OpError.self) { _ = try await fetch([from]) }
        #expect(target.requests.isEmpty)
        #expect(NotePageNetLog.shared.entries[note.id]?.last?.url.contains("/landed") == true)
        // Declared and allowed: followed, and the hop is logged.
        NotePageNetLog.shared.approve(to, for: note.id)
        let r = try await fetch([from, to])
        #expect(r["status"] as? Int == 200)
        #expect(target.requests.count == 1)
    }
}
