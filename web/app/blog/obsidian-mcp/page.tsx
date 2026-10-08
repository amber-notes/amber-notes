import { Figure } from "@/lib/blog";
import { MCP_URL } from "@/lib/facts";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";
import { APP_STORE_LIVE } from "@/lib/site";

export const dynamic = "force-static";
export const metadata = postMetadata("obsidian-mcp");

type Row = { name: string; href: string; how: string; can: string; setup: string; clients: string; status: string };

// Checked against each project's README, releases and GitHub page on 30 September 2026.
const ROWS: Row[] = [
  {
    name: "Local REST API with MCP", href: "https://github.com/coddingtonbear/obsidian-local-rest-api",
    how: "An Obsidian plugin with an MCP server built in, since version 4.0 in May 2026",
    can: "Read, write, append, move, copy and delete notes; edit one heading, block or frontmatter field; search; list tags; read attachments and images; run Obsidian commands",
    setup: "Install the plugin in Obsidian, copy its API key, add the address to your AI app",
    clients: "Claude Code, Cursor and other apps that connect to a local HTTP server; Claude Desktop through mcp-remote",
    status: "Maintained; version 5.3.1 on 28 September 2026; MIT",
  },
  {
    name: "MarkusPfundstein/mcp-obsidian", href: "https://github.com/MarkusPfundstein/mcp-obsidian",
    how: "A Python server that talks to the Local REST API plugin",
    can: "List, read, search and write notes; append; edit one heading, block or frontmatter field; daily notes and recent changes; delete",
    setup: "Install the plugin, then add uvx mcp-obsidian with the API key to your AI app's config",
    clients: "Claude Desktop and other apps that run local servers",
    status: "Maintained; last changed 31 August 2026; MIT; the most starred, about 4,400 stars",
  },
  {
    name: "cyanheads/obsidian-mcp-server", href: "https://github.com/cyanheads/obsidian-mcp-server",
    how: "A Node.js server that talks to the Local REST API plugin",
    can: "Read, write, search and replace in notes; edit sections, frontmatter and tags; delete after you confirm; can limit the AI to some folders",
    setup: "Install the plugin, then a one-click bundle for Claude Desktop, or npx with the API key",
    clients: "Claude Desktop, Cursor, VS Code and other apps that run local servers",
    status: "Maintained; version 3.6.0 on 23 September 2026; Apache 2.0",
  },
  {
    name: "bitbonsai/mcpvault", href: "https://github.com/bitbonsai/mcpvault",
    how: "Reads and writes the vault's files directly; no plugin, and Obsidian doesn't need to be open",
    can: "Read, write, edit, move and delete notes; search; frontmatter and tags; resolve wiki links",
    setup: "npx with the path to your vault, in your AI app's config",
    clients: "Claude Desktop, Claude Code, Codex, Gemini CLI, Cursor and other apps that run local servers",
    status: "Maintained; version 0.16.0 on 17 August 2026; MIT",
  },
  {
    name: "StevenStavrakis/obsidian-mcp", href: "https://github.com/StevenStavrakis/obsidian-mcp",
    how: "Reads and writes the vault's files directly; Obsidian doesn't need to be open",
    can: "Read, create, edit, move and delete notes, updating links when a note moves; search; add, remove and rename tags; up to ten vaults",
    setup: "npx with a name and path for each vault; needs Node.js 22",
    clients: "Apps that run local servers, such as Claude Desktop and Claude Code",
    status: "Maintained; version 2.0 on 14 August 2026; MIT",
  },
  {
    name: "Semantic Notes Vault MCP", href: "https://github.com/aaronsb/obsidian-mcp-plugin",
    how: "An Obsidian plugin that runs its own MCP server, with Dataview and Bases support",
    can: "Read, create, search, move, split and combine notes; follow links between notes; query with Dataview and Bases",
    setup: "Install the plugin in Obsidian, then a one-click bundle for Claude Desktop or one command for Claude Code",
    clients: "Claude Desktop, Claude Code, Cline and other MCP apps",
    status: "Maintained; version 0.12.9 on 16 September 2026; MIT",
  },
  {
    name: "jacksteamdev/obsidian-mcp-tools", href: "https://github.com/jacksteamdev/obsidian-mcp-tools",
    how: "An Obsidian plugin plus a local server, on top of the Local REST API plugin",
    can: "Read notes, semantic search, run Templater templates",
    setup: "Install the plugin; it installs its server",
    clients: "Claude Desktop",
    status: "Archived; last release in May 2026; MIT",
  },
];

const FAQ = [
  { q: "Is there an official Obsidian MCP server?", a: [
    "No. Obsidian doesn't make one. The closest official piece is Obsidian CLI, which since Obsidian 1.12 lets you control the app from the terminal, so Claude Code can run its commands. Every Obsidian MCP server is a community plugin or program that runs on the computer with your vault.",
  ] },
  { q: "Which Obsidian MCP server is the best?", a: [
    "In September 2026, the Local REST API with MCP plugin, if you're happy to keep Obsidian open. It has the server built in, had three releases in September, and can edit one section of a note without touching the rest. If you'd rather not run a plugin, bitbonsai/mcpvault works on the vault's files with Obsidian closed.",
  ] },
  { q: "Can ChatGPT use an Obsidian MCP server?", a: [
    "Not directly. ChatGPT connects to MCP servers on the internet, and these servers run on your computer. The same goes for claude.ai and the Claude and ChatGPT apps on iPhone. You'd have to expose the server to the internet yourself, with a tunnel and sign-in in front of it.",
  ] },
  { q: "Does Obsidian need to be open?", a: [
    "For the plugins, yes: the Local REST API and Semantic Notes Vault servers run inside Obsidian on your desktop. Servers that work on the files, such as mcpvault and StevenStavrakis/obsidian-mcp, don't need Obsidian open, but the computer with the vault still has to be on.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="obsidian-mcp"
      intro={<>Search for an Obsidian MCP server and you get a long list of GitHub projects. I went through the main ones in September 2026 and checked each against its own README and release history. Here&apos;s how they work, what each can do, how to set up the best one in Claude, and the limits they share. I make Pinto Notes, a different notes app, so weigh that part with that in mind.</>}
      faq={FAQ}
    >
      <h2>How Obsidian works with AI</h2>
      <p>
        An Obsidian vault is a folder of Markdown files on your computer. That&apos;s what makes Obsidian great for local-first power
        users: the notes are plain files you own, any tool can read them, and plugins can add almost anything. It also means an AI app
        can reach your notes in two ways.
      </p>
      <ul>
        <li><strong>Through Obsidian</strong>, with a plugin. The plugin runs inside the Obsidian desktop app, so it knows about links, tags and frontmatter, and can run Obsidian commands. Obsidian has to be open.</li>
        <li><strong>Through the files</strong>, with a server that reads and writes the Markdown in your vault folder. Obsidian can be closed, but the server doesn&apos;t see what Obsidian knows about the vault.</li>
      </ul>
      <p>
        MCP (Model Context Protocol) is the open standard that connects the two sides: a server gives an AI app tools such as
        &ldquo;search notes&rdquo; or &ldquo;edit a note&rdquo;, and the AI calls them when you ask. Obsidian doesn&apos;t make an MCP
        server. The nearest official thing is <a href="https://help.obsidian.md/cli" rel="noopener">Obsidian CLI</a>, added in
        Obsidian 1.12, which lets you control the app from the terminal. A coding agent like Claude Code can run those commands, but
        ChatGPT and Claude on the web or your phone can&apos;t.
      </p>
      <p>
        One change in 2026 matters most. The Local REST API plugin, which most Obsidian MCP servers were built on, got an MCP server of
        its own in version 4.0 in May. Its README now says the separate servers are no longer necessary.
      </p>

      <h2>The servers compared</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">Server</th><th scope="col">How it reaches the vault</th><th scope="col">What the AI can do</th><th scope="col">Setup</th><th scope="col">AI apps</th><th scope="col">Status</th></tr>
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

      <p className="label"><strong>Local REST API with MCP</strong></p>
      <p>
        The one to use today if you keep Obsidian open. It&apos;s by the author of the Local REST API plugin, and the MCP server is part
        of the plugin, so there&apos;s nothing else to install. Its best trick is editing one part of a note: the AI can append under a
        heading, replace a block or change a frontmatter field, and the rest of the file stays as it was. Deleted notes go to the trash.
        By default it listens only on your own computer, over HTTPS with a certificate it makes, behind an API key.
      </p>
      <p className="label"><strong>MarkusPfundstein/mcp-obsidian</strong></p>
      <p>
        The most popular Obsidian MCP server on GitHub, and the one most older guides use. It&apos;s a small Python server in front of the
        Local REST API plugin. It still works and still gets fixes, but the plugin now does much the same job on its own, so there&apos;s less reason to add it.
      </p>
      <p className="label"><strong>cyanheads/obsidian-mcp-server</strong></p>
      <p>
        Also built on the Local REST API plugin, with more careful tools: it won&apos;t overwrite a whole note unless asked, reports the
        size of the file before and after each write, asks you before a delete, and can limit what the AI reads and writes to certain
        folders. It can also search with the Omnisearch plugin when you have it.
      </p>
      <p className="label"><strong>bitbonsai/mcpvault</strong></p>
      <p>
        The best choice if you&apos;d rather not run a plugin. It works on the files in your vault, keeps the AI inside that folder,
        skips <code>.obsidian</code> and <code>.git</code>, and asks the AI to repeat the path before deleting a note or moving a file. Obsidian can be
        closed.
      </p>
      <p className="label"><strong>StevenStavrakis/obsidian-mcp</strong></p>
      <p>
        Another file-based server, whose version 2 came out in August 2026. Every change is written in one step and rolled back if it
        fails, and moving a note updates the links to it where they&apos;re unambiguous. It can serve up to ten vaults at once.
      </p>
      <p className="label"><strong>Semantic Notes Vault MCP</strong></p>
      <p>
        A plugin from the Obsidian community directory that runs its own MCP server inside Obsidian, without the Local REST API. It
        leans into how Obsidian users organize: it can follow links between notes and query with Dataview and Bases.
      </p>
      <p className="label"><strong>jacksteamdev/obsidian-mcp-tools</strong></p>
      <p>
        Once the most installed MCP plugin for Obsidian, with semantic search and Templater support. Its author archived it in May
        2026, so it gets no more fixes. If you use it, move to one of the above.
      </p>

      <h2>Set it up in Claude Code</h2>
      <ol>
        <li>In Obsidian, open Settings, then Community plugins, then Browse. Search for Local REST API with MCP, install it and turn it on.</li>
        <li>Open Settings, then Local REST API, and copy the API key.</li>
        <li>Run this, with your key in place of <code>&lt;your-api-key&gt;</code>:</li>
      </ol>
      <pre><code>{`claude mcp add --transport http --scope user obsidian https://127.0.0.1:27124/mcp/ \\
  --header "Authorization: Bearer <your-api-key>"`}</code></pre>
      <ol start={4}>
        <li>Start Claude Code, with Obsidian open, and ask it to find a note.</li>
      </ol>
      <p>
        If the connection fails with a certificate error, the plugin&apos;s README gives two ways out: trust the certificate it serves at{" "}
        <code>https://127.0.0.1:27124/obsidian-local-rest-api.crt</code>, or turn on Enable HTTP server in its settings and use{" "}
        <code>http://127.0.0.1:27123/mcp/</code> instead.
      </p>

      <h2>Set it up in Claude Desktop</h2>
      <p>
        Claude Desktop runs local servers from its config file, so it reaches the plugin through a small bridge called mcp-remote. You need
        Node.js.
      </p>
      <ol>
        <li>Install and turn on the plugin, and copy its API key, as above.</li>
        <li>Open <code>claude_desktop_config.json</code>. In Claude Desktop, Settings, then Developer, then Edit Config takes you there.</li>
        <li>Add the server, with your key, and save:</li>
      </ol>
      <pre><code>{`{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "mcp-remote@latest",
        "https://127.0.0.1:27124/mcp/",
        "--header",
        "Authorization: Bearer <your-api-key>"
      ]
    }
  }
}`}</code></pre>
      <ol start={4}>
        <li>Quit Claude Desktop completely and open it again.</li>
        <li>With Obsidian open, ask Claude about a note.</li>
      </ol>
      <p>
        The certificate fixes above apply here too. If you&apos;d rather not keep Obsidian open, use mcpvault instead: its README has a
        three-line config for Claude Desktop that takes the path to your vault.
      </p>

      <h2>The limits they all share</h2>
      <ul>
        <li><strong>The computer with the vault must be on.</strong> Every one of these runs on that computer, and the AI app has to run there too. If it&apos;s asleep or shut, nothing can reach your notes. The plugins also need Obsidian open.</li>
        <li><strong>Not from ChatGPT, the web or your phone.</strong> ChatGPT, claude.ai and the Claude and ChatGPT apps on iPhone connect only to servers on the internet. Getting there means putting the server online yourself, through a tunnel with sign-in in front of it, and keeping it running.</li>
        <li><strong>Nothing runs on the phone.</strong> Obsidian on iPhone can hold your vault, but the plugins that serve MCP are desktop only.</li>
        <li><strong>The AI gets broad access.</strong> An API key or a folder path usually means the whole vault. cyanheads&apos; server can limit it to some folders; most can&apos;t.</li>
        <li><strong>Undo depends on your setup.</strong> Obsidian&apos;s File recovery and Obsidian Sync keep earlier versions, and a vault in Git has its history. Without one of those, a bad rewrite by an AI is hard to take back.</li>
      </ul>

      <h2>If you want your notes from anywhere</h2>
      <p>
        If those limits are fine, and for many Obsidian users they are, use the Local REST API plugin or mcpvault and keep your vault.
        Obsidian is great at what it does: plain files, links, plugins, and every platform.
      </p>
      <p>
        If you want ChatGPT, or Claude on your phone, to use your notes without a computer left on, the notes have to live somewhere with
        a server on the internet. That&apos;s why I built Pinto Notes: a free, open-source notes app for iPhone and Mac with an MCP server
        built in, at <code>{MCP_URL}</code>. It&apos;s a different app, not an Obsidian plugin.
      </p>
      <ul>
        <li>It works from ChatGPT, Claude on the web, desktop and iPhone, Claude Code, Codex and Incredible, and your Mac doesn&apos;t need to be on.</li>
        <li>You approve each AI app in Pinto Notes and choose Read Only, or Read and Edit.</li>
        <li>An AI can search, read, create and edit notes, tick checklist items, move and pin notes, and manage folders.</li>
        <li>When an AI changes a note, you see what changed, with Undo, and the previous version stays in the note&apos;s history.</li>
      </ul>
      <Figure shot={SHOTS.connectList} caption="Connect an AI in Pinto Notes on a Mac: ChatGPT, Claude, Claude Code and Codex." />
      <p>
        Be clear about the trade. Notes are stored as Markdown, but in Pinto Notes&apos; sync, not as a folder of files on your disk.
        There are no plugins, it runs only on iPhone and Mac, and there&apos;s no import from Obsidian today.{" "}
        {APP_STORE_LIVE
          ? "The Mac app is a free download and the iPhone app is on the App Store."
          : "The Mac app is out now; the iPhone app is coming soon to the App Store."}
      </p>
      <p>
        <a href="/blog/apple-notes-vs-obsidian">Apple Notes vs Obsidian</a> compares Obsidian with the simplest option. The{" "}
        <a href="/blog/mcp-server">MCP server page</a> lists every Pinto Notes tool. For other notes apps with a server of their own, see{" "}
        <a href="/blog/notes-apps-with-mcp">notes apps with an MCP server, compared</a>, and for the same question about Apple&apos;s
        app, <a href="/blog/apple-notes-mcp">Apple Notes MCP servers compared</a>.
      </p>
    </PostPage>
  );
}
