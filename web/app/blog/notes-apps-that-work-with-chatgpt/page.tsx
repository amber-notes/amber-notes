import { Figure } from "@/lib/blog";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("notes-apps-that-work-with-chatgpt", {
  title: "Notes apps that work with ChatGPT (2026) · Amber Notes",
});

type Row = { app: string; how: string; search: string; write: string };

// Checked against OpenAI's help pages and each app's own documentation on 30 September 2026.
const ROWS: Row[] = [
  { app: "Amber Notes", how: "Its own MCP server, added as an app in Developer mode", search: "Yes", write: "Yes: create, edit, append, tick items; you approve it, and every change can be undone" },
  { app: "Notion", how: "The Notion app in ChatGPT; Notion's MCP server for read and write", search: "Yes", write: "Through Notion's MCP server" },
  { app: "OneNote", how: "A OneNote plugin built by OpenAI", search: "Finds and summarizes notes", write: "Creates or updates notes through supported actions" },
  { app: "Evernote", how: "Evernote's hosted MCP server (beta)", search: "Yes", write: "Creates notes" },
  { app: "Hjarni", how: "Its own MCP server", search: "Yes", write: "Yes" },
  { app: "Apple Notes", how: "ChatGPT for Mac can work with the note you have open", search: "No", write: "No" },
  { app: "Google Keep", how: "No ChatGPT app that I could find; Gemini connects to Keep", search: "No", write: "No" },
];

const FAQ = [
  { q: "Which notes app works best with ChatGPT?", a: [
    "For searching and editing all your notes from ChatGPT, you need an app it can connect to: Amber Notes, Notion, OneNote, Evernote and Hjarni can. Which is best depends on where your notes are today and whether you want ChatGPT to write, not just read.",
  ] },
  { q: "Do I need a paid ChatGPT plan?", a: [
    "OneNote and Notion appear in ChatGPT's own list of apps; OpenAI's help pages say which plans have them. Adding any other app yourself, such as Amber Notes, Evernote's MCP server or Hjarni, needs Developer mode, which is on Plus, Pro, Business, Enterprise and Edu. Check what your plan allows: OpenAI's pages differ on whether such apps can edit on every plan.",
  ] },
  { q: "Can ChatGPT read my Apple Notes?", a: [
    "Only the note you have open, in the ChatGPT app on a Mac. It can't search your other notes or save changes, because Apple Notes has no API it could connect to.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="notes-apps-that-work-with-chatgpt"
      intro={<>More notes apps now say they work with ChatGPT, but that can mean very different things: reading the note you have open, searching all of them, or writing changes back. Here&apos;s how the main ones compare in September 2026. I make Amber Notes, so I&apos;ve described the others the way their makers do.</>}
      faq={FAQ}
    >
      <h2>Three levels of &ldquo;works with ChatGPT&rdquo;</h2>
      <ol>
        <li><strong>It can see one note.</strong> ChatGPT reads what you show it: the open window, a selection, or what you paste.</li>
        <li><strong>It can search your notes.</strong> ChatGPT finds and reads notes on its own when you ask a question.</li>
        <li><strong>It can write.</strong> ChatGPT creates notes or changes the ones you have, so the answer lands in your notes instead of the chat.</li>
      </ol>
      <p>The third level is the useful one, and the one where you want a way to check and undo what it did.</p>

      <h2>At a glance</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">App</th><th scope="col">How it connects</th><th scope="col">Searches your notes</th><th scope="col">Writes to your notes</th></tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.app}><th scope="row">{r.app}</th><td>{r.how}</td><td>{r.search}</td><td>{r.write}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Sources: OpenAI&apos;s help pages for <a href="https://help.openai.com/en/articles/20001511-using-onenote-in-chatgpt-and-codex" rel="noopener">OneNote</a>{" "}
        and <a href="https://help.openai.com/en/articles/12532955-notion-app-with-sync" rel="noopener">Notion</a>,{" "}
        <a href="https://evernote.com/mcp" rel="noopener">Evernote MCP</a> and <a href="https://hjarni.com/mcp-note-app" rel="noopener">Hjarni</a>.
      </p>

      <h2>How to choose</h2>
      <ul>
        <li><strong>Your notes are in Notion or OneNote already:</strong> connect that. Moving is more work than it&apos;s worth.</li>
        <li><strong>You like Apple Notes and want ChatGPT to use them:</strong> Apple Notes can&apos;t do it, so the notes have to move. Amber Notes works like Apple Notes and imports them in one go on your Mac. <a href="/blog/move-from-apple-notes">Here&apos;s how to move</a>.</li>
        <li><strong>You want ChatGPT to edit, not just read:</strong> check what happens after a bad edit. In Amber Notes you see what changed, with Undo, and every earlier version is kept.</li>
        <li><strong>You use more than ChatGPT:</strong> an MCP server works with Claude, Claude Code, Codex and Incredible too. <a href="/blog/notes-apps-with-mcp">Notes apps with an MCP server, compared</a> covers that side.</li>
      </ul>

      <Figure shot={SHOTS.consent} caption="In Amber Notes, ChatGPT gets access only when you choose Allow, read and edit or read only." />

      <h2>Setting it up</h2>
      <p>
        For Amber Notes, it takes a few minutes on chatgpt.com, which is where OpenAI documents custom apps.{" "}
        <a href="/blog/connect-chatgpt-to-your-notes">How to connect ChatGPT to your notes</a> has every step. If you&apos;re deciding
        between Apple Notes and something ChatGPT can reach, <a href="/blog/apple-notes-api">Apple Notes API: what exists</a> explains why
        Apple Notes stays out of reach.
      </p>
    </PostPage>
  );
}
