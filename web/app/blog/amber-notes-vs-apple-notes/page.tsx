import { Figure } from "@/lib/blog";
import { APP_STORE_LIVE } from "@/lib/site";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("amber-notes-vs-apple-notes", { title: "Amber Notes vs Apple Notes: an honest comparison" });

const ROWS: [string, string, string][] = [
  ["Price", "Free", "Free"],
  ["Devices", APP_STORE_LIVE ? "iPhone and Mac" : "Mac now; iPhone coming soon to the App Store", "Every Apple device, and iCloud.com in a browser"],
  ["Folders, pins, checklists, tables", "Yes", "Yes"],
  ["ChatGPT and Claude can find, read and edit notes", "Yes, with your approval (MCP), from any device", "Only on a Mac: Claude Desktop through Anthropic's Read and Write Apple Notes extension, or community servers"],
  ["Claude Code and Codex", "Yes", "Through community tools, on a Mac"],
  ["Version history", "Yes, including every change an AI makes", "No"],
  ["Stored as markdown", "Yes, formatted on screen", "No, but a note can be exported as markdown"],
  ["Share a note", "As a read-only web page, with a link you can stop", "Invite people to edit with you"],
  ["Lock a note with a password", "Yes", "Yes"],
  ["Drawing, handwriting, scanning documents", "No", "Yes"],
  ["Sync", "Amber Notes' own sync, on servers in Frankfurt, Germany (EU)", "iCloud"],
  ["End-to-end encryption", "Every note, with the key in iCloud Keychain; while an AI you approved works, our server opens the notes it asks for", "With Advanced Data Protection turned on; locked notes always"],
  ["Open source", "Yes (MIT)", "No"],
];

export default function Page() {
  return (
    <PostPage
      slug="amber-notes-vs-apple-notes"
      intro={<>I love Apple Notes, and I built Amber Notes to feel just like it, with the few things I always missed: an AI that can use my notes, and a history of every change. Here&apos;s where the two differ, including what Apple Notes still does better.</>}
    >
      <h2>At a glance</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Amber Notes</th><th scope="col">Apple Notes</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([what, amber, apple]) => (
              <tr key={what}><th scope="row">{what}</th><td>{amber}</td><td>{apple}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The big difference: your AI can use it</h2>
      <p>
        In Amber Notes, ChatGPT, Claude, Claude Code, Codex and Incredible can search your notes, read them, write new ones and edit the
        ones you have, through MCP. You approve each assistant in the app and choose read-only, or read and edit. When one changes a note, you see what
        changed, with Undo, and the previous version stays in the note&apos;s history.{" "}
        <a href="/blog/connect-chatgpt-to-your-notes">How to connect ChatGPT to your notes</a> takes a few minutes.
      </p>
      <Figure shot={SHOTS.aiEdit} caption="What ChatGPT added is tinted, with a way to undo it." />
      <p>
        With Apple Notes, ChatGPT on a Mac can help with a note you have open, but it can&apos;t look through your notes or save changes on
        its own. <a href="/blog/claude-and-apple-notes">Can Claude read your Apple Notes?</a> covers the do-it-yourself options on a Mac, and{" "}
        <a href="/blog/notes-apps-with-mcp">notes apps with an MCP server, compared</a> looks beyond these two.
      </p>

      <h2>What Apple Notes does better</h2>
      <ul>
        <li>Drawing, handwriting and scanning documents.</li>
        <li>Collaborating: invite people to edit a note or folder with you.</li>
        <li>It&apos;s already on every Apple device, and on the web at iCloud.com.</li>
      </ul>

      <p>
        Weighing other apps too? See <a href="/blog/apple-notes-vs-notion">Apple Notes vs Notion</a> and{" "}
        <a href="/blog/apple-notes-vs-obsidian">Apple Notes vs Obsidian</a>.
      </p>

      <h2>Who each one is for</h2>
      <p>
        If you want your notes to stay exactly where they are and never talk to an AI, Apple Notes is great. If you already ask ChatGPT or
        Claude for help every day and want the result in your notes instead of copying and pasting, Amber Notes is made for that.
      </p>

      <h2>Try it without giving anything up</h2>
      <p>
        The import only reads Apple Notes, so you can bring everything over and keep using both. <a href="/blog/move-from-apple-notes">Here&apos;s how to move</a>,
        or <a href="/download">download Amber Notes for Mac</a>.
      </p>
    </PostPage>
  );
}
