import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("back-up-apple-notes");

// Checked on 2 October 2026 against Apple's pages: what iCloud Backup includes (108770), deleting and
// recovering notes on iPhone, Mac and iCloud.com, exporting notes on Mac (macOS 26 and 27) and iPhone,
// and backing up a Mac with Time Machine (102307). Menu names on macOS 26.5 read from the Notes app.

const FAQ = [
  { q: "Does iCloud back up Apple Notes?", a: [
    "iCloud keeps your notes in sync, so you don't lose them with a phone. It doesn't keep old copies: a note you delete is deleted on every device after 30 days in Recently Deleted, and Apple Notes has no earlier versions of a note to restore.",
  ] },
  { q: "Are Apple Notes in my iPhone backup?", a: [
    "Only the notes in the On My iPhone account. Apple says iCloud Backup doesn't include notes that are already stored in iCloud.",
  ] },
  { q: "How do I back up all my Apple Notes at once?", a: [
    "Use an exporter on your Mac, such as the free, open-source Apple Notes Exporter, which writes every note to Markdown files in their folders. Apple Notes itself exports one note at a time.",
  ] },
  { q: "Can I back up locked notes?", a: [
    "A locked note's text is encrypted with your notes password, so no exporter can read it while it's locked. Unlock the notes you want in the backup first, and keep the password somewhere safe.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="back-up-apple-notes"
      intro={<>It&apos;s easy to assume iCloud backs up your notes. iCloud keeps them in sync, which protects you from losing a phone and not much else: delete a note or overwrite a paragraph, and the change reaches every device. This guide covers what actually keeps a copy of your Apple Notes, and the routine I&apos;d use.</>}
      faq={FAQ}
    >
      <h2>The short answer</h2>
      <p>
        Export your notes to files and keep those files somewhere other than your iCloud account. On a Mac, an exporter can write every
        note to Markdown in one go; Apple Notes itself exports one note at a time. Turn on Time Machine as well, and unlock any locked note
        you want in the copy.
      </p>

      <h2>What iCloud protects you from</h2>
      <p>
        With iCloud, every device signed in to your Apple Account has the same notes, so losing a phone doesn&apos;t lose them.
        A mistake travels the same way, though. A deleted note leaves every device and waits in Recently Deleted for 30 days, then it&apos;s
        gone. A paragraph you delete or overwrite can&apos;t be brought back, because Apple Notes keeps no version history. And
        an iPhone backup won&apos;t help, since <a href="https://support.apple.com/en-us/108770" rel="noopener">iCloud Backup leaves out notes
        already stored in iCloud</a>. If you&apos;re past that point already, <a href="/blog/recover-deleted-apple-notes">how to recover deleted
        Apple Notes</a> covers what can still be done.
      </p>

      <h2>Your options</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">What it copies</th><th scope="col">Limits</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Export a note</th><td>The note you have open, as Markdown or PDF</td><td>One at a time; Markdown needs macOS 26 or iOS 26</td></tr>
            <tr><th scope="row">An exporter on your Mac</th><td>Every note, in its folders, as Markdown files with their attachments</td><td>A third-party app; run it again to refresh the copy</td></tr>
            <tr><th scope="row">iPhone backup</th><td>Notes in the On My iPhone account</td><td>Not iCloud notes; restoring replaces everything on the phone</td></tr>
            <tr><th scope="row">Time Machine</th><td>Your Mac&apos;s files, including notes in On My Mac</td><td>Apple doesn&apos;t document restoring a single note from it</td></tr>
          </tbody>
        </table>
      </div>

      <h2>A routine that works</h2>
      <ol>
        <li>
          Once a month, export everything with an exporter such as <a href="https://github.com/kzaremski/apple-notes-exporter" rel="noopener">Apple
          Notes Exporter</a>, and put the exported folder on an external drive or in a cloud drive that isn&apos;t the same iCloud account.
          The app is free and open source. It writes every note to Markdown in its folders and asks for Full Disk Access to read them.{" "}
          <a href="/blog/export-apple-notes-to-markdown">Exporting Apple Notes to Markdown</a> compares it with the alternatives.
        </li>
        <li>
          Between those runs, export a note you couldn&apos;t bear to lose as soon as you finish it. On a Mac running macOS 26, choose File,
          Export as, then Markdown; on macOS 27 the menu is called Export To. On iPhone, tap the Share button, then Export as Markdown.
        </li>
      </ol>
      <p>
        If you have a Mac, turn on <a href="https://support.apple.com/en-us/102307" rel="noopener">Time Machine</a> too, so the rest of the
        Mac is covered along with any notes stored on it.
      </p>
      <p>
        Exporters can&apos;t read locked notes, because a locked note&apos;s text is encrypted with your notes password. Unlock the ones
        you want in the backup, and keep the password in a password manager: if you forget it, <a href="/blog/forgot-apple-notes-password">nobody
        can open those notes again</a>.
      </p>

      <h2>A notes app that keeps versions</h2>
      <p>
        Version history is what helps on an ordinary day, when you or an app changes a note and removes the part you needed, and Apple
        Notes has none. Pinto Notes, the notes app for iPhone and Mac that I make, keeps up to
        100 earlier versions of every note, including the ones from before ChatGPT or Claude edited it, and File, Show Version History puts
        any of them back. Deleted notes stay in Recently Deleted for 30 days, as in Apple Notes. When you want your own copy, Settings,
        Privacy &amp; Security, Export Your Notes saves every note as Markdown in its folder, with its files.
      </p>
      <p>
        <a href="/blog/move-from-apple-notes">Moving from Apple Notes</a> takes one import on your Mac and leaves Apple Notes as it was.
      </p>
    </PostPage>
  );
}
