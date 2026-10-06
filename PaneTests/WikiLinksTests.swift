import Foundation
import SwiftData
import Testing
@testable import Pane

/// Obsidian-style wiki links: reading them out of markdown, resolving them by title the way
/// Obsidian does, following a rename, and an Obsidian vault imported with its links kept.
@MainActor @Suite(.serialized) struct WikiLinksTests {
    // MARK: Reading links

    @Test func linksWithFoldersAliasesAndHeadings() {
        let links = WikiLinks.links(in: "See [[Projects/Kitchen remodel|the kitchen]], [[Reading list]] and ![[Kitchen remodel#Budget]].")
        #expect(links.map(\.target) == ["Projects/Kitchen remodel", "Reading list", "Kitchen remodel"])
        #expect(links.map(\.name) == ["Kitchen remodel", "Reading list", "Kitchen remodel"])
        #expect(links[0].folders == ["Projects"] && links[0].alias == "the kitchen" && links[0].heading == nil)
        #expect(links[2].embed && links[2].heading == "Budget" && links[2].alias == nil)
        #expect(links.map(WikiLinks.display) == ["the kitchen", "Reading list", "Kitchen remodel"])
        let text = "See [[Projects/Kitchen remodel|the kitchen]]" as NSString
        #expect(text.substring(with: links[0].range) == "[[Projects/Kitchen remodel|the kitchen]]")
        #expect(text.substring(with: links[0].targetRange) == "Projects/Kitchen remodel")
        #expect(text.substring(with: links[0].aliasRange!) == "the kitchen")
    }

    @Test func codeIsLeftAlone() {
        let text = """
        [[One]] and `[[not this]]` and ``a [[nor this]] b``
        ```
        [[in a block]]
        ```
        ~~~
        [[tilde block]]
        ~~~
        [[Two]] [[]] [[#Only a heading]]
        """
        #expect(WikiLinks.links(in: text).map(\.target) == ["One", "Two"])
    }

    @Test func plainTextForPreviews() {
        #expect(WikiLinks.plain("Met Jonas about the [[Projects/Kitchen remodel#Budget|budget]] and [[Daily/2024-03-02]].") == "Met Jonas about the budget and 2024-03-02.")
        #expect(NoteText.preview(of: "Title\nSee [[Kitchen remodel|the kitchen]]") == "See the kitchen")
    }

    // MARK: Resolving

    static let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    static func entry(_ title: String, _ folders: [String], _ id: Int, age: Double = 0) -> WikiIndex.Entry {
        WikiIndex.Entry(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", id))!, title: title, folders: folders, updated: t0.addingTimeInterval(-age))
    }

    static let library = WikiIndex([
        entry("Kitchen remodel", ["Vault", "Projects"], 1),
        entry("Index", ["Vault", "Work"], 2),
        entry("Index", ["Vault", "Home"], 3, age: 100),
        entry("Index", ["Other"], 4, age: 200),
        entry("Q1/Q2 plan", ["Vault"], 5),
        entry("a_b", ["Vault"], 6),
    ])

    @Test func byTitleCaseAndSpacingAside() {
        let lib = Self.library
        #expect(lib.resolve("Kitchen remodel") == Self.entry("", [], 1).id)
        #expect(lib.resolve("kitchen  REMODEL") == Self.entry("", [], 1).id)
        #expect(lib.resolve("Kitchen remodel.md") == Self.entry("", [], 1).id)
        #expect(lib.resolve("Projects/Kitchen remodel") == Self.entry("", [], 1).id)
        #expect(lib.resolve("Moved/Kitchen remodel") == Self.entry("", [], 1).id, "a note moved since still links")
        #expect(lib.resolve("Q1/Q2 plan") == Self.entry("", [], 5).id, "a title with a slash")
        #expect(lib.resolve("a\\_b") == Self.entry("", [], 6).id, "markdown escapes aside")
        #expect(lib.resolve("Nowhere") == nil)
    }

    @Test func duplicateTitles() {
        let lib = Self.library
        #expect(lib.resolve("Home/Index") == Self.entry("", [], 3).id, "folders in front pick one")
        #expect(lib.resolve("Vault/Home/Index") == Self.entry("", [], 3).id)
        #expect(lib.resolve("Index", from: ["Vault", "Home"]) == Self.entry("", [], 3).id, "the same folder first")
        #expect(lib.resolve("Index", from: ["Other", "Deeper"]) == Self.entry("", [], 4).id, "then the most folders in common")
        #expect(lib.resolve("Index", from: ["Elsewhere"]) == Self.entry("", [], 2).id, "then the one edited last")
    }

    // MARK: Renames

    @Test func retargetKeepsFoldersHeadingsAndAliases() {
        let text = "[[Kitchen remodel]], [[Projects/Kitchen remodel#Budget|budget]], [[kitchen remodel]] and [[Other]]\n`[[Kitchen remodel]]`"
        let out = WikiLinks.retarget(text, to: "Kitchen 2025") { $0.name.lowercased() == "kitchen remodel" }
        #expect(out == "[[Kitchen 2025]], [[Projects/Kitchen 2025#Budget|budget]], [[Kitchen 2025]] and [[Other]]\n`[[Kitchen remodel]]`")
    }

    static func container() throws -> ModelContainer {
        try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @Test func renamingANoteUpdatesLinksToItOnly() throws {
        let c = try Self.container()
        let context = c.mainContext
        WikiDirectory.invalidate()
        let work = context.createFolder(named: "Work"), home = context.createFolder(named: "Home")
        let workIndex = context.createNote(in: .folder(work.id), body: "Index\nwork")
        let homeIndex = context.createNote(in: .folder(home.id), body: "Index\nhome")
        let fromWork = context.createNote(in: .folder(work.id), body: "Plan\nSee [[Index]] and [[Work/Index#Top|top]].")
        let fromHome = context.createNote(in: .folder(home.id), body: "Chores\nSee [[Index]].")
        let locked = context.createNote(in: .folder(work.id), body: "Diary\n[[Index]]")
        locked.lockedBody = "sealed"
        try context.save()
        WikiDirectory.invalidate()

        #expect(Set(context.backlinks(to: workIndex).map(\.id)) == [fromWork.id])
        #expect(context.backlinks(to: homeIndex).map(\.id) == [fromHome.id])

        workIndex.body = "Work index\nwork"
        let changed = context.retargetWikiLinks(to: workIndex, renamedFrom: "Index")
        #expect(changed == 1)
        #expect(fromWork.body == "Plan\nSee [[Work index]] and [[Work/Work index#Top|top]].")
        #expect(fromHome.body == "Chores\nSee [[Index]].", "a link to the other Index stays")
        #expect(locked.body == "Diary\n[[Index]]", "a locked note can't be changed here")
        WikiDirectory.invalidate()
        #expect(context.resolveWikiLink("Work index", from: fromWork)?.id == workIndex.id)
        #expect(context.backlinks(to: workIndex).map(\.id) == [fromWork.id])
    }

    @Test func linkPolicyCarriesTheTarget() {
        let url = LinkPolicy.wikiURL("Projects/Kitchen remodel & co")!
        #expect(LinkPolicy.action(for: url) == .wiki("Projects/Kitchen remodel & co"))
        #expect(LinkPolicy.action(for: URL(string: "pane-wiki:")!) == .nothing)
    }

    // MARK: Importing a vault

    /// A small vault with the cases Obsidian resolves: nested folders, the same name twice,
    /// relative paths, aliases, headings, a heading that renames a note, and a link to nothing.
    static func vault() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appending(path: "wiki-\(UUID().uuidString)/My vault")
        let files: [String: String] = [
            "Home.md": "# Home\n\nStart with [[Projects/Garden]], [[garden#Beds|the beds]], [[Index]] and [[Work/Index|work index]].\nAlso [[Recipes/Bread.md]], [[./Inbox]], [[Someday]] and `[[code]]`.\n![[Garden]]\n[Inbox as a markdown link](Inbox.md)\n",
            "Inbox.md": "Things to file. Back to [[Home]].\n",
            "Projects/Garden.md": "---\ntitle: Garden plan\n---\nBeds and [[../Home|home]].\n",
            "Projects/Index.md": "Projects list\n",
            "Work/Index.md": "Work list, see [[Index]].\n",
            "Recipes/Bread.md": "# Sourdough bread\nFlour.\n",
        ]
        for (path, text) in files {
            let url = root.appending(path: path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url)
        }
        return root
    }

    @Test func importKeepsLinksAcrossFolders() async throws {
        let c = try Self.container()
        let r = try await MarkdownImportTests.importing([try Self.vault()], container: c)
        defer { r.cleanUp() }
        #expect(r.summary.notes == 6)
        let home = try r.note("Home")
        #expect(home.body == """
        Home
        Start with [[Garden plan|Garden]], [[Garden plan#Beds|the beds]], [[Projects/Index]] and [[Work/Index|work index]].
        Also [[Sourdough bread|Bread]], [[Inbox]], [[Someday]] and `[[code]]`.
        [[Garden plan|Garden]]
        [[Inbox|Inbox as a markdown link]]

        """)
        #expect(try r.note("Garden plan").body == "Garden plan\nBeds and [[Home|home]].\n")
        // Two notes are called Index: each link names its folder. From Work, [[Index]] meant its own.
        let workIndex = try #require(r.notes.first { r.path($0) == "My vault/Work" })
        #expect(workIndex.body == "Index\nWork list, see [[Work/Index]].\n")
        let projectsIndex = try #require(r.notes.first { r.path($0) == "My vault/Projects" && $0.title == "Index" })

        // Every kept link leads to the note it named in the vault.
        WikiDirectory.invalidate()
        let expected = ["Garden plan", "Garden plan", "Index", "Index", "Sourdough bread", "Inbox", "Garden plan", "Inbox"]
        let found = WikiLinks.links(in: home.body).filter { $0.target != "Someday" }.map { r.context.resolveWikiLink($0.target, from: home)?.title }
        #expect(found == expected)
        #expect(r.context.resolveWikiLink("Projects/Index", from: home)?.id == projectsIndex.id)
        #expect(r.context.resolveWikiLink("Work/Index", from: home)?.id == workIndex.id)
        #expect(r.context.resolveWikiLink("Someday", from: home) == nil)
        #expect(r.context.resolveWikiLink("Sourdough bread", from: home)?.title == "Sourdough bread")
        #expect(r.context.backlinks(to: try r.note("Inbox")).map(\.title) == ["Home"])
    }

    /// A realistic vault (PaneTests/Fixtures/Markdown/Linked vault, made by
    /// make-vault.py): 52 notes in nested folders. Every link leads where Obsidian's does,
    /// apart from the ones to notes not written yet.
    @Test func aRealisticVault() async throws {
        let r = try await MarkdownImportTests.importing([try MarkdownImportTests.fixture("Linked vault")], container: try Self.container())
        defer { r.cleanUp() }
        #expect(r.summary.notes == 52 && r.summary.attachments == 2 && r.summary.filesMissing == 0)
        WikiDirectory.invalidate()
        let notYetWritten: Set<String> = ["Garden irrigation", "Learn Rust", "wiki links", "{{yesterday}}"]
        var links = 0
        for n in r.notes {
            for link in WikiLinks.links(in: n.body) {
                links += 1
                let found = r.context.resolveWikiLink(link.target, from: n)
                #expect((found == nil) == notYetWritten.contains(link.target), "\(n.title): [[\(link.target)]]")
            }
        }
        #expect(links > 100)

        /// Where the link that shows `shown` in note `from` leads.
        func lead(_ from: String, _ shown: String) -> String? {
            guard let n = r.notes.first(where: { $0.title == from }),
                  let link = WikiLinks.links(in: n.body).first(where: { WikiLinks.display($0) == shown }),
                  let to = r.context.resolveWikiLink(link.target, from: n) else { return nil }
            return r.path(to) + "/" + to.title
        }
        let v = "Linked vault"
        #expect(lead("Garden", "Notes") == "\(v)/Projects/Garden/Notes", "same name in two folders: its own folder's")
        #expect(lead("2026-10-03 Notes review", "Notes") == "\(v)/Meetings/2026/Notes")
        #expect(lead("MCP memory for agents", "README") == "\(v)/Projects/Amber/Amber Notes import", "README next to it")
        #expect(lead("Planting calendar", "beds") == "\(v)/Projects/Garden/Garden")
        #expect(lead("Amber Notes import", "Index") == "\(v)/Projects/Projects", "the Index nearest")
        #expect(lead("Obsidian workflow", "Planting calendar") == "\(v)/Projects/Garden/Planting calendar", "a relative path")
        #expect(lead("Quick capture", "Inbox") == "\(v)/Inbox", "a .md ending")
        #expect(lead("Home", "PARA") == "\(v)/PARA method", "a front-matter title")
        #expect(lead("Smörgåsbord", "Café list") == "\(v)/Café list")
        let quick = try r.note("Quick capture")
        #expect(quick.body.contains("[[Home|Home page]]") && quick.body.contains("[[Planting calendar|the calendar]]"), "markdown links to notes become wiki links")
        #expect(try r.note("Amber Notes import").body.contains("Code keeps [[not a link]] as typed."))
        #expect(r.context.backlinks(to: try r.note("Giulia")).count == 6)
    }
}

