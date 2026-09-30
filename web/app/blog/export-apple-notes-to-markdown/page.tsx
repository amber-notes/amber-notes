import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("export-apple-notes-to-markdown");

const FAQ = [
  { q: "Can Apple Notes export to Markdown?", a: [
    "Yes, since macOS 26 and iOS 26. On a Mac, click the note and choose File, Export as, Markdown (in macOS 27 the menu is called Export To). On iPhone, open the note, tap the Share button and tap Export as Markdown. Older versions can't export Markdown on their own.",
  ] },
  { q: "Can I export all my Apple Notes to Markdown at once?", a: [
    "Not with a documented Apple feature. Apple's guides describe exporting the note you have open. To export a folder or your whole library, use a free exporter on your Mac, such as Apple Notes Exporter or notes-exporter on GitHub.",
  ] },
  { q: "Does the Markdown export keep images and attachments?", a: [
    "Apple's guide doesn't say what happens to them. Markdown is plain text, so a picture can only come along as a separate file that the text links to. Export one note that has a picture and a table, and open the file before you rely on it.",
  ] },
  { q: "Can I export a locked note?", a: [
    "Unlock it first. Apple's iPhone guide says a locked note must be unlocked before you export it to Pages, and it doesn't describe a way around that for Markdown.",
  ] },
  { q: "How do I get Markdown back into Apple Notes?", a: [
    "On a Mac, choose File, Import Markdown, pick one or more files and click Import. In macOS 27 you can also pick a whole folder and keep its folder structure; the new notes land in a folder called Imported Notes.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="export-apple-notes-to-markdown"
      intro={<>Apple Notes can finally export Markdown on its own, which is good news if you want your notes in Obsidian, in a git repository or in a chat with ChatGPT. Here&apos;s how it works on a Mac and an iPhone, what to check in the file, and what to use when you want every note, not just one.</>}
      faq={FAQ}
    >
      <h2>The short answer</h2>
      <p>
        On macOS 26 and iOS 26 or later, Apple Notes exports a note as a Markdown file: File, Export as, Markdown on a Mac, and Share, Export
        as Markdown on iPhone. It works one note at a time. On older versions, and for a whole library, you need an exporter.
      </p>

      <h2>Export a note on a Mac</h2>
      <ol>
        <li>Open Notes and click the note you want to export.</li>
        <li>Choose File, Export as, Markdown. In macOS 27, the menu is File, Export To, then Markdown.</li>
        <li>Type a name for the file if you want another one, and pick where to save it.</li>
        <li>Click Save.</li>
      </ol>
      <p>
        To copy only part of a note, macOS 27 and iOS 27 add Copy as Markdown: select the text, then choose Edit, Copy as Markdown on a Mac,
        or Copy as Markdown in the edit menu on iPhone. It works the other way too: paste Markdown into a note and it turns into headings and
        lists. The Mac steps come from Apple&apos;s guide, <a href="https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac" rel="noopener">Import, export, and print notes on Mac</a>.
      </p>

      <h2>Export a note on iPhone</h2>
      <ol>
        <li>Open the note in Notes.</li>
        <li>Tap the Share button, then tap Export as Markdown. If you don&apos;t see it, tap the View More button first.</li>
        <li>Choose where the file goes: Save to Files, AirDrop, Mail or another app.</li>
      </ol>
      <p>
        Apple describes this in <a href="https://support.apple.com/guide/iphone/export-or-print-notes-iphdf551cfa2/ios" rel="noopener">Export or print notes on iPhone</a>.
      </p>

      <h2>What to check in the file</h2>
      <p>
        Apple doesn&apos;t list what survives the trip, so export one note that has everything you use, and open the file in a text editor
        before you move a hundred of them. The things worth a look:
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">In your note</th><th scope="col">What to look for in the Markdown</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Headings, bold, lists, links</th><td>These are what Markdown is for, and should come out as <code>#</code>, <code>**</code>, <code>-</code> and <code>[text](link)</code>.</td></tr>
            <tr><th scope="row">Checklists</th><td>Whether each item is a <code>- [ ]</code> or <code>- [x]</code> line, with its ticked state kept.</td></tr>
            <tr><th scope="row">Tables</th><td>Whether you get a pipe table, and whether cells with line breaks survive.</td></tr>
            <tr><th scope="row">Pictures, scans and files</th><td>Markdown can only link to them, so check that the files were saved and that the links point at them.</td></tr>
            <tr><th scope="row">Drawings, tags and links to other notes</th><td>Apple Notes features with no Markdown equivalent. Expect them to be flattened or dropped.</td></tr>
            <tr><th scope="row">Locked notes</th><td>Unlock the note before you export it.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Export every note at once</h2>
      <p>
        Apple&apos;s guides only describe exporting the note in front of you. For a folder or a whole library, the usual route is a free
        exporter that runs on your Mac and reads the Notes app for you:
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">What it does</th><th scope="col">Good to know</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Apple Notes&apos; own export</th><td>One note to one Markdown file, on Mac and iPhone</td><td>macOS 26 or iOS 26 and later; nothing to install</td></tr>
            <tr><th scope="row"><a href="https://github.com/kzaremski/apple-notes-exporter" rel="noopener">Apple Notes Exporter</a></th><td>A Mac app that exports every note, in its folders, to Markdown and other formats, with attachments beside each note</td><td>Free and open source (GPL); download from GitHub; asks for Full Disk Access</td></tr>
            <tr><th scope="row"><a href="https://github.com/storizzi/notes-exporter" rel="noopener">notes-exporter</a></th><td>A command-line script that exports your notes to HTML, Markdown, PDF or Word, with images</td><td>Free and open source (MIT); needs Python and the Terminal</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Whichever you use, it&apos;s a copy. Apple Notes stays as it was, and a note you change tomorrow won&apos;t change in the file.
      </p>

      <h2>If you&apos;re moving somewhere, not making a backup</h2>
      <p>
        An export is the right tool for a backup or a one-off move into Obsidian or a repository. <a href="/blog/apple-notes-vs-obsidian">Apple
        Notes vs Obsidian</a> covers what you gain and give up there. If what you actually want is Markdown notes that still work like Apple
        Notes, that&apos;s why I made Amber Notes: it looks and works like Apple Notes on iPhone and Mac, and every note is Markdown underneath.
      </p>
      <p>
        On a Mac, <a href="/blog/move-from-apple-notes">File, Import from Apple Notes</a> brings over the notes you pick in one go, in their
        folders, with checklists and tables. Be aware of what it leaves behind: images, attachments and locked notes stay in Apple Notes. And
        once your notes are Markdown in Amber Notes, ChatGPT and Claude can read and edit them directly, with your approval, instead of you
        pasting files into a chat. <a href="/blog/connect-chatgpt-to-your-notes">Connecting ChatGPT or Claude</a> takes a couple of minutes.
      </p>
      <p>
        If you&apos;re here because you want to script Apple Notes, <a href="/blog/apple-notes-api">what exists instead of an Apple Notes
        API</a> covers AppleScript, Shortcuts (which now has Create Note from Markdown and Append Markdown to Note actions) and their limits.
      </p>
    </PostPage>
  );
}
