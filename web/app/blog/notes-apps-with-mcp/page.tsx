import { Figure } from "@/lib/blog";
import { APP_STORE_LIVE } from "@/lib/site";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("notes-apps-with-mcp", {
  title: "Notes apps with an MCP server, compared (2026) · Pinto Notes",
});

type Row = { app: string; server: string; reach: string; edit: string; open: string };

// Checked against each app's own announcement or documentation on 30 September 2026.
const ROWS: Row[] = [
  { app: "Pinto Notes", server: "Built in, hosted", reach: "ChatGPT, Claude, Claude Code, Codex, Incredible and other MCP apps, from any device", edit: "Yes, with approval per app, Undo and version history", open: "Yes (MIT)" },
  { app: "Notion", server: "Official, hosted", reach: "Any app that supports remote MCP, from any device", edit: "Yes", open: "No" },
  { app: "Evernote", server: "Official, hosted (beta)", reach: "Any app that supports remote MCP, from any device", edit: "Read, search and create", open: "No" },
  { app: "Hjarni", server: "Built in, hosted", reach: "ChatGPT, Claude and other MCP apps, from any device", edit: "Yes", open: "No" },
  { app: "Bear", server: "Official, runs on your Mac (Bear 2.8)", reach: "Claude Desktop, Claude Code and other apps on the same Mac", edit: "Yes", open: "No" },
  { app: "Obsidian", server: "Community plugins", reach: "Apps on the same computer as your vault", edit: "Yes, depending on the plugin", open: "No (plugins often are)" },
  { app: "Apple Notes", server: "Anthropic's Read and Write Apple Notes extension for Claude Desktop, and community servers", reach: "Claude Desktop and Claude Code on your Mac", edit: "Yes, on that Mac: read, add and update (checklists become plain bullets)", open: "No" },
];

const FAQ = [
  { q: "What is an MCP server in a notes app?", a: [
    "MCP (Model Context Protocol) is an open standard for connecting AI apps to other apps. A notes app with an MCP server lets ChatGPT, Claude and similar apps search, read and, if you allow it, change your notes directly, without copy and paste.",
  ] },
  { q: "Why does hosted or local matter?", a: [
    "ChatGPT, claude.ai and the Claude and ChatGPT phone apps run in the cloud, so they can only reach a server on the internet. A server that runs on your Mac works with Claude Desktop or Claude Code on that Mac, and only while it's awake.",
  ] },
  { q: "Which of these notes apps can ChatGPT reach?", a: [
    "ChatGPT needs a hosted server. Of the apps here, that's Pinto Notes, Notion, Evernote and Hjarni. Adding one yourself needs Developer mode in ChatGPT, on a paid plan.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="notes-apps-with-mcp"
      intro={<>More notes apps now let ChatGPT and Claude use your notes. They differ in two ways that matter: whether it works away from your Mac, and what happens when the AI gets an edit wrong. I make Pinto Notes, so weigh this with that in mind; I&apos;ve described every app the way its maker does, and linked their own pages.</>}
      faq={FAQ}
    >

      <h2>At a glance</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">App</th><th scope="col">MCP server</th><th scope="col">Which AI apps, from where</th><th scope="col">Can the AI edit?</th><th scope="col">Open source</th></tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.app}><th scope="row">{r.app}</th><td>{r.server}</td><td>{r.reach}</td><td>{r.edit}</td><td>{r.open}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        If ChatGPT is the one you care about, <a href="/blog/notes-apps-that-work-with-chatgpt">notes apps that work with ChatGPT</a> compares
        the apps it can reach, including ones without MCP. For agents that write, see{" "}
        <a href="/blog/best-notes-app-for-ai-agents">the best notes app for AI agents</a>.
      </p>

      <h2>What to check before you pick one</h2>
      <ul>
        <li><strong>Hosted or on your Mac.</strong> If you want to use your notes from ChatGPT, claude.ai or your phone, you need a hosted server. A local one is fine if you only use Claude Desktop or Claude Code on one Mac.</li>
        <li><strong>What happens after a bad edit.</strong> An AI will sometimes change the wrong line. Look for version history, or at least an Undo, for changes the AI makes.</li>
        <li><strong>Who approves access.</strong> Signing in with OAuth and approving each app is safer than pasting an API key into a config file.</li>
        <li><strong>Whether you like writing in it.</strong> You&apos;ll spend more time writing notes than asking about them.</li>
      </ul>

      <Figure shot={SHOTS.history} caption="Version history in Pinto Notes: every change, with who made it, including ChatGPT and Claude Code." />

      <h2>The apps</h2>
      <p className="label"><strong>Pinto Notes</strong></p>
      <p>
        A free notes app for iPhone and Mac that works like Apple Notes, with an MCP server built in. You approve each AI app in Pinto
        Notes and choose Read Only, or Read and Edit. When an AI changes a note, you see what changed, with Undo, and every earlier
        version is kept. It <a href="/blog/move-from-apple-notes">imports Apple Notes on the Mac</a>. {APP_STORE_LIVE ? "It's on the Mac and the App Store." : "The Mac app is out now; the iPhone app is coming soon to the App Store."} The{" "}
        <a href="/blog/mcp-server">MCP server page</a> lists its tools, and{" "}
        connecting ChatGPT takes a few minutes.
      </p>
      <p className="label"><strong>Notion</strong></p>
      <p>
        Notion runs an official hosted MCP server with OAuth, so it works from any AI app that supports remote servers. A good fit if
        your notes already live in a Notion workspace. <a href="https://developers.notion.com/guides/mcp/overview" rel="noopener">Notion&apos;s MCP docs</a>.
      </p>
      <p className="label"><strong>Evernote</strong></p>
      <p>
        Evernote&apos;s hosted MCP server is in beta. Evernote says it lets AI apps read, search and create notes.{" "}
        <a href="https://evernote.com/mcp" rel="noopener">Evernote MCP</a>.
      </p>
      <p className="label"><strong>Hjarni</strong></p>
      <p>
        A notes app built around its MCP server, with apps for iPhone, Mac, Android and the web. ChatGPT and Claude can read and write.
        Its free plan holds 25 notes. <a href="https://hjarni.com/mcp-note-app" rel="noopener">Hjarni</a>.
      </p>
      <p className="label"><strong>Bear</strong></p>
      <p>
        Bear 2.8 added an official MCP server and a Claude connector. Both run on your Mac, so they work with Claude Desktop and Claude
        Code there, but not from your phone or the web. <a href="https://blog.bear.app/2026/04/bear-2-8-bearcli-claude-connector-and-mcp-server/" rel="noopener">Bear&apos;s announcement</a>.
      </p>
      <p className="label"><strong>Obsidian</strong></p>
      <p>
        Obsidian doesn&apos;t ship an MCP server of its own. Community plugins and servers give AI apps access to a vault on the same
        computer. Because a vault is a folder of markdown files, a plain file-system MCP server works too.{" "}
        <a href="/blog/obsidian-mcp">Obsidian MCP servers, compared</a>.
      </p>
      <p className="label"><strong>Apple Notes</strong></p>
      <p>
        Apple doesn&apos;t offer an API or an MCP server. On a Mac, Anthropic&apos;s Read and Write Apple Notes extension lets the Claude
        desktop app read, add and update notes, and community servers do the same through AppleScript, on that Mac only. <a href="/blog/apple-notes-mcp">Apple Notes MCP servers, compared</a>.
      </p>
    </PostPage>
  );
}
