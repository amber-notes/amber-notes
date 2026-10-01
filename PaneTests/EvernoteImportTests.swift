import CryptoKit
import Foundation
import SwiftData
import Testing
@testable import Pane

/// The Evernote import: reading .enex files as a stream, ENML to markdown, attachments placed
/// where the body had them, and the import itself (folders, dates, tags, duplicates, limits).
@MainActor @Suite(.serialized) struct EvernoteImportTests {
    /// Six notes, as Evernote 10 writes them: a recipe with an image and nested lists, a
    /// checklist in both of Evernote's styles, a table with code and unicode, an encrypted
    /// section, a PDF with an unplaced and a missing file, and an empty note.
    static var recipes: URL { Bundle(for: EvernoteFixtureToken.self).url(forResource: "Recipes", withExtension: "enex")! }

    static func container() throws -> ModelContainer {
        try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    static func read(_ url: URL) throws -> [ENEXNote] {
        var notes: [ENEXNote] = []
        let scratch = FileManager.default.temporaryDirectory.appending(path: "enex-test-\(UUID().uuidString)")
        try ENEXReader(url: url, scratch: scratch) { notes.append($0); return true }.read()
        return notes
    }

    static func md(_ enml: String, media: @escaping (String) -> String? = { _ in nil }) -> ENMLToMarkdown.Result {
        ENMLToMarkdown.convert("<en-note>\(enml)</en-note>", media: media)
    }

    // MARK: Reading

    @Test func readsEveryNoteWithItsDatesTagsAndFiles() throws {
        let notes = try Self.read(Self.recipes)
        #expect(notes.map(\.title) == ["Grandma's cardamom buns", "Weekly groceries", "Pasta night for eight", "Bank details", "Lease agreement", ""])
        let buns = notes[0]
        #expect(buns.tags == ["baking", "family recipes"])
        #expect(buns.created == ENEXReader.date("20190314T081500Z"))
        #expect(buns.updated?.timeIntervalSince1970 == 1_704_223_800)
        #expect(buns.content.contains("<en-media hash=\"4c048024771edb5751c98035a4b80a2a\""))
        let image = try #require(buns.resources.first)
        #expect(image.mime == "image/png" && image.filename == nil)
        #expect(image.hash == "4c048024771edb5751c98035a4b80a2a", "the hash of the decoded bytes is the one the body names")
        let bytes = try Data(contentsOf: try #require(image.file))
        #expect(bytes.count == image.size && bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]))
        #expect(Insecure.MD5.hash(data: bytes).map { String(format: "%02x", $0) }.joined() == image.hash)
        let lease = notes[4].resources
        #expect(lease.map(\.filename) == ["Lease 2022.pdf", "floor plan.png"])
        #expect(lease[0].mime == "application/pdf")
    }

    @Test func countsNotesWithoutParsing() throws {
        #expect(try ENEXReader.countNotes(in: Self.recipes) == 6)
        let other = FileManager.default.temporaryDirectory.appending(path: "not-an-export-\(UUID().uuidString).enex")
        try "<?xml version=\"1.0\"?><html><body>hi</body></html>".write(to: other, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: other) }
        #expect(throws: ENEXReader.Failure.notAnExport) { try ENEXReader.countNotes(in: other) }
        #expect(throws: ENEXReader.Failure.notAnExport) { try Self.read(other) }
        #expect(EvernoteImporter.inspect(other).problem != nil)
    }

    @Test func aBrokenFileSaysSo() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "broken-\(UUID().uuidString).enex")
        try "<?xml version=\"1.0\"?><en-export><note><title>One</title><content><![CDATA[<en-note>a</en-note>]]></content></note><note><title>Two".write(to: url, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: url) }
        var titles: [String] = []
        #expect(throws: ENEXReader.Failure.self) {
            try ENEXReader(url: url, scratch: FileManager.default.temporaryDirectory) { titles.append($0.title); return true }.read()
        }
        #expect(titles == ["One"], "notes before the damage still come through")
    }

    @Test func evernoteDates() {
        #expect(ENEXReader.date("20231105T143012Z")?.timeIntervalSince1970 == 1_699_194_612)
        #expect(ENEXReader.date("2023-11-05") == nil)
        #expect(ENEXReader.date("") == nil)
    }

    // MARK: ENML to markdown

    @Test func headingsAndInlineFormatting() {
        let r = Self.md(#"<h1>Trip</h1><h2>Day <b>one</b></h2><h4>Small</h4><div><b>Bold</b>, <i>italic</i>, <u>under</u>, <s>gone</s>, <code>x = 1</code> and <span style="font-weight:700;font-style:italic">both</span>.</div>"#)
        #expect(r.markdown == "# Trip\n## Day one\n### Small\n**Bold**, *italic*, <u>under</u>, ~~gone~~, `x = 1` and ***both***.")
    }

    @Test func linesBlankLinesAndBreaks() {
        let r = Self.md("<div>One</div><div><br/></div><div><br/></div><div>Two<br/>Three<br/></div><p>Para</p><div>After</div>")
        #expect(r.markdown == "One\n\nTwo\nThree\nPara\n\nAfter")
    }

    @Test func nestedListsBothWays() {
        // Evernote nests a list straight inside the outer one; HTML nests it in the item.
        let r = Self.md("<ul><li>a</li><ul><li>a1</li><ol><li>deep</li></ol></ul><li>b<ul><li>b1</li></ul></li></ul><ol start=\"3\"><li>three</li><li>four</li></ol>")
        #expect(r.markdown == "* a\n  * a1\n    1. deep\n* b\n  * b1\n\n3. three\n4. four")
    }

    @Test func checklistsInBothStyles() {
        let old = Self.md(#"<div><en-todo checked="true"/>Milk</div><div><en-todo checked="false"/>Eggs</div><div><en-todo/>Saffron <i>(the good one)</i></div><div><en-todo/>One<br/><en-todo checked="true"/>Two</div>"#)
        #expect(old.markdown == "- [x] Milk\n- [ ] Eggs\n- [ ] Saffron *(the good one)*\n- [ ] One\n- [x] Two")
        let new = Self.md(#"<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Coffee</div></li><li style="--en-checked:false;"><div>Bread</div></li></ul>"#)
        #expect(new.markdown == "- [x] Coffee\n- [ ] Bread")
        let inList = Self.md("<ul><li><en-todo checked=\"true\"/>done</li><li>plain</li></ul>")
        #expect(inList.markdown == "- [x] done\n* plain")
    }

    @Test func tables() {
        let r = Self.md("<div>Before</div><table><tbody><tr><td><b>Dish</b></td><td>Who</td></tr><tr><td>Salad | greens</td><td><div>Emma</div><div>and Jonas</div></td></tr><tr><td colspan=\"2\">All</td></tr></tbody></table><div>After</div>")
        #expect(r.markdown == "Before\n\n| **Dish** | Who |\n| --- | --- |\n| Salad \\| greens | Emma<br>and Jonas |\n| All |   |\n\nAfter")
    }

    @Test func linksRulesQuotesAndCode() {
        let r = Self.md(#"<div>See <a href="https://example.com/a b">the post</a> or <a href="https://example.com">https://example.com</a>.</div><hr/><blockquote><div>Quoted</div><div>twice</div></blockquote><div style="-en-codeblock:true"><div>let x = 1</div><div><br/></div><div>  indented &amp; kept</div></div><pre>raw\#n  pre</pre>"#)
        #expect(r.markdown == "See [the post](https://example.com/a%20b) or https://example.com.\n\n---\n\n> Quoted\n> twice\n\n```\nlet x = 1\n\n  indented & kept\n```\n\n```\nraw\n  pre\n```")
    }

    @Test func entitiesUnicodeAndEscapes() {
        let r = Self.md("<div>37&deg;C &ndash; caf&eacute; &copy; 李雷 محمد 🍝&nbsp;&nbsp;ok &amp; &lt;b&gt; &unknown; R&D</div><div>snake_case, *stars*, 2 * 3</div>")
        #expect(r.markdown == "37°C – café © 李雷 محمد 🍝  ok & <b> &unknown; R&D\nsnake_case, \\*stars\\*, 2 * 3")
    }

    @Test func encryptedSectionsLeaveAMarkedLine() {
        let r = Self.md(#"<div>Account:</div><div><en-crypt hint="usual" cipher="AES" length="128">RU5DMI1m</en-crypt></div><div>Rest <en-crypt>QUJD</en-crypt> here</div>"#)
        #expect(r.encrypted == 2)
        let line = ENMLToMarkdown.encryptedLine
        #expect(r.markdown == "Account:\n\(line)\nRest\n\(line)\nhere")
        #expect(!r.markdown.contains("RU5DMI1m"), "the ciphertext isn't kept")
    }

    @Test func attachmentsGoWhereTheBodyHadThem() {
        let files = ["aaa": "![photo.jpg](pane-file:11111111-1111-1111-1111-111111111111)", "bbb": "[plan.pdf](pane-file:22222222-2222-2222-2222-222222222222)"]
        let r = Self.md(#"<div>Before <en-media hash="AAA" type="image/jpeg"/> after</div><ul><li>item <en-media hash="bbb" type="application/pdf"/></li></ul><table><tr><td><en-media hash="aaa"/>cell</td></tr></table><en-media hash="ccc"/>"#) { files[$0] }
        #expect(r.placed == ["aaa", "bbb", "aaa"])
        #expect(r.missing == 1, "a file the export doesn't hold is counted, not invented")
        #expect(r.markdown == "Before\n\(files["aaa"]!)\nafter\n* item\n\(files["bbb"]!)\n\n| cell |\n| --- |\n\n\(files["aaa"]!)")
        // Each file line is a whole-line embed, which the editor shows as the file.
        #expect(LineEmbed.find(in: r.markdown).count == 3)
    }

    @Test func aBodyThatWontParseKeepsItsWords() {
        let r = ENMLToMarkdown.convert("<en-note><div>Open <b>bold</div><div>Next</div>", media: { _ in nil })
        #expect(r.markdown == "Open bold\nNext")
    }

    @Test func titlesAndTags() {
        #expect(ImportWriter.titleLine("# not a heading") == "\\# not a heading")
        #expect(ImportWriter.titleLine("1. First") == "\\1. First")
        #expect(ImportWriter.titleLine("snake_case *star*") == "snake_case \\*star\\*")
        #expect(ImportWriter.tagLine(["baking", "family recipes", "#home", "Baking", " "]) == "#baking #family-recipes #home")
        #expect(ImportWriter.tagLine([]) == nil)
    }

    // MARK: Importing

    @Test func importsTheNotebookAsAFolder() async throws {
        let c = try Self.container()
        let ctx = c.mainContext
        let source = EvernoteImporter.inspect(Self.recipes)
        #expect(source.name == "Recipes" && source.notes == 6 && source.problem == nil)
        var steps: [Int] = []
        let summary = await EvernoteImporter(context: ctx).run([source], into: .perSource, progress: { done, _ in steps.append(done) })
        #expect(summary.notes == 5)
        #expect(summary.empty == 1 && summary.alreadyImported == 0 && summary.skipped == 1)
        #expect(summary.attachments == 3)
        #expect(summary.filesMissing == 1, "the Lease note names a picture the export doesn't have")
        #expect(summary.encrypted == 1)
        #expect(summary.failedFiles.isEmpty && !summary.stopped)
        #expect(steps.last == 6)

        let notes = try ctx.fetch(FetchDescriptor<Note>())
        #expect(notes.count == 5 && notes.allSatisfy { $0.folder?.name == "Recipes" && $0.dirty })
        #expect(ctx.allFolders().map(\.name) == ["Recipes"])
        func note(_ t: String) throws -> Note { try #require(notes.first { $0.title == t }) }

        let buns = try note("Grandma's cardamom buns")
        #expect(buns.createdAt == ENEXReader.date("20190314T081500Z") && buns.updatedAt == ENEXReader.date("20240102T193000Z"))
        let image = try #require(try ctx.fetch(FetchDescriptor<Pane.Attachment>()).first { $0.contentType == "public.png" && $0.filename == "Image.png" })
        #expect(FileStore.exists(image) && image.size > 0 && !image.uploaded)
        #expect(buns.body == """
        Grandma's cardamom buns
        **Makes 24 buns.** Start the dough the *night before*.

        ## Dough
        * 500 g flour
        * 2 tsp **freshly ground** cardamom
          * green pods, not black
          * crush with a mortar
        * 75 g butter

        \(image.markdown)
        ### Steps
        1. Warm the milk to 37°C.
        2. Knead for <u>ten minutes</u>.
          1. Rest an hour.
        3. Bake at 225 °C – about 8 min.

        #baking #family-recipes

        """)

        #expect(try note("Weekly groceries").body.hasPrefix("Weekly groceries\n- [x] Oat milk\n- [ ] Lemons\n- [ ] Saffron *(the good one)*\n\nEvernote 10 list:\n- [x] Coffee\n- [ ] Bread\n"))

        let pasta = try note("Pasta night for eight").body
        #expect(!pasta.hasPrefix("Pasta night for eight\nPasta night for eight"), "a title repeated as the first line isn't doubled")
        #expect(pasta.contains("Guests: Åsa, Jürgen, 李雷, محمد and Zoë 🍝  (two vegetarians)"))
        #expect(pasta.contains("| **Dish** | **Who** | **Cost** |\n| --- | --- | --- |\n| Cacio e pepe | Jonas | 120 kr |\n| Salad \\| greens | Emma | 45 kr |"))
        #expect(pasta.contains("[this blog](https://example.com/cacio-e-pepe)"))
        #expect(pasta.contains("\n---\n") && pasta.contains("```\nwater = 4 L\nsalt = 40 g  # 10 g per litre\n```") && pasta.contains("> Pasta water is the sauce."))

        let bank = try note("Bank details").body
        #expect(bank == "Bank details\nAccount for the cabin:\n\(ENMLToMarkdown.encryptedLine)\nAsk Jonas for the rest.\n\n#private\n")

        let lease = try note("Lease agreement").body
        let files = try ctx.fetch(FetchDescriptor<Pane.Attachment>())
        let pdf = try #require(files.first { $0.filename == "Lease 2022.pdf" })
        let plan = try #require(files.first { $0.filename == "floor plan.png" })
        #expect(pdf.contentType == "com.adobe.pdf")
        #expect(lease == "Lease agreement\nSigned copy below.\n\(pdf.markdown)\nFloor plan is attached too.\n\n\(plan.markdown)\n", "a file the body never placed goes at the end")
        #expect(try Data(contentsOf: FileStore.url(for: pdf.id, filename: pdf.filename)).starts(with: Array("%PDF".utf8)))
        for f in files { try? FileManager.default.removeItem(at: FileStore.url(for: f.id, filename: f.filename).deletingLastPathComponent()) }
    }

    @Test func importingTheSameFileAgainMakesNoCopies() async throws {
        let c = try Self.container()
        let ctx = c.mainContext
        let source = EvernoteImporter.inspect(Self.recipes)
        let first = await EvernoteImporter(context: ctx).run([source], into: .perSource)
        #expect(first.notes == 5)
        // Moved and edited here since: still the same notes.
        let target = ctx.createFolder(named: "Kitchen")
        for n in try ctx.fetch(FetchDescriptor<Note>()) { n.folder = target; n.body += "\nMy own line" }
        let again = await EvernoteImporter(context: ctx).run([source], into: .perSource)
        #expect(again.notes == 0 && again.alreadyImported == 5 && again.attachments == 0)
        #expect(try ctx.fetch(FetchDescriptor<Note>()).count == 5)
        // A note deleted here comes back on the next import.
        let buns = try #require(try ctx.fetch(FetchDescriptor<Note>()).first { $0.title == "Grandma's cardamom buns" })
        ctx.trash(buns)
        let third = await EvernoteImporter(context: ctx).run([source], into: .perSource)
        #expect(third.notes == 1 && third.alreadyImported == 4)
        for f in try ctx.fetch(FetchDescriptor<Pane.Attachment>()) { try? FileManager.default.removeItem(at: FileStore.url(for: f.id, filename: f.filename).deletingLastPathComponent()) }
    }

    @Test func twoNotesAlikeInOneFileBothComeIn() async throws {
        let url = try Self.write(notes: (0..<2).map { _ in Self.enexNote(title: "Standup", body: "<div>same</div>", created: "20240101T090000Z") })
        defer { try? FileManager.default.removeItem(at: url) }
        let c = try Self.container()
        let ctx = c.mainContext
        #expect(await EvernoteImporter(context: ctx).run([EvernoteImporter.inspect(url)], into: .perSource).notes == 2)
        #expect(await EvernoteImporter(context: ctx).run([EvernoteImporter.inspect(url)], into: .perSource).alreadyImported == 2)
    }

    @Test func intoAFolderYouPick() async throws {
        let c = try Self.container()
        let ctx = c.mainContext
        let inbox = ctx.createFolder(named: "From Evernote")
        let other = try Self.write(notes: [Self.enexNote(title: "Second notebook note", body: "<div>hi</div>", created: "20240101T090000Z")], name: "Work")
        defer { try? FileManager.default.removeItem(at: other) }
        let summary = await EvernoteImporter(context: ctx).run([EvernoteImporter.inspect(Self.recipes), EvernoteImporter.inspect(other)], into: .folder(inbox.id))
        #expect(summary.notes == 6)
        #expect(try ctx.fetch(FetchDescriptor<Note>()).allSatisfy { $0.folder?.id == inbox.id })
        #expect(ctx.allFolders().map(\.name) == ["From Evernote"], "no folder per notebook")
        for f in try ctx.fetch(FetchDescriptor<Pane.Attachment>()) { try? FileManager.default.removeItem(at: FileStore.url(for: f.id, filename: f.filename).deletingLastPathComponent()) }
    }

    @Test func aFolderPerNotebookReusesOneOfTheSameName() async throws {
        let c = try Self.container()
        let ctx = c.mainContext
        let mine = ctx.createFolder(named: "Work")
        let url = try Self.write(notes: [Self.enexNote(title: "Q4 planning", body: "<div>hi</div>", created: "20240101T090000Z")], name: "Work")
        defer { try? FileManager.default.removeItem(at: url) }
        _ = await EvernoteImporter(context: ctx).run([EvernoteImporter.inspect(url)], into: .perSource)
        let placed = try ctx.fetch(FetchDescriptor<Note>()).first?.folder?.id
        #expect(ctx.allFolders().count == 1 && placed == mine.id)
    }

    @Test func limitsAreSaidNotHit() async throws {
        let c = try Self.container()
        let ctx = c.mainContext
        let long = String(repeating: "<div>\(String(repeating: "word ", count: 200))</div>", count: 1600)
        let url = try Self.write(notes: [Self.enexNote(title: "Huge", body: long, created: "20240101T090000Z"),
                                         Self.enexNote(title: "Fine", body: "<div>ok</div>", created: "20240101T090000Z")])
        defer { try? FileManager.default.removeItem(at: url) }
        let s = await EvernoteImporter(context: ctx).run([EvernoteImporter.inspect(url)], into: .perSource)
        #expect(s.notes == 1 && s.tooLong == 1 && s.skipped == 1)
    }

    @Test func stoppingKeepsWhatCameIn() async throws {
        let c = try Self.container()
        let ctx = c.mainContext
        let url = try Self.write(notes: (0..<40).map { Self.enexNote(title: "Note \($0)", body: "<div>\($0)</div>", created: "20240101T0900\(String(format: "%02d", $0 % 60))Z") })
        defer { try? FileManager.default.removeItem(at: url) }
        var done = 0
        let s = await EvernoteImporter(context: ctx).run([EvernoteImporter.inspect(url)], into: .perSource, progress: { d, _ in done = d }, shouldStop: { done >= 10 })
        #expect(s.stopped && s.notes == 10)
        #expect(try ctx.fetch(FetchDescriptor<Note>()).count == 10)
    }

    /// Thousands of notes and a 40 MB attachment, read as a stream: memory stays flat.
    @Test func aBigExportStreams() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "enex-big-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appending(path: "Archive.enex")
        // A 39 MB file, written in pieces so the test doesn't hold it either; hashed first, so
        // the body can name it.
        let piece = Data((0..<(3 * 1024 * 1024)).map { UInt8(truncatingIfNeeded: $0 &* 31) })
        let pieces = 13
        var md5 = Insecure.MD5()
        for _ in 0..<pieces { md5.update(data: piece) }
        let hash = md5.finalize().map { String(format: "%02x", $0) }.joined()
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let out = try FileHandle(forWritingTo: url)
        out.write(Data("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<en-export application=\"Evernote\" version=\"10\">\n".utf8))
        for i in 0..<3000 {
            out.write(Data(Self.enexNote(title: "Meeting \(i)", body: "<div>Notes for meeting \(i) with <b>Sara</b>.</div><ul><li>one</li><li>two</li></ul>", created: "20230101T100000Z").utf8))
        }
        out.write(Data("<note><title>Scans</title><content><![CDATA[<en-note><div>Scans</div><en-media hash=\"\(hash)\" type=\"application/octet-stream\"/></en-note>]]></content><created>20230601T120000Z</created><resource><data encoding=\"base64\">\n".utf8))
        for _ in 0..<pieces {
            out.write(piece.base64EncodedData(options: [.lineLength76Characters, .endLineWithLineFeed]))
            out.write(Data("\n".utf8))
        }
        out.write(Data("</data><mime>application/octet-stream</mime><resource-attributes><file-name>scans.bin</file-name></resource-attributes></resource></note>\n</en-export>\n".utf8))
        try out.close()
        let bigSize = piece.count * pieces

        let c = try Self.container()
        let ctx = c.mainContext
        let source = EvernoteImporter.inspect(url)
        #expect(source.notes == 3001 && source.bytes > 50_000_000)
        let before = Self.footprint()
        var peak = before
        let s = await EvernoteImporter(context: ctx).run([source], into: .perSource, progress: { d, _ in if d % 250 == 0 { peak = max(peak, Self.footprint()) } })
        peak = max(peak, Self.footprint())
        #expect(s.notes == 3001 && s.attachments == 1 && s.filesMissing == 0)
        let file = try #require(try ctx.fetch(FetchDescriptor<Pane.Attachment>()).first)
        #expect(file.size == Int64(bigSize) && file.filename == "scans.bin")
        let scans = try #require(try ctx.fetch(FetchDescriptor<Note>()).first { $0.title == "Scans" })
        #expect(scans.body.contains(file.markdown))
        // The export is about 56 MB on disk; reading it whole (and its base64 as a string) would
        // add well over that. The stream keeps the growth to the notes themselves.
        #expect(peak - before < 120_000_000, "grew \((peak - before) / 1_000_000) MB")
        try? FileManager.default.removeItem(at: FileStore.url(for: file.id, filename: file.filename).deletingLastPathComponent())
    }

    // MARK: Shared into the app

    @Test func anExportSharedIntoTheAppWaitsForTheImport() throws {
        let tmp = FileManager.default.temporaryDirectory.appending(path: "enex-inbox-\(UUID().uuidString)")
        Inbox.rootOverride = tmp.appending(path: "Inbox")
        defer { Inbox.rootOverride = nil; EvernoteInbox.clear(); try? FileManager.default.removeItem(at: tmp) }
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let copy = tmp.appending(path: "Recipes.enex")
        try FileManager.default.copyItem(at: Self.recipes, to: copy)
        try Inbox.add(markdown: "", files: [copy])
        var offered = false
        let observer = NotificationCenter.default.addObserver(forName: .paneEvernoteOffered, object: nil, queue: nil) { _ in offered = true }
        defer { NotificationCenter.default.removeObserver(observer) }
        let c = try Self.container()
        let ctx = c.mainContext
        #expect(ctx.drainInbox().isEmpty, "an export isn't filed as a note holding the file")
        #expect(offered && EvernoteInbox.files.map(\.lastPathComponent) == ["Recipes.enex"])
        #expect(Inbox.pending().isEmpty)
        #expect(EvernoteImporter.inspect(try #require(EvernoteInbox.files.first)).notes == 6)
    }

    // MARK: Helpers

    static func enexNote(title: String, body: String, created: String) -> String {
        "<note><title>\(title)</title><content><![CDATA[<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE en-note SYSTEM \"http://xml.evernote.com/pub/enml2.dtd\"><en-note>\(body)</en-note>]]></content><created>\(created)</created><updated>\(created)</updated></note>\n"
    }

    static func write(notes: [String], name: String = "Notebook") throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: "enex-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: "\(name).enex")
        try ("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<en-export application=\"Evernote\">\n" + notes.joined() + "</en-export>\n").write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    /// This process's memory footprint, as Activity Monitor counts it.
    static func footprint() -> Int {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return kr == KERN_SUCCESS ? Int(info.phys_footprint) : 0
    }
}

private final class EvernoteFixtureToken {}
