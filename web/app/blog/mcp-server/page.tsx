import { Figure } from "@/lib/blog";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";
import { CLAUDE_DIRECTORY_URL, MCP_URL, OLD_MCP_URL_STAYS } from "@/lib/facts";
import { MCP_TOOLS, type McpTool } from "@/lib/mcp-tools";
import { AGENT_INSTALLS } from "@/lib/agent-installs";

export const dynamic = "force-static";
export const metadata = postMetadata("mcp-server", { title: "Pinto Notes MCP server: address, sign-in and tools" });

const KIND: Record<McpTool["kind"], string> = { read: "reads", write: "changes", destructive: "changes; can remove or replace" };

export default function Page() {
  return (
    <PostPage
      slug="mcp-server"
      intro={<>Pinto Notes, the notes app for iPhone and Mac, has a remote MCP server built in. This page is for developers and anyone curious how it works: the address, how an AI app signs in and gets approved, and every tool it can call.</>}
    >
      <h2>The address</h2>
      <pre><code>{MCP_URL}</code></pre>
      <p>{OLD_MCP_URL_STAYS}</p>
      <ul>
        <li>Transport: MCP Streamable HTTP, answering with JSON. There is no server-sent stream; clients post each request.</li>
        <li>Protocol versions: 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05.</li>
        <li>Server name: <code>amber-notes</code>. It sends instructions on <code>initialize</code> that tell the model how the notes are laid out.</li>
      </ul>

      <h2>How access works</h2>
      <p>There are two ways in. Both need a Pinto Notes account, and both are approved by the person.</p>
      <p className="label"><strong>Sign in with OAuth (ChatGPT, Claude and other apps)</strong></p>
      <ol>
        <li>An unauthenticated request gets a 401 with a <code>WWW-Authenticate</code> header pointing to the protected resource metadata, at the address above plus <code>/.well-known/oauth-protected-resource</code>.</li>
        <li>The client registers itself (dynamic client registration) and starts OAuth 2.1 with PKCE (S256). Scopes are <code>notes:read</code> and <code>notes:write</code>.</li>
        <li>The authorization server metadata is at the address above plus <code>/.well-known/oauth-authorization-server</code>.</li>
        <li>
          The authorization step opens <code>pintonotes.com/connect</code>. The person signs in there (email and password, or Sign in
          with Apple), and the page shows a two-digit number. Pinto Notes on their iPhone or Mac asks &ldquo;Allow [app] to use your
          notes?&rdquo; and where access goes; they type the number, choose Read and Edit or Read Only, then Allow. With no device
          nearby, they can approve on the page with their recovery key.
        </li>
        <li>The client gets an access token (valid for an hour) and a refresh token. The tokens only open this server.</li>
      </ol>
      <p className="label"><strong>Access token (Claude Code, Codex and scripts)</strong></p>
      <p>
        In Pinto Notes, Settings, Connect an AI, Claude Code or Codex creates a token starting with <code>pane_</code>, read only or read
        and edit. Send it as <code>Authorization: Bearer pane_…</code>. The <a href="/blog/notes-in-claude-code-and-codex">Claude Code
        and Codex guide</a> has the exact setup.
      </p>
      <Figure shot={SHOTS.connectList} caption="Settings, Connect an AI: guided setup for each app, and everything that's connected." />
      <p>
        Every connection shows up in Pinto Notes under Connected, and the person can disconnect it at any time. Each tool call runs as
        that person, with row-level security, so a token can only ever reach its owner&apos;s notes. Calls are rate limited per account.
      </p>
      <p>
        Notes are end-to-end encrypted, so the server can&apos;t read them at rest. Approving a connection gives it a copy of the
        notes&apos; key, locked with a secret derived from its own token. During each request the server unlocks the key in memory,
        decrypts what the call needs, and drops it when the request ends; disconnecting deletes that copy. Locked notes stay out of
        reach, since their key comes from the notes password. <a href="/blog/encrypted-notes-app-for-ai">An encrypted notes app that
        ChatGPT and Claude can use</a> explains the trade-off.
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

      <h2 id="install">Install in your AI tool</h2>
      <p>
        Each of these adds the address above. The first time the tool connects, your browser opens pintonotes.com/connect: sign in
        there, then approve on your iPhone or Mac by typing the number the page shows, and choose Read and Edit or Read Only. You need the free app and an
        account.
      </p>
      {AGENT_INSTALLS.map((x) => (
        <section key={x.tool} aria-label={x.tool}>
          <p className="label"><strong>{x.tool}</strong></p>
          {x.code && <pre><code>{x.code}</code></pre>}
          {x.steps && <ol>{x.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
          <p>{x.signIn}</p>
          {x.alt && <><p>{x.alt.text}</p><pre><code>{x.alt.code}</code></pre></>}
        </section>
      ))}
      <p className="label"><strong>With a token instead of signing in</strong></p>
      <p>
        Any of these tools can use an access token instead. In Pinto Notes, open Settings, Connect an AI, Codex, and choose Create
        Access Token. The token works in any MCP client; send it as an <code>Authorization: Bearer pane_…</code> header, the way the{" "}
        <a href="/blog/notes-in-claude-code-and-codex">Claude Code and Codex guide</a> shows. It&apos;s shown once, so keep it private.
      </p>

      <h2>Connect it</h2>
      <ul>
        <li>Claude: <a href={CLAUDE_DIRECTORY_URL} rel="noopener">Amber Notes in Claude&apos;s connector directory</a>, then Connect to Claude.</li>
        <li><a href="/blog/connect-chatgpt-to-your-notes">Connect ChatGPT or Claude to your notes</a>: add the address as a custom app in ChatGPT, or as a custom connector in an older Claude app.</li>
        <li><a href="/blog/notes-in-claude-code-and-codex">Use your notes from Claude Code and Codex</a>: one command, or a few lines of config.</li>
        <li><a href="#install">Gemini CLI, VS Code and Incredible</a>: the steps for each are above.</li>
        <li>Anything else that speaks MCP: add the address and sign in when it asks.</li>
      </ul>
      <p>
        Choosing a notes app for an agent? <a href="/blog/best-notes-app-for-ai-agents">The best notes app for AI agents</a> sets out the
        criteria. Coming from Apple Notes? <a href="/blog/apple-notes-mcp">Apple Notes MCP servers compared</a> covers the local servers
        for Notes on a Mac, and how they differ from this one. <a href="/blog/obsidian-mcp">Obsidian MCP servers compared</a> does the
        same for Obsidian vaults.
      </p>
      <p>
        The server is open source. Read it in <a href="https://github.com/pinto-notes/pinto-notes/tree/main/supabase/functions/mcp" rel="noopener">supabase/functions/mcp</a> on GitHub.
      </p>
    </PostPage>
  );
}
