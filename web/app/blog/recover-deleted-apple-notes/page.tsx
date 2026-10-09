import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Capture, Steps } from "@/lib/PostParts";
import { RecoverChooser } from "@/lib/RecoverChooser";
import { SHOTS } from "@/lib/posts";

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
    "It only appears when there's something in it. If it's missing, no notes were deleted in the last 30 days, or the note was in a Gmail or Yahoo account, whose deleted notes go to that account's Trash in Mail.",
  ] },
  { q: "Can I get back an old version of a note I changed?", a: [
    "Not in Apple Notes: it keeps no version history, so an edit that removed text can't be undone later. Notes apps with version history can.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="recover-deleted-apple-notes"
      intro={<>Deleted a note you needed? If it was in the last 30 days, it&apos;s almost certainly still there. Here&apos;s where to look, and what&apos;s still possible after that.</>}
      answer={
        <Answer jump={[
          { href: "#which-applies", label: "Where did it go?" },
          { href: "#within-30-days", label: "Recently Deleted" },
          { href: "#mail-accounts", label: "Gmail and Yahoo" },
          { href: "#after-30-days", label: "After 30 days" },
        ]}>
          <p>
            Open Recently Deleted in Notes on your iPhone, Mac or iCloud.com, and move the note back to a folder. Notes stay there for 30
            days. After that an iCloud note is gone for good, whatever a recovery app promises; only a note that lived on one device, or in
            a mail account, may still be in a backup or that account&apos;s Trash.
          </p>
        </Answer>
      }
      hero={<Capture priority src="/blog/macos27/notes-recently-deleted-window" width={1520} height={1003} maxWidth={760}
        phone={{ src: "/blog/macos27/notes-recently-deleted", width: 842, height: 543 }}
        alt="The Apple Notes window on macOS 27 with Recently Deleted selected in the sidebar. Above the list Notes says: Deleted notes are removed from your devices after 30 days, which may require Notes to be open. Permanent deletion from iCloud may take up to 40 more days. Two deleted notes are listed, Fresh pasta dough and Gift ideas, and Fresh pasta dough is open."
        caption="Recently Deleted in Notes on macOS 27, with two notes deleted a minute earlier. iPhone and iCloud.com have the same folder." />}
      faq={FAQ}
    >
      <h2 id="which-applies">Where did my note go?</h2>
      <p>Up to three questions, and it tells you where to look.</p>
      <RecoverChooser />

      <h2 id="make-sure">First, make sure it&apos;s really gone</h2>
      <p>
        Notes go missing more often than they get deleted. Apple&apos;s <a href="https://support.apple.com/en-us/102476" rel="noopener">missing
        notes article</a> suggests these checks first:
      </p>
      <ul>
        <li><strong>Search everything.</strong> In the notes list, search for a word from the note with All Accounts selected. Search only sees the title of locked notes, so check those by hand.</li>
        <li><strong>Check each account.</strong> In Settings, Apps, Notes, Notes Accounts, make sure Notes is turned on for every account, such as Gmail or Yahoo. A note in an account that&apos;s switched off disappears from the list.</li>
        <li><strong>Check other folders.</strong> A note can end up in a folder you didn&apos;t expect.</li>
      </ul>

      <h2 id="within-30-days">Within 30 days: Recently Deleted</h2>
      <p>
        A deleted note moves to Recently Deleted on all your devices and on iCloud.com, and stays there for 30 days. The folder only shows
        up when it has something in it. The first time you delete a note on a Mac, Notes says so itself:
      </p>
      <Capture src="/blog/macos27/notes-deleted-dialog" width={520} height={326} maxWidth={260}
        alt="Apple Notes on macOS 27: Deleted notes are moved to the Recently Deleted folder. You can recover or remove from Recently Deleted within 30 days. OK."
        caption="Notes on macOS 27, the first time you delete a note." />
      <p className="label"><strong>On a Mac</strong></p>
      <Steps>
        <li>In Notes, click Recently Deleted in the sidebar.</li>
        <li>Control-click the note, choose Move to, then pick a folder. Dragging it onto a folder in the sidebar works too.</li>
      </Steps>
      <Capture src="/blog/macos27/notes-move-to-menu" width={490} height={304} maxWidth={245}
        alt="The menu for a note in Recently Deleted on macOS 27: New Note, Move to and Delete. Move to is open, listing Quick Notes, Math Notes, Call Recordings and Notes, with Notes highlighted."
        caption="Control-click a note in Recently Deleted on macOS 27. Choosing Notes put it straight back." />
      <p className="label"><strong>On iPhone</strong></p>
      <Steps>
        <li>In Notes, go back to the folder list and tap Recently Deleted.</li>
        <li>Swipe left on the note, tap Move, and choose a folder.</li>
      </Steps>
      <p className="label"><strong>On iCloud.com, from any browser</strong></p>
      <Steps>
        <li>Go to icloud.com/notes and sign in.</li>
        <li>Select Recently Deleted, select the note, then select Recover. It moves to the Notes folder.</li>
      </Steps>
      <p>
        The iPhone and iCloud.com steps are Apple&apos;s, from its <a href="https://support.apple.com/guide/iphone/iph904eee369/ios" rel="noopener">iPhone</a>{" "}
        and <a href="https://support.apple.com/guide/icloud/mm2f42f05cb9/icloud" rel="noopener">iCloud.com</a> guides; the Mac steps are from
        Notes on macOS 27 and Apple&apos;s <a href="https://support.apple.com/guide/notes/not5585d71a8/mac" rel="noopener">Mac guide</a>.
        The line at the top of Recently Deleted says permanent deletion from iCloud may take up to 40 more days. That&apos;s Apple clearing its
        own copy; there&apos;s no way to get a note back in that time.
      </p>

      <h2 id="mail-accounts">Notes in Gmail, Yahoo and other accounts</h2>
      <p>
        Notes in a mail account don&apos;t use Recently Deleted. The account usually keeps a deleted note in its Trash, which you&apos;ll find in
        the Mail app. To get it back, copy it from Trash and paste it into a new note. Those accounts keep their own rules for how long
        Trash is kept.
      </p>

      <h2 id="after-30-days">After 30 days</h2>
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
        Be careful with recovery apps that promise more, and with any that ask for your Apple Account password to try.
      </p>

      <h2 id="next-time">So it doesn&apos;t happen again</h2>
      <ul>
        <li>Keep a copy of the notes you can&apos;t lose: <a href="/blog/export-apple-notes-to-markdown">export them to Markdown</a>, one at a time or with an exporter for everything.</li>
        <li>On a Mac, turn on Time Machine. <a href="/blog/back-up-apple-notes">How to back up Apple Notes</a> has a routine that covers the rest.</li>
        <li>If you lock notes, know the password; a forgotten one is its own problem, covered in <a href="/blog/forgot-apple-notes-password">forgot your Apple Notes password</a>.</li>
      </ul>

      <h2 id="amber-notes">The gap Recently Deleted doesn&apos;t cover</h2>
      <p>
        Recently Deleted only helps when the whole note is gone. If you, or an app, change a note and remove the part you needed, Apple Notes
        has nothing to go back to: it keeps no version history.
      </p>
      <p>
        That&apos;s one of the things I built into Pinto Notes, the notes app for iPhone and Mac I make. Deleted notes stay in Recently
        Deleted for 30 days, as in Apple Notes, and every note also keeps its earlier versions, with who made each change. You can restore
        one from File, Show Version History, including after ChatGPT or Claude edits it. It doesn&apos;t bring back notes you lost in Apple
        Notes; <a href="/blog/move-from-apple-notes">moving from Apple Notes</a> is one import on your Mac, and Apple Notes stays as it is.
      </p>
      <Figure shot={SHOTS.history} caption="Version history in Pinto Notes on a Mac: each earlier version, who made it, and Restore This Version." />
      <PostCta slug="recover-deleted-apple-notes" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>Recently Deleted for 30 days, earlier versions of every note, and notes ChatGPT and Claude can use when you allow it.</p>
      </PostCta>
    </PostPage>
  );
}
