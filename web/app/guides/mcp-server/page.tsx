import { GuidePage, guideMetadata } from "@/lib/GuidePage";
import { MCP_URL } from "@/lib/facts";
import { MCP_TOOLS, type McpTool } from "@/lib/mcp-tools";

export const dynamic = "force-static";
export const metadata = guideMetadata("mcp-server", { title: "Amber Notes MCP server: address, sign-in and tools" });

const KIND: Record<McpTool["kind"], string> = { read: "reads", write: "changes", destructive: "changes; can remove or replace" };

export default function Page() {
  return (
    <GuidePage
      slug="mcp-server"
      lede="Amber Notes, the notes app for iPhone and Mac, has a remote MCP server built in. Here's the address, how an AI app gets access, and every tool it can call."
    >
      <h2>The address</h2>
      <pre><code>{MCP_URL}</code></pre>
      <ul>
        <li>Transport: MCP Streamable HTTP, answering with JSON. There is no server-sent stream; clients post each request.</li>
        <li>Protocol versions: 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05.</li>
        <li>Server name: <code>amber-notes</code>. It sends instructions on <code>initialize</code> that tell the model how the notes are laid out.</li>
      </ul>

      <h2>How access works</h2>
      <p>There are two ways in. Both need an Amber Notes account, and both are approved by the person in the app.</p>
      <p className="label"><strong>Sign in with OAuth (ChatGPT, Claude and other apps)</strong></p>
      <ol>
        <li>An unauthenticated request gets a 401 with a <code>WWW-Authenticate</code> header pointing to the protected resource metadata, at the address above plus <code>/.well-known/oauth-protected-resource</code>.</li>
        <li>The client registers itself (dynamic client registration) and starts OAuth 2.1 with PKCE (S256). Scopes are <code>notes:read</code> and <code>notes:write</code>.</li>
        <li>The authorization step opens Amber Notes, which asks the person &ldquo;Allow [app] to use your notes?&rdquo; and shows where access goes. They choose Read and Edit, or Read Only, then Allow.</li>
        <li>The client gets an access token (valid for an hour) and a refresh token. The tokens only open this server.</li>
      </ol>
      <p className="label"><strong>Access token (Claude Code, Codex and scripts)</strong></p>
      <p>
        In Amber Notes, Settings, Connect an AI, Claude Code or Codex creates a token starting with <code>pane_</code>, read only or read
        and edit. Send it as <code>Authorization: Bearer pane_…</code>. The <a href="/guides/notes-in-claude-code-and-codex">Claude Code
        and Codex guide</a> has the exact setup.
      </p>
      <p>
        Every connection shows up in Amber Notes under Connected, and the person can disconnect it at any time. Each tool call runs as
        that person, with row-level security, so a token can only ever reach its owner&apos;s notes. Calls are rate limited per account.
      </p>

      <h2>What happens to changes</h2>
      <ul>
        <li>Every edit keeps the previous version. <code>note_history</code> lists them and <code>restore_revision</code> puts one back.</li>
        <li>In the app, the person sees what an AI changed, with Undo.</li>
        <li>Deleted notes go to Recently Deleted for 30 days and can be restored with <code>restore_note</code>.</li>
        <li>A read-only connection only sees the tools marked reads below.</li>
      </ul>

      <h2>Tools</h2>
      <p>
        Notes are markdown, and the first line is the title. Checklists are <code>- [ ]</code> lines, and tables are markdown tables.
        Start with <code>get_overview</code> or <code>search_notes</code>, and read a note before editing it.
      </p>
      <ul>
        {MCP_TOOLS.map((t) => (
          <li key={t.name}><code>{t.name}</code> ({KIND[t.kind]}). {t.description}</li>
        ))}
      </ul>
      <p>
        <code>search</code> and <code>fetch</code> follow the shape ChatGPT expects for searching and reading. Every tool carries MCP
        annotations (<code>readOnlyHint</code>, and <code>destructiveHint</code> where it applies), so clients can ask before a change.
      </p>

      <h2>Connect it</h2>
      <ul>
        <li><a href="/guides/connect-chatgpt-to-your-notes">ChatGPT and Claude</a>: add the address as a custom app or connector.</li>
        <li><a href="/guides/notes-in-claude-code-and-codex">Claude Code and Codex</a>: one command, or a few lines of config.</li>
        <li>Anything else that speaks MCP: add the address and sign in when it asks.</li>
      </ul>
      <p>
        The server is open source. Read it in <a href="https://github.com/emilwagman/amber-notes/tree/main/supabase/functions/mcp" rel="noopener">supabase/functions/mcp</a> on GitHub.
      </p>
    </GuidePage>
  );
}
