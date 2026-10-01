import { PostPage, postMetadata } from "@/lib/PostPage";
import { APP_STORE_LIVE } from "@/lib/site";

export const dynamic = "force-static";
export const metadata = postMetadata("move-from-apple-notes");

const FAQ = [
  { q: "Does importing change or delete anything in Apple Notes?", a: [
    "No. The import only reads Apple Notes. Your notes there stay exactly as they were, so you can keep using both.",
  ] },
  { q: "Can I import again later without getting duplicates?", a: [
    "Yes. Notes you already imported are marked Already imported in the list, and a note that hasn't changed since is skipped.",
  ] },
  { q: "Can I export Apple Notes as markdown instead?", a: [
    "On macOS 26, Apple Notes can export a note as markdown from the File menu, one note at a time. Amber Notes imports everything you pick in one go, and keeps your notes as markdown from then on.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="move-from-apple-notes"
      intro={<>I built Amber Notes to feel like Apple Notes, so moving should be easy too. On your Mac, you bring every note over in one go, folders and pins included. Nothing in Apple Notes changes, so you can take your time.</>}
      faq={FAQ}
    >
      <h2>Before you start</h2>
      <ul>
        <li>A Mac with macOS 26 or later, and your notes in the Notes app on it.</li>
        <li>Amber Notes, free from the <a href="/download">download page</a>. Open it and sign in, so your notes sync.</li>
      </ul>

      <h2>Import everything on your Mac</h2>
      <ol>
        <li>In Amber Notes, choose File, then Import from Apple Notes.</li>
        <li>The first time, macOS asks whether Amber Notes may control Notes. Choose Allow. That&apos;s how it reads your notes. If you chose Don&apos;t Allow by mistake, turn it on in System Settings, Privacy &amp; Security, Automation.</li>
        <li>Pick everything, or just the notes you want. You can search the list. Notes with the same title as one you already have are marked Already imported.</li>
        <li>Keep Apple Notes folders is on, so your folders come along. Turn it off to put everything in one list.</li>
        <li>To keep your pinned notes pinned, turn on Also bring over pinned notes. It asks for Full Disk Access, because Apple Notes keeps pins where only apps with that permission can read them. Everything else imports without it.</li>
        <li>Choose Import. You can watch it count through your notes.</li>
      </ol>

      <h2>What comes along</h2>
      <ul>
        <li>Your notes, in their folders, with their dates.</li>
        <li>Text formatting, links, lists, checklists and tables.</li>
        <li>Pins, if you turned that option on.</li>
      </ul>
      <p>
        Images and attachments stay in Apple Notes, and so do locked notes, which the import can&apos;t read (unlock them first; if
        you&apos;ve lost the password, see <a href="/blog/forgot-apple-notes-password">forgot your Apple Notes password</a>). Your notes in Apple Notes
        stay exactly as they were.
      </p>

      <h2>On your iPhone</h2>
      {APP_STORE_LIVE ? (
        <p>
          Everything you import on your Mac shows up on your iPhone a second later, once you sign in there with the same account. To
          bring over a single note from your iPhone, open it in Apple Notes, tap Share and choose Amber Notes.
        </p>
      ) : (
        <p>
          The iPhone app is coming soon to the App Store. Once it&apos;s out, sign in with the same account and everything you imported
          on your Mac is there. To bring over a single note from your iPhone, open it in Apple Notes, tap Share and choose Amber Notes.
        </p>
      )}

      <h2>After the move</h2>
      <ul>
        <li>If you know Apple Notes, you already know Amber Notes: folders, a note list by date, pins, search and Recently Deleted work the same way.</li>
        <li>Your notes are stored as markdown underneath, formatted on screen.</li>
        <li>Using Claude Cowork? <a href="/blog/claude-cowork-apple-notes">How to use Claude Cowork with Apple Notes</a> compares staying in Apple Notes with moving.</li>
        <li>Want ChatGPT or Claude to use them? <a href="/blog/connect-chatgpt-to-your-notes">Connect ChatGPT or Claude to your notes</a>. For a coding agent, see <a href="/blog/notes-in-claude-code-and-codex">using your notes from Claude Code and Codex</a>.</li>
        <li>Still deciding? <a href="/blog/amber-notes-vs-apple-notes">Amber Notes vs Apple Notes</a> covers what each one does better.</li>
        <li>Want a copy of your Apple Notes as files too? <a href="/blog/export-apple-notes-to-markdown">Export Apple Notes to Markdown</a> covers the built-in export and tools for every note at once.</li>
      </ul>
    </PostPage>
  );
}
