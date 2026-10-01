import { Figure } from "@/lib/blog";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("work-log-with-claude-code");

const FAQ = [
  { q: "Can Claude Code write my standup?", a: [
    "Yes. With Amber Notes connected, ask it to summarize the day's commits and add them under today's date in your Standup notes. It appends to the note instead of rewriting it, and you can undo the change in the app.",
  ] },
  { q: "How do I make Claude Code log my work automatically?", a: [
    "Add an instruction to your project's CLAUDE.md, such as \"When I say we're done for the day, add a short summary to my Work log note in Amber Notes\". Claude Code reads CLAUDE.md at the start of every session.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="work-log-with-claude-code"
      intro={<>I work in Claude Code most of the day, and I used to lose the thread of what I did by Friday. Now Claude Code writes my standup and a short log into my notes as we go, and I read them on my phone. Here&apos;s the setup.</>}
      faq={FAQ}
    >
      <h2>Set it up once</h2>
      <ol>
        <li>Add Amber Notes to Claude Code: one command, or the Add to Claude Code button on a Mac. <a href="/blog/notes-in-claude-code-and-codex">Use your notes from Claude Code and Codex</a> has the details.</li>
        <li>Create the notes you want it to write to, for example Standup notes and Work log, in a Work folder.</li>
        <li>Tell Claude Code how to use them, in your project&apos;s <code>CLAUDE.md</code>:</li>
      </ol>
      <pre><code>{`## Notes
- Standups go in the "Standup notes" note in Amber Notes: append under today's date.
- When I say we're done for the day, add three lines to "Work log":
  what shipped, what's blocked, what's next.
- Log hours in the "Timesheet" table with log_table_row.`}</code></pre>

      <h2>The standup</h2>
      <p>
        Ask &ldquo;Write today&apos;s standup from the commits since yesterday.&rdquo; Claude Code reads the git log, then calls{" "}
        <code>append_to_note</code>, which adds text at the end of a note, or under a heading you name. The rest of the note stays exactly as it
        was.
      </p>
      <p>
        In Amber Notes the new lines are tinted, and the bar at the bottom says what Claude Code changed, with Undo, like the picture at the top.
      </p>
      <p>
        To skip the setup, add the <a href="/templates/daily-standup">standup notes template</a>: the note and the prompt for Claude Code,
        ready to paste into <code>CLAUDE.md</code>.
      </p>

      <h2>A daily log</h2>
      <p>
        One running note, with a heading per day, is easier to search later than a note per day. &ldquo;Add today&apos;s summary to Work
        log&rdquo; puts it under today&apos;s heading. If you prefer a note per day, ask for it: <code>create_note</code> makes one, and{" "}
        <code>move_note</code> files it in a folder like Work/2026.
      </p>

      <h2>A tracker</h2>
      <p>
        For numbers, like hours, energy or the day&apos;s focus, a table works better than prose. Make a table with a Date column and ask
        Claude Code to log a row. <code>log_table_row</code> checks each value against its column, and in a tracker with a date column it
        updates today&apos;s row instead of adding a second one.
      </p>
      <Figure shot={SHOTS.tracker} caption="A tracker note: one row per day, filled in by you or by Claude Code." />

      <h2>Reading it back</h2>
      <ul>
        <li>&ldquo;What did I do last week?&rdquo; <code>search_notes</code> and <code>read_note</code> find it.</li>
        <li>On your phone, the log is just a note: open it in Amber Notes.</li>
        <li>Every change Claude Code makes keeps the previous version. If a summary goes wrong, restore the earlier one from the note&apos;s history.</li>
      </ul>
      <p>
        Codex works the same way with <code>AGENTS.md</code>, and so does any assistant that speaks MCP, including Incredible. For what an agent
        needs from a notes app in general, see <a href="/blog/best-notes-app-for-ai-agents">the best notes app for AI agents</a>.
      </p>
    </PostPage>
  );
}
