import { Figure } from "@/lib/blog";
import { MCP_URL } from "@/lib/facts";
import { McpChooser } from "@/lib/McpChooser";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Capture, Keep, Steps } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";
import { APP_STORE_LIVE } from "@/lib/site";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-mcp");

type Row = { name: string; href: string; how: string; can: string; setup: string; clients: string; status: string };

// Checked against each project's README, GitHub page and npm on 8 October 2026; versions and dates again on 9 October.
const ROWS: Row[] = [
  {
    name: "sweetrb/apple-notes-mcp", href: "https://github.com/sweetrb/apple-notes-mcp",
    how: "AppleScript, plus Apple Shortcuts and read-only reads of the Notes database",
    can: "Search, read, create, update, move and delete notes; folders, tags, tables, pins, attachments; export to Markdown, HTML or JSON",
    setup: "One command in Claude Code; a plugin for Claude Code and Codex",
    clients: "Claude Code, Codex, the Claude desktop app and other MCP apps on the same Mac",
    status: "Maintained; version 2.14.3 on 8 October 2026; MIT",
  },
  {
    name: "RafalWilinski/mcp-apple-notes", href: "https://github.com/RafalWilinski/mcp-apple-notes",
    how: "JavaScript for Automation, plus a search index it builds on your Mac",
    can: "Search by meaning and by text, read, list and create notes",
    setup: "Clone it, install Bun, edit the Claude desktop config, then ask Claude to index your notes",
    clients: "The Claude desktop app",
    status: "Last changed December 2024; no license listed",
  },
  {
    name: "sirmews/apple-notes-mcp", href: "https://github.com/sirmews/apple-notes-mcp",
    how: "Reads the Notes database",
    can: "List, read and search notes; can't create or edit",
    setup: "Install with uvx, edit the Claude desktop config, grant Full Disk Access",
    clients: "The Claude desktop app",
    status: "Archived; last changed December 2024; MIT",
  },
  {
    name: "supermemoryai/apple-mcp", href: "https://github.com/supermemoryai/apple-mcp",
    how: "AppleScript; also covers Messages, Mail, Contacts, Reminders, Calendar and Maps",
    can: "Search, list and create notes",
    setup: "A one-click extension for the Claude desktop app, or an install command",
    clients: "The Claude desktop app, Cursor",
    status: "Archived; last changed August 2025; MIT",
  },
];

const CLAUDE_CODE = "claude mcp add apple-notes -s user -- npx -y apple-notes-mcp";
const CODEX = "codex plugin marketplace add sweetrb/apple-notes-mcp\ncodex plugin add apple-notes@apple-notes-mcp";
const DESKTOP = `{
  "mcpServers": {
    "apple-notes": {
      "command": "npx",
      "args": ["-y", "apple-notes-mcp"]
    }
  }
}`;

const FAQ = [
  { q: "Is there an official Apple Notes MCP server?", a: [
    "No. Apple doesn't make one, and Apple Notes has no public API. Every Apple Notes MCP server is a community project that runs on your Mac and reaches your notes through the Notes app or its database.",
  ] },
  { q: "Which Apple Notes MCP server is the best?", a: [
    "In October 2026, sweetrb/apple-notes-mcp. Of the four compared here it's the only one still maintained, and the only one that can edit, move, organize and export notes.",
  ] },
  { q: "Is there an MCP server for iCloud notes or for Notes on iPhone?", a: [
    "No. Apple offers no way for another service to reach your notes in iCloud, and nothing can run an MCP server inside Notes on iPhone. A server on your Mac sees your iCloud notes only because they sync to the Notes app there.",
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
      intro={<>You want Claude or another AI to read and write your Apple Notes. Here&apos;s which MCP server to use, the commands to set it up, and where none of them can reach.</>}
      answer={
        <Answer jump={[
          { href: "#which-works", label: "Which works for you" },
          { href: "#compared", label: "The servers" },
          { href: "#set-it-up", label: "Set it up" },
          { href: "#iphone-and-icloud", label: "iPhone and iCloud" },
        ]}>
          <p>
            Apple doesn&apos;t make an MCP server for Notes, so every one is a community project on your Mac. Use
            sweetrb/apple-notes-mcp: it&apos;s maintained, it can edit, and in Claude Code it&apos;s one command. It works with Claude
            Code, Codex and the Claude desktop app on that Mac, never with ChatGPT, claude.ai or anything on your iPhone.
          </p>
        </Answer>
      }
      hero={<Capture priority src="/blog/macos27/notes-automation-prompt-window" width={1538} height={984} maxWidth={760}
        phone={{ src: "/blog/macos27/notes-automation-prompt", width: 520, height: 507 }}
        alt="Apple Notes on macOS 27 with the macOS prompt in front of it: “Terminal” wants access to control “Notes”. Allowing control will provide access to documents and data in “Notes”, and to perform actions within that app. Buttons: Don’t Allow and Allow."
        caption="macOS 27, the first time a program on the Mac asks to control Notes. Here it's Terminal, where Claude Code runs; in the Claude app it names Claude." />}
      faq={FAQ}
    >
      <h2 id="which-works">Which one works where you use AI</h2>
      <p>One question, and it tells you what to set up.</p>
      <McpChooser />

      <h2 id="what-it-is">What an Apple Notes MCP server is</h2>
      <p>
        MCP (Model Context Protocol) is an open standard for connecting AI apps to other apps. An MCP server gives an AI tools such as
        &ldquo;search notes&rdquo; or &ldquo;create a note&rdquo;, and the AI calls them when you ask. Apple Notes has no public API
        (<a href="/blog/apple-notes-api">what exists instead</a>), so each server gets to your notes on your Mac in one of two ways:
      </p>
      <ul>
        <li><strong>Through the Notes app</strong>, with AppleScript or JavaScript for Automation. This can read and write, and macOS asks you to allow it, as in the picture above.</li>
        <li><strong>By reading the Notes database.</strong> This is read only, and needs Full Disk Access.</li>
      </ul>

      <h2 id="compared">The servers compared</h2>
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
      <ul>
        <li>
          <strong>sweetrb/apple-notes-mcp</strong> is the one to use. It has the most tools by far, ships updates every few days, and
          is careful with your notes: an edit is checked against the version the AI read, so it won&apos;t overwrite a change made since,
          and deleted notes go to Recently Deleted.
        </li>
        <li>
          <strong>RafalWilinski/mcp-apple-notes</strong> has one interesting idea, search by meaning, from an index it builds on your Mac.
          It can&apos;t edit or organize notes, and hasn&apos;t changed since December 2024.
        </li>
        <li>
          <strong>sirmews/apple-notes-mcp</strong> is read only and archived. Its Python package has the same name as sweetrb&apos;s Node.js
          one, so <code>uvx apple-notes-mcp</code> and <code>npx apple-notes-mcp</code> install two different projects.
        </li>
        <li>
          <strong>supermemoryai/apple-mcp</strong> covers many of Apple&apos;s apps, with Notes as one tool among them. It can create notes but
          not edit them, and it&apos;s archived.
        </li>
      </ul>

      <h2 id="set-it-up">Set it up</h2>
      <p>
        You need a Mac with Node.js 20 or later and at least one account in the Notes app. The commands are from sweetrb&apos;s{" "}
        <a href="https://github.com/sweetrb/apple-notes-mcp#quick-start" rel="noopener">README</a>.
      </p>
      <Keep title="Claude Code" text={CLAUDE_CODE} code
        note={<>Or install it as a Claude Code plugin, which adds a skill telling Claude when to use it: <code>/plugin marketplace add sweetrb/apple-notes-mcp</code>, then <code>/plugin install apple-notes</code>.</>} />
      <Keep title="Codex" text={CODEX} code note="Installs the same server as a Codex plugin, with the same skill." />
      <Keep title="The Claude desktop app" text={DESKTOP} code
        note={<>Paste it into <code>claude_desktop_config.json</code>. In the Claude app, Settings, Developer, Edit Config opens the folder. Quit Claude completely and open it again.</>} />
      <p>Then:</p>
      <Steps>
        <li>Ask for a note. The first time, macOS asks whether the app may control Notes. Choose Allow.</li>
        <li>
          For checklists, tags, tables and pins, run <code>npx -y apple-notes-mcp setup</code> and add the Shortcuts it opens. Open each
          one once in the Shortcuts app and choose Always Allow; the server can&apos;t ask for that in the background.
        </li>
        <li>Optional: give Full Disk Access to the app the server runs in (your terminal, or Node.js for the Claude app) for queries across your library and checklist state.</li>
      </Steps>
      <p>
        In the Claude desktop app there&apos;s a simpler option with fewer tools: Anthropic&apos;s own Read and Write Apple Notes
        extension, from Claude&apos;s connectors directory. <a href="/blog/claude-and-apple-notes">Can Claude read your Apple Notes?</a>{" "}
        compares the two.
      </p>

      <h2 id="iphone-and-icloud">iPhone, iCloud and ChatGPT</h2>
      <p>
        People search for an &ldquo;iCloud notes MCP&rdquo; or an &ldquo;iOS notes MCP&rdquo;. There isn&apos;t one, and there can&apos;t
        be one yet: Apple offers no way for another service to reach your notes in iCloud, and nothing can add tools to Notes on iPhone.
        The servers above see your iCloud notes only because they sync to the Notes app on your Mac.
      </p>
      <p>
        ChatGPT, claude.ai and the Claude and ChatGPT apps on iPhone run in the cloud and connect only to servers on the internet. A
        server on your Mac is out of their reach unless you open it to the internet through a tunnel, which also exposes your notes.
      </p>

      <h2 id="limits">The limits they all share</h2>
      <ul>
        <li><strong>The Mac has to be on.</strong> If it&apos;s asleep or closed, nothing can reach your notes.</li>
        <li><strong>Permissions.</strong> macOS asks you to allow control of Notes. Servers that read the database also need Full Disk Access, which lets that program read far more than your notes.</li>
        <li><strong>Locked notes are out of reach.</strong> None of them can read or change a note locked with a password.</li>
        <li><strong>Checklists are partial.</strong> AppleScript can&apos;t make a real checklist or tick an item. sweetrb&apos;s server adds checklist items through Shortcuts, but no server can check one off.</li>
        <li><strong>No undo for edits.</strong> Apple Notes keeps no version history, so if an AI rewrites a note badly, there&apos;s no earlier version to go back to.</li>
      </ul>

      <h2 id="amber-notes">If you want your notes from anywhere</h2>
      <p>
        If those limits are fine for you, use sweetrb&apos;s server. If you want your notes in ChatGPT, or in Claude on your phone, they
        have to live somewhere with a server on the internet. That&apos;s why I built Pinto Notes: a free, open-source notes app for iPhone
        and Mac that works like Apple Notes, with an MCP server built in at <code>{MCP_URL}</code>.
      </p>
      <ul>
        <li>It works from ChatGPT, Claude on the web, desktop and iPhone, Claude Code, Codex and Incredible, and your Mac doesn&apos;t need to be on.</li>
        <li>You approve each AI app in Pinto Notes and choose Read Only, or Read and Edit.</li>
        <li>An AI can tick checklist items. When it changes a note, you see what changed, with Undo, and the earlier version stays in the note&apos;s history.</li>
      </ul>
      <Figure shot={SHOTS.connectList} caption="Connect an AI in Pinto Notes on a Mac: ChatGPT, Claude, Claude Code and Codex." />
      <p>
        You bring your Apple Notes over once, on your Mac, with their folders, checklists and tables; <a href="/blog/move-from-apple-notes">how
        to move from Apple Notes</a> walks through it. Locked notes and attachments stay in Apple Notes, and Apple Notes isn&apos;t changed.
        The catch is that you then write in Pinto Notes instead.{" "}
        {APP_STORE_LIVE
          ? "The Mac app is a free download and the iPhone app is on the App Store."
          : "The Mac app is out now; the iPhone app is coming soon to the App Store."}
      </p>
      <PostCta slug="apple-notes-mcp" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>Your notes in ChatGPT and Claude, on any device, with every change marked and undoable.</p>
      </PostCta>
    </PostPage>
  );
}
