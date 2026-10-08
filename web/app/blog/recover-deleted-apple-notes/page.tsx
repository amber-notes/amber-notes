import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("recover-deleted-apple-notes", { title: "How to recover deleted Apple Notes · Pinto Notes" });

const FAQ = [
  { q: "How long does Apple Notes keep deleted notes?", a: [
    "30 days. A deleted note goes to Recently Deleted on every device signed in to the same Apple Account and on iCloud.com, and is removed for good after 30 days, or sooner if you delete it from there.",
  ] },
  { q: "Can I recover Apple Notes deleted more than 30 days ago?", a: [
    "For notes stored in iCloud, no: Apple says you can't recover notes that were permanently removed, and iCloud Backup doesn't include notes already in iCloud. Notes stored only on your iPhone may be in an older iPhone backup, and notes in a Gmail or Yahoo account may be in that account's Trash.",
  ] },
  { q: "Why is there no Recently Deleted folder?", a: [
    "It only appears when there's something in it. If it's missing, no iCloud notes were deleted in the last 30 days, or the note was in a Gmail or Yahoo account, whose deleted notes go to that account's Trash in Mail.",
  ] },
  { q: "Can I get back an old version of a note I changed?", a: [
    "Not in Apple Notes: it keeps no version history, so an edit that removed text can't be undone later. Notes apps with version history can.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="recover-deleted-apple-notes"
      intro={<>Deleted a note you needed? If it was in the last 30 days, it&apos;s almost certainly still there. After that it gets harder, and most of the results for this search are recovery apps that won&apos;t say what they can really do. Here&apos;s what works, in order, from Apple&apos;s own documentation.</>}
      faq={FAQ}
    >
      <h2>First, make sure it&apos;s really gone</h2>
      <p>
        Notes go missing more often than they get deleted. Apple&apos;s <a href="https://support.apple.com/en-us/102476" rel="noopener">missing
        notes article</a> suggests these checks first:
      </p>
      <ul>
        <li><strong>Search everything.</strong> In the notes list, search for a word from the note with All Accounts selected. Search only sees the title of locked notes, so check those by hand.</li>
        <li><strong>Check each account.</strong> In Settings, Apps, Notes, Notes Accounts, make sure Notes is turned on for every account, such as Gmail or Yahoo. A note in an account that&apos;s switched off disappears from the list.</li>
        <li><strong>Check other folders.</strong> A note can end up in a folder you didn&apos;t expect.</li>
      </ul>

      <h2>Within 30 days: Recently Deleted</h2>
      <p>
        A deleted note moves to Recently Deleted on all your devices and on iCloud.com, and stays there for 30 days. The folder only shows
        up when it has something in it.
      </p>
      <p className="label"><strong>On iPhone</strong></p>
      <ol>
        <li>In Notes, go back to the folder list and tap Recently Deleted.</li>
        <li>Swipe left on the note, tap Move, and choose a folder.</li>
      </ol>
      <p className="label"><strong>On a Mac</strong></p>
      <ol>
        <li>In Notes, click Recently Deleted in the sidebar.</li>
        <li>Drag the note to another folder.</li>
      </ol>
      <p className="label"><strong>On iCloud.com, from any browser</strong></p>
      <ol>
        <li>Go to icloud.com/notes and sign in.</li>
        <li>Select Recently Deleted, select the note, then select Recover. It moves to the Notes folder.</li>
      </ol>
      <p>
        The steps come from Apple&apos;s <a href="https://support.apple.com/guide/iphone/iph904eee369/ios" rel="noopener">iPhone</a>,{" "}
        <a href="https://support.apple.com/guide/notes/not5585d71a8/mac" rel="noopener">Mac</a> and{" "}
        <a href="https://support.apple.com/guide/icloud/mm2f42f05cb9/icloud" rel="noopener">iCloud.com</a> guides.
      </p>

      <h2>Notes in Gmail, Yahoo and other accounts</h2>
      <p>
        Notes in a mail account don&apos;t use Recently Deleted. The account usually keeps a deleted note in its Trash, which you&apos;ll find in
        the Mail app. To get it back, copy it from Trash and paste it into a new note. Those accounts keep their own rules for how long
        Trash is kept.
      </p>

      <h2>After 30 days</h2>
      <p>
        For notes in iCloud, the honest answer is no. Apple says you can&apos;t recover notes that were permanently removed, and{" "}
        <a href="https://support.apple.com/en-us/108770" rel="noopener">iCloud Backup doesn&apos;t include notes already stored in iCloud</a>,
        so restoring an iPhone backup won&apos;t bring them back. A few cases are different:
      </p>
      <ul>
        <li><strong>Notes stored only on your iPhone</strong> (the On My iPhone account) are part of your iPhone backups. Restoring an older backup replaces what&apos;s on the phone now, so treat it as a last resort, and export anything newer first.</li>
        <li><strong>Notes stored only on your Mac</strong> (On My Mac) are in your Time Machine backups, if you use it. Apple doesn&apos;t document restoring a single note that way.</li>
        <li><strong>A shared note you didn&apos;t own</strong> never goes to Recently Deleted. You can open it again from the original link, unless the owner stopped sharing.</li>
      </ul>
      <p>
        Apple says notes it has permanently removed can&apos;t be recovered. Be careful with apps that promise otherwise, and with any that
        ask for your Apple Account password to try.
      </p>

      <h2>So it doesn&apos;t happen again</h2>
      <ul>
        <li>Keep a copy of the notes you can&apos;t lose: <a href="/blog/export-apple-notes-to-markdown">export them to Markdown</a>, one at a time or with an exporter for everything.</li>
        <li>On a Mac, turn on Time Machine. <a href="/blog/back-up-apple-notes">How to back up Apple Notes</a> has a routine that covers the rest.</li>
        <li>If you lock notes, know the password; a forgotten one is its own problem, covered in <a href="/blog/forgot-apple-notes-password">forgot your Apple Notes password</a>.</li>
      </ul>
      <p>
        The bigger gap is that Apple Notes has no version history. If you or an app changes a note and removes the part you needed, there&apos;s
        nothing to go back to. That&apos;s one of the things I built into Pinto Notes, the notes app for iPhone and Mac I make: deleted notes
        stay in Recently Deleted for 30 days like in Apple Notes, and every note also keeps up to 100 earlier versions, so you can restore
        one from File, Show Version History, including after ChatGPT or Claude edits it. <a href="/blog/amber-notes-vs-apple-notes">Pinto Notes
        vs Apple Notes</a> covers the other differences, and <a href="/blog/move-from-apple-notes">moving from Apple Notes</a> takes one import on your Mac.
      </p>
    </PostPage>
  );
}
