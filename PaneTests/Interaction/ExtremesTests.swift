#if os(macOS)
import AppKit
import Foundation
import SwiftData
import Testing
@testable import Pane

/// Extreme notes and libraries: the editor and the model must stay responsive and never
/// crash or hang, whatever someone pastes, imports or syncs in.
@MainActor
@Suite(.serialized) struct ExtremesTests {
    private func ms(_ f: () async -> Void) async -> Double {
        let t = ContinuousClock.now
        await f()
        let d = ContinuousClock.now - t
        return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    private func median(_ xs: [Double]) -> Double { xs.sorted()[xs.count / 2] }

    /// One keystroke's own cost: the insert (restyle included) and drawing what's visible,
    /// without the harness's settle pause.
    private func keystroke(_ h: EditorHarness, _ c: String) async -> Double {
        let t = ContinuousClock.now
        h.view.insertText(c, replacementRange: h.view.selectedRange())
        h.view.enclosingScrollView?.layoutSubtreeIfNeeded()
        h.view.displayIfNeeded()
        let d = ContinuousClock.now - t
        await h.settle(0.01)
        return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    /// The largest note the server accepts is 2 MB: about 66,000 lines like these.
    @Test(.timeLimit(.minutes(2))) func twoMegabyteNote() async {
        let text = "Huge\n" + (0..<66_000).map { "Line \($0) of a very long note" }.joined(separator: "\n")
        var h: EditorHarness!
        let open = await ms { h = await EditorHarness(text) }
        defer { h.close() }
        await h.select((h.text as NSString).length)
        var keys: [Double] = []
        for c in "abcde" { keys.append(await keystroke(h, String(c))) }
        print("PERF 2 MB note (66k lines): open \(Int(open)) ms, keystroke median \(String(format: "%.1f", median(keys))) ms")
        #expect(h.text.hasSuffix("abcde"))
        // Measured ~100 ms on an M-series Mac (2 MB is the server's cap); this guards against regressions, it isn't a target.
        #expect(median(keys) < 150 * PerfBudget.slack, "typing in the largest note the server takes doesn't regress")
    }

    @Test(.timeLimit(.minutes(2))) func oneMegabyteLineWithoutSpaces() async {
        let text = "Blob\n" + String(repeating: "x", count: 1_000_000)
        var h: EditorHarness!
        let open = await ms { h = await EditorHarness(text) }
        defer { h.close() }
        await h.select(5)
        var keys: [Double] = []
        for c in "hello" { keys.append(await keystroke(h, String(c))) }
        print("PERF 1 MB single line: open \(Int(open)) ms, keystroke median \(String(format: "%.1f", median(keys))) ms")
        // Known limit: TextKit lays out a whole paragraph again on each edit, so a 1 MB
        // line with no breaks (minified JSON, say) costs ~0.5 s a keystroke. This guards
        // against it getting worse; it isn't a target.
        #expect(median(keys) < 1000 * PerfBudget.slack)
    }

    @Test(.timeLimit(.minutes(2))) func hundredColumnsByThousandRows() async {
        let header = "| " + (0..<100).map { "C\($0)" }.joined(separator: " | ") + " |"
        let rule = "|" + String(repeating: " --- |", count: 100)
        let rows = (0..<1000).map { r in "| " + (0..<100).map { "r\(r)c\($0)" }.joined(separator: " | ") + " |" }
        let text = "Wide\n\n" + ([header, rule] + rows).joined(separator: "\n") + "\n\nAfter the table"
        var h: EditorHarness!
        let open = await ms { h = await EditorHarness(text) }
        defer { h.close() }
        await h.caret(after: "After the table")
        let key = await keystroke(h, "!")
        print("PERF 100×1000 table: open \(Int(open)) ms, keystroke after it \(Int(key)) ms")
        #expect(h.text.hasSuffix("After the table!"))
        #expect(key < 250 * PerfBudget.slack)
    }

    @Test(.timeLimit(.minutes(2))) func fiveThousandChecklistItems() async {
        let items = (0..<5000).map { "- [ ] Item \($0)" }
        let text = "List\n\n" + items.joined(separator: "\n") + "\n"
        let first = (text as NSString).range(of: "- [ ] Item 0").location
        let tick = await ms { _ = ListEditing.toggleCheckbox(in: text, lineStart: first) }
        let toggled = (text as NSString).replacingCharacters(in: NSRange(location: first + 3, length: 1), with: "x")
        var sorted: TextEdit?
        let sort = await ms { sorted = ListEditing.sortChecklist(in: toggled, around: first, caret: 0) }
        print("PERF 5,000 checklist items: tick \(String(format: "%.1f", tick)) ms, sort \(Int(sort)) ms")
        #expect(sorted != nil)
        #expect(sort < 500 * PerfBudget.slack)
        let h = await EditorHarness(text)
        defer { h.close() }
        await h.select((h.text as NSString).length)
        let key = await keystroke(h, "x")
        #expect(key < 150 * PerfBudget.slack)
    }

    @Test func hostileTitlesStayShortAndCheap() {
        let zalgo = "Z" + String(repeating: "\u{0336}\u{0337}\u{0338}\u{0321}\u{0322}", count: 2000)
        let bodies = [zalgo, "\u{202E}gnp.exe\u{202C}", String(repeating: "👨‍👩‍👧‍👦", count: 10_000), String(repeating: "x", count: 1_000_000), "", "\n\n\n", String(repeating: "#", count: 500)]
        for body in bodies {
            let n = Note(body: body)
            let t = ContinuousClock.now
            let title = n.title
            _ = n.preview
            #expect(ContinuousClock.now - t < .milliseconds(200) * PerfBudget.slack, "title of \(body.prefix(8))… is cheap")
            #expect(title.count <= 400, "a title never carries a whole megabyte")
        }
    }

    @Test func subNoteLoopsDontRecurseForever() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let a = Note(body: "A"), b = Note(body: "B")
        ctx.insert(a); ctx.insert(b)
        a.parentID = b.id
        b.parentID = a.id
        ctx.trash(a)
        #expect(a.trashedAt != nil && b.trashedAt != nil)
        ctx.restore(b)
        #expect(a.trashedAt == nil && b.trashedAt == nil)
    }

    @Test func folderLoopsDontRecurseForever() throws {
        let c = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = c.mainContext
        let a = Folder(name: "A"), b = Folder(name: "B")
        ctx.insert(a); ctx.insert(b)
        a.parent = b
        b.parent = a
        ctx.trash(a)
        #expect(a.deletedAt != nil && b.deletedAt != nil)
    }
}
#endif
