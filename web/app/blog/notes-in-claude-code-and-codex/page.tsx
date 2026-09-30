import { Figure } from "@/lib/blog";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";
import { MCP_URL } from "@/lib/facts";

export const dynamic = "force-static";
export const metadata = postMetadata("notes-in-claude-code-and-codex");

const FAQ = [
  { q: "Can Claude Code read and write my notes?", a: [
    "Yes. Add Amber Notes as an MCP server with an access token, and Claude Code can search, read, create and edit your notes, or only read them if you make the token read only.",
  ] },
  { q: "How do I add a notes MCP server to Codex?", a: [
    "Create an access token for Codex in Amber Notes, under Settings, Connect an AI, Codex. It shows a few lines to add to ~/.codex/config.toml, with the server address and the token in an Authorization header.",
  ] },
  { q: "Where is the access token stored?", a: [
    "In your Claude Code or Codex configuration on your computer. Amber Notes shows it once. Anyone with the token can use your notes, so keep it private, and disconnect it in Amber Notes if it leaks.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="notes-in-claude-code-and-codex"
      intro={<>I use Claude Code every day, and I wanted it to write the standup, keep a work log and look up what I decided last week, in the same notes I read on my phone. With Amber Notes it takes one command for Claude Code, or a few lines for Codex.</>}
      faq={FAQ}
    >
      <h2>What it&apos;s good for</h2>
      <ul>
        <li>&ldquo;Write today&apos;s standup into my notes, from the commits since yesterday.&rdquo;</li>
        <li>&ldquo;Add what we just decided about the cache to my Project notes.&rdquo;</li>
        <li>&ldquo;Read my note on the release checklist and go through it.&rdquo;</li>
        <li>&ldquo;Log today&apos;s hours in my Timesheet table.&rdquo;</li>
      </ul>
      <p>
        Amber Notes is a free notes app for iPhone and Mac with an MCP server built in, so your agent writes into the same notes you read
        everywhere else. You see what it changed, with Undo, and every earlier version is kept. If your notes are still in Apple Notes,{" "}
        <a href="/blog/move-from-apple-notes">move them over first</a>.
      </p>

      <h2>Claude Code</h2>
      <ol>
        <li>In Amber Notes on your Mac, open Settings and, under Connect an AI, choose Claude Code.</li>
        <li>Turn on Read only if Claude Code should only look things up.</li>
        <li>Choose Add to Claude Code. Amber Notes creates an access token and runs <code>claude mcp add</code> for you, for every project.</li>
        <li>Or choose Create Access Token and run the command it shows in a terminal. It looks like this:</li>
      </ol>
      <pre><code>{`claude mcp add --scope user --transport http amber-notes \\
  ${MCP_URL} \\
  --header "Authorization: Bearer pane_…"`}</code></pre>
      <p>
        Already connected Claude on claude.ai with the same Claude account? Then Claude Code may already have Amber Notes as a connector,
        and you can skip this. <a href="/blog/connect-chatgpt-to-your-notes">Connecting ChatGPT and Claude</a> covers that side.
      </p>

      <h2>Codex</h2>
      <ol>
        <li>In Amber Notes, open Settings and, under Connect an AI, choose Codex.</li>
        <li>Turn on Read only if you like, then choose Create Access Token.</li>
        <li>Copy the lines it shows into <code>~/.codex/config.toml</code>:</li>
      </ol>
      <pre><code>{`[mcp_servers.amber_notes]
url = "${MCP_URL}"
http_headers = { "Authorization" = "Bearer pane_…" }`}</code></pre>
      <p>The token is shown once. Keep it private, like a password.</p>

      <h2>Check that it works</h2>
      <p>
        Start a new session and ask: &ldquo;Search my Amber Notes and tell me what I wrote most recently.&rdquo; The agent should call{" "}
        <code>get_overview</code> or <code>search_notes</code>. In Claude Code, <code>/mcp</code> lists the servers it has.
      </p>

      <h2>Stay in control</h2>
      <Figure shot={SHOTS.history} caption="Every change Claude Code makes is in the note's version history, next to your own." />
      <ul>
        <li>Each token shows up in Settings under Connected, with when it was last used. Disconnect it there, and it stops working right away.</li>
        <li>A read-only token can&apos;t change anything.</li>
        <li>Edits keep the previous version, so File, then Show Version History, can put a note back.</li>
      </ul>
      <p>
        The <a href="/blog/mcp-server">MCP server page</a> lists every tool the agent can call, and{" "}
        <a href="/blog/work-log-with-claude-code">keep a work log with Claude Code</a> puts it to daily use.
      </p>
    </PostPage>
  );
}
