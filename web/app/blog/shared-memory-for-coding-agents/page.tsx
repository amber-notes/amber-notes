import { Figure } from "@/lib/blog";
import { APP_STORE_LIVE } from "@/lib/site";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";
import { MCP_URL } from "@/lib/facts";

export const dynamic = "force-static";
export const metadata = postMetadata("shared-memory-for-coding-agents", {
  title: "Shared memory for Claude Code and Codex · Amber Notes",
});

const FAQ = [
  { q: "Can Claude Code and Codex share the same memory?", a: [
    "Yes, if both can reach the same place. Connect both to one Amber Notes account, keep a Project memory note, and tell each agent in CLAUDE.md or AGENTS.md to read it at the start of a task and add to it when something is decided. Both read and write the same note, from any computer.",
  ] },
  { q: "How do I see which agent changed my notes?", a: [
    "Give each agent its own access token from Settings, Connect an AI, and its edits carry its name: Edited by Claude Code or Edited by Codex in the note list, the changed lines tinted with Undo in the note, and the name on every version in the note's history.",
  ] },
  { q: "Can Amber Notes read my agents' memory?", a: [
    "Not at rest: notes are end-to-end encrypted on your devices. While an agent you approved is working, our server opens the notes it asks for in memory to answer it, and forgets the key when the request ends. Locked notes stay out of reach even then.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="shared-memory-for-coding-agents"
      intro={<>Someone found Amber Notes this week looking for one thing: a memory that Claude Code, Codex and their other agents all share, and that they can read too. This is the setup I&apos;d suggest, checked against the app and the server.</>}
      faq={FAQ}
    >
      <h2>Why agents need a shared memory</h2>
      <p>
        Every session starts from nothing. <code>CLAUDE.md</code> and <code>AGENTS.md</code> help, but they&apos;re files in one repository on one
        computer, Claude Code reads one and Codex reads the other, and neither agent writes to them unless you ask. So when you and Claude Code
        decide in the morning that cache keys include the locale, Codex doesn&apos;t know it in the afternoon, and you explain it again.
      </p>
      <p>
        A note works better as the memory. Both agents can read and write it through the same MCP server, from any computer, and you can read it
        {APP_STORE_LIVE ? " on your phone" : " in the app on your Mac (the iPhone app is on its way to the App Store)"} without opening a repository.
        It&apos;s plain text, so when an agent writes down something wrong, you fix the line yourself.
      </p>

      <h2>Connect both agents to the same account</h2>
      <p>
        <a href="/blog/notes-in-claude-code-and-codex">Use your notes from Claude Code and Codex</a> has every way to connect them. For a shared
        memory I&apos;d use an access token for each, made in the app:
      </p>
      <ol>
        <li>In Amber Notes on your Mac, open Settings and, under Connect an AI, choose Claude Code. Choose Add to Claude Code if your copy shows it, or Create Access Token and run the command it shows.</li>
        <li>Go back to Connect an AI and choose Codex. Choose Create Access Token and copy the lines it shows into <code>~/.codex/config.toml</code>.</li>
      </ol>
      <p>
        The reason for tokens is the name. A token is named after the agent you made it for, and that name goes on every edit. Codex and the Claude
        Code plugin can also sign in through the browser, which works fine, but a sign-in from a terminal is listed as &ldquo;An app on this
        computer&rdquo;, because Amber Notes can&apos;t prove which program is on the other end. With two agents signed in that way, their edits
        look the same.
      </p>
      <p>
        If one agent should only look things up, a reviewer for example, turn on Read only before you create its token. Each connection is listed
        in Settings under Connected, with when it was last used, and you can disconnect one without touching the other.
      </p>

      <h2>One note they read first</h2>
      <p>
        Keep one note per project, called Project memory and the project&apos;s name, with three headings. Pin it: <code>get_overview</code>{" "}
        lists pinned notes, so an agent that starts there sees it straight away.
      </p>
      <pre><code>{`# Project memory: Atlas

## Decisions
- 2026-10-06: Cache keys include the
  locale. German and English pages were
  sharing one entry.

## Conventions
- Run pnpm test before saying a task is done.
- New endpoints get a test in the same
  pull request.

## Handoff log
- 2026-10-06 Claude Code: moved the import
  to a background job. Next: retry when
  the provider answers 429.`}</code></pre>
      <p>
        Decisions hold what was chosen and why, so nobody argues it again. Conventions are the rules you&apos;d otherwise repeat in every session.
        The handoff log is where an agent says what it did and what&apos;s left, so the next one, or you after lunch, can pick it up.
      </p>
      <p>Then tell both agents to use it. Put the same lines in <code>CLAUDE.md</code> for Claude Code and <code>AGENTS.md</code> for Codex:</p>
      <pre><code>{`## Memory
- Before a task, read the note
  "Project memory: Atlas" in Amber Notes.
- When we decide something, add it under
  Decisions with append_to_note: the date,
  the decision and one line on why.
- When you finish or stop, add one line
  under Handoff log with append_to_note:
  the date, your name, what changed and
  what's next.
- Never rewrite the note. To correct a
  line, use edit_note on that line only.`}</code></pre>
      <p>
        The last rule is there because of the second agent. <code>append_to_note</code> adds text under the heading you name, to whatever the note
        holds at that moment; the server locks the note for each change, so two agents adding a line at the same time both get theirs in. A full
        rewrite would send back the agent&apos;s own copy of the note and could drop what the other one added a minute earlier.{" "}
        <code>edit_note</code> changes only the text it matches, and with the version from <code>read_note</code> it refuses to edit a note that
        changed since it was read.
      </p>
      <p>
        If the memory outgrows one note, give it a folder per project and a note per topic. The <a href="/templates/decision-log">decision log
        template</a> is a good start for the Decisions part, and <a href="/blog/work-log-with-claude-code">keep a work log with Claude Code</a>{" "}
        covers a daily log next to it.
      </p>

      <h2>See which AI changed what</h2>
      <Figure shot={SHOTS.standup} caption="The line Claude Code just added is tinted, with Undo in the bar at the bottom." />
      <p>
        In the note list, a note an agent changed says Edited by Claude Code or Edited by Codex. Open it and the lines that agent added or changed
        are tinted, with a bar that says, for example, Codex changed 2 lines, and an Undo button. If you&apos;ve typed in the note since, Undo
        takes out only the agent&apos;s change and keeps yours, unless you changed the same lines.
      </p>
      <p>
        That covers the latest edit. For older ones, choose File, then Show Version History: every version is kept, each with who made it,
        you or an agent by name, and Restore This Version puts one back. Agents can see the same thing with <code>note_history</code>, so
        Codex can check whether it was Claude Code that wrote a line before it changes it.
      </p>

      <h2>What the encryption covers</h2>
      <p>
        Notes are end-to-end encrypted on your {APP_STORE_LIVE ? "iPhone or Mac" : "Mac"}, with a key iCloud Keychain carries between your devices,
        so Amber Notes can&apos;t read them at rest. The exception is while an agent works: when an agent you
        approved makes a request, our server opens the notes it asks for in memory to answer it, and forgets the key when the request ends.
        Locked notes stay out of reach even then; an agent sees only their titles.{" "}
        <a href="/blog/encrypted-notes-app-for-ai">An encrypted notes app that ChatGPT and Claude can use</a> explains how that works.
      </p>
      <p>
        So keep secrets out of the memory note. Any agent you connected can read it, and an API key in a note is
        an API key in every agent&apos;s context. Put the key in your environment and write down where it lives.
      </p>

      <h2>Other agents</h2>
      <p>
        The memory isn&apos;t tied to Claude Code and Codex. Anything that speaks MCP can use the same note at <code>{MCP_URL}</code>, including
        Gemini CLI (<a href="/blog/connect-notes-to-gemini">one command</a>) and Claude or ChatGPT in the browser (
        <a href="/blog/connect-chatgpt-to-your-notes">connect them here</a>). For what an agent needs from a notes app in general, see{" "}
        <a href="/blog/best-notes-app-for-ai-agents">the best notes app for AI agents</a>.
      </p>
    </PostPage>
  );
}
