import { Figure } from "@/lib/blog";
import { MCP_URL } from "@/lib/facts";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";
import { APP_STORE_LIVE } from "@/lib/site";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-mcp");

type Row = { name: string; href: string; how: string; can: string; setup: string; clients: string; status: string };

// Checked against each project's README and GitHub page on 30 September 2026.
const ROWS: Row[] = [
  {
    name: "sweetrb/apple-notes-mcp", href: "https://github.com/sweetrb/apple-notes-mcp",
    how: "AppleScript, plus Apple Shortcuts and read-only reads of the Notes database",
    can: "Search, read, create, update, move and delete notes; folders, tags, tables, pins, attachments; export to Markdown, HTML or JSON",
    setup: "One command with npx; a plugin for Claude Code and Codex",
    clients: "Claude Code, Claude Desktop, Codex and other MCP apps on the same Mac",
    status: "Maintained; version 2.9.32 on 29 September 2026; MIT",
  },
  {
    name: "RafalWilinski/mcp-apple-notes", href: "https://github.com/RafalWilinski/mcp-apple-notes",
    how: "JavaScript for Automation, plus a search index it builds on your Mac",
    can: "Search by meaning and by text, read, list and create notes",
    setup: "Clone it, install Bun, edit the Claude Desktop config, then ask Claude to index your notes",
    clients: "Claude Desktop",
    status: "Last changed December 2024; no license listed",
  },
  {
    name: "sirmews/apple-notes-mcp", href: "https://github.com/sirmews/apple-notes-mcp",
    how: "Reads the Notes database",
    can: "List, read and search notes; can't create or edit",
    setup: "Install with uvx, edit the Claude Desktop config, grant Full Disk Access",
    clients: "Claude Desktop",
    status: "Archived; last changed December 2024; MIT",
  },
  {
    name: "supermemoryai/apple-mcp", href: "https://github.com/supermemoryai/apple-mcp",
    how: "AppleScript; also covers Messages, Mail, Contacts, Reminders, Calendar and Maps",
    can: "Search, list and create notes",
    setup: "A one-click desktop extension for Claude Desktop, or an install command",
    clients: "Claude Desktop, Cursor",
    status: "Archived; last changed August 2025; MIT",
  },
];

const FAQ = [
  { q: "Is there an official Apple Notes MCP server?", a: [
    "No. Apple doesn't make one, and Apple Notes has no public API. Every Apple Notes MCP server is a community project that runs on your Mac and reaches your notes through the Notes app or its database.",
  ] },
  { q: "Which Apple Notes MCP server is the best?", a: [
    "In September 2026, sweetrb/apple-notes-mcp. Of the four compared here it's the only one still maintained, and the only one that can edit, move, organize and export notes.",
  ] },
  { q: "Can ChatGPT use an Apple Notes MCP server?", a: [
    "No. ChatGPT connects to MCP servers on the internet, and an Apple Notes MCP server is a program on your Mac. The same goes for claude.ai and the Claude and ChatGPT apps on iPhone.",
  ] },
  { q: "Can an Apple Notes MCP server read locked notes?", a: [
    "No. Notes you've locked with a password can't be read or changed by any of these servers.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-mcp"
      intro={<>Search for an Apple Notes MCP server and you get a list of GitHub repositories. I went through the main ones in September 2026 and checked each against its own README. Here&apos;s what each can do, how to set up the best one in Claude, and the limits they all share. I make Amber Notes, which is a different answer to the same question, so weigh that part with that in mind.</>}
      faq={FAQ}
    >
      <h2>What an Apple Notes MCP server is</h2>
      <p>
        MCP (Model Context Protocol) is an open standard for connecting AI apps to other apps. An MCP server gives an AI app tools such
        as &ldquo;search notes&rdquo; or &ldquo;create a note&rdquo;, and the AI calls them when you ask.
      </p>
      <p>
        Apple doesn&apos;t make an MCP server for Notes, and Apple Notes has no public API (<a href="/blog/apple-notes-api">what exists
        instead</a>). So every Apple Notes MCP server is a community project that runs on your Mac and gets to your notes in one of two
        ways:
      </p>
      <ul>
        <li><strong>Through the Notes app</strong>, with AppleScript or JavaScript for Automation. This can read and write, and macOS asks you to allow it.</li>
        <li><strong>By reading the Notes database</strong> on your Mac. This is read only, and needs Full Disk Access.</li>
      </ul>
      <p>
        The Claude desktop app also has an Apple Notes extension of its own, which <a href="/blog/claude-and-apple-notes">the Claude
        and Apple Notes guide</a> covers.
      </p>

      <h2>The servers compared</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">Server</th><th scope="col">How it reaches Notes</th><th scope="col">What the AI can do</th><th scope="col">Setup</th><th scope="col">AI apps</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name}>
                <th scope="row"><a href={r.href} rel="noopener">{r.name}</a></th>
                <td>{r.how}</td><td>{r.can}</td><td>{r.setup}</td><td>{r.clients}</td><td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="label"><strong>sweetrb/apple-notes-mcp</strong></p>
      <p>
        The one to use today. It has the most tools by far, is updated every few days, and is careful with your notes: an update is checked
        against the version the AI read, so it won&apos;t overwrite a change made since, and deleted notes go to Recently Deleted.
        It works without Full Disk Access; with it, you also get queries across your library, checklist state and tables. Real
        checklists, tags and pins go through Apple Shortcuts it asks you to add once, because AppleScript can&apos;t do those.
      </p>
      <p className="label"><strong>RafalWilinski/mcp-apple-notes</strong></p>
      <p>
        The interesting idea here is search by meaning: it builds a local index of your notes with a small on-device model, so you can
        ask for notes about a topic without the exact words. It hasn&apos;t changed since December 2024, and it can&apos;t edit or
        organize notes.
      </p>
      <p className="label"><strong>sirmews/apple-notes-mcp</strong></p>
      <p>
        A read-only server that reads the Notes database. It&apos;s archived, so it gets no fixes. One thing to watch: it&apos;s
        published as <code>apple-notes-mcp</code> for Python, while sweetrb&apos;s server has the same name for Node.js, so{" "}
        <code>uvx apple-notes-mcp</code> and <code>npx apple-notes-mcp</code> install two different projects.
      </p>
      <p className="label"><strong>supermemoryai/apple-mcp</strong></p>
      <p>
        A popular all-in-one server for Apple&apos;s apps, where Notes is one tool among many. It can search, list and create notes,
        but not edit them. It&apos;s archived.
      </p>

      <h2>Set it up in Claude Code</h2>
      <p>You need macOS, Node.js 20 or later, and at least one account in the Notes app. Then run:</p>
      <pre><code>claude mcp add apple-notes -s user -- npx -y apple-notes-mcp</code></pre>
      <ol>
        <li>Start Claude Code and ask it to find a note.</li>
        <li>The first time, macOS asks for permission to control Notes. Choose OK.</li>
        <li>For checklists, tags, tables and pins, run <code>npx -y apple-notes-mcp setup</code> and add the Shortcuts it opens. Then run each one once in the Shortcuts app and choose Always Allow, as its README explains.</li>
      </ol>
      <p>
        You can also install it as a Claude Code plugin, which adds a skill that tells Claude when to use it: run{" "}
        <code>/plugin marketplace add sweetrb/apple-notes-mcp</code>, then <code>/plugin install apple-notes</code>.
      </p>

      <h2>Set it up in Claude Desktop</h2>
      <ol>
        <li>Install Node.js 20 or later.</li>
        <li>Open <code>claude_desktop_config.json</code> in <code>~/Library/Application Support/Claude/</code>. In Claude Desktop, Settings, then Developer, then Edit Config takes you there.</li>
        <li>Add the server and save:</li>
      </ol>
      <pre><code>{`{
  "mcpServers": {
    "apple-notes": {
      "command": "npx",
      "args": ["-y", "apple-notes-mcp"]
    }
  }
}`}</code></pre>
      <ol start={4}>
        <li>Quit Claude Desktop completely and open it again.</li>
        <li>Ask Claude about a note. When macOS asks for permission to control Notes, choose OK.</li>
      </ol>
      <p>
        If you want the tools that need Full Disk Access, the README says to grant it to the Node.js program that runs the server, not
        to Claude itself.
      </p>

      <h2>The limits they all share</h2>
      <ul>
        <li><strong>Mac only, and the Mac must be on.</strong> The server runs on your Mac, and the AI app has to run on the same Mac. If it&apos;s asleep or closed, nothing can reach your notes.</li>
        <li><strong>Not from ChatGPT, the web or your phone.</strong> ChatGPT, claude.ai and the Claude and ChatGPT apps on iPhone connect only to servers on the internet, so none of them can use a server on your Mac.</li>
        <li><strong>Permissions.</strong> macOS asks you to allow Automation for Notes. Servers that read the database also need Full Disk Access, which lets that program read far more than your notes.</li>
        <li><strong>Locked notes are out of reach.</strong> None of them can read or change a note locked with a password.</li>
        <li><strong>Attachments and checklists are partial.</strong> Only sweetrb&apos;s server handles attachments; the others work with note text. AppleScript can&apos;t make real checklists or tick an item, so even the best server can add checklist items through Shortcuts but can&apos;t check one off.</li>
        <li><strong>No undo for edits.</strong> Apple Notes keeps no version history, so if an AI rewrites a note badly, there&apos;s no earlier version to go back to.</li>
      </ul>

      <h2>If you want your notes from anywhere</h2>
      <p>
        If those limits are fine for you, use sweetrb&apos;s server. If you want to use your notes from ChatGPT, or from Claude on your
        phone, the notes have to live somewhere with a server on the internet. That&apos;s why I built Amber Notes: a free, open-source
        notes app for iPhone and Mac that works like Apple Notes and has an MCP server built in, at <code>{MCP_URL}</code>.
      </p>
      <ul>
        <li>It works from ChatGPT, Claude on the web, desktop and iPhone, Claude Code, Codex and Incredible, and your Mac doesn&apos;t need to be on.</li>
        <li>You approve each AI app in Amber Notes and choose Read Only, or Read and Edit.</li>
        <li>An AI can search, read, create and edit notes, tick checklist items, move and pin notes, and manage folders.</li>
        <li>When an AI changes a note, you see what changed, with Undo, and the previous version stays in the note&apos;s history.</li>
      </ul>
      <Figure shot={SHOTS.connectList} caption="Connect an AI in Amber Notes on a Mac: ChatGPT, Claude, Claude Code and Codex." />
      <p>
        You bring your Apple Notes over once, on your Mac, with their folders, checklists and tables. Locked notes and attachments stay
        in Apple Notes, and Apple Notes itself isn&apos;t changed. The catch is that you then write in Amber Notes instead of Apple
        Notes.{" "}
        {APP_STORE_LIVE
          ? "The Mac app is a free download and the iPhone app is on the App Store."
          : "The Mac app is out now; the iPhone app is coming soon to the App Store."}
      </p>
      <p>
        <a href="/blog/move-from-apple-notes">How to move from Apple Notes</a> walks through the import. The{" "}
        <a href="/blog/mcp-server">MCP server page</a> lists every tool, and{" "}
        <a href="/blog/notes-in-claude-code-and-codex">using your notes from Claude Code and Codex</a> covers the coding agents. For the
        other notes apps with a server of their own, see <a href="/blog/notes-apps-with-mcp">notes apps with an MCP server, compared</a>.
      </p>
    </PostPage>
  );
}
