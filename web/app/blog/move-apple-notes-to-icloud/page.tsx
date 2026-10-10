import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Checklist, Paths, Steps } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("move-apple-notes-to-icloud", { title: "Move Apple Notes from On My iPhone or Gmail to iCloud" });

// Checked on 2 October 2026 against Apple's iPhone User Guide (iOS 26 and 27: accounts in Notes, folders,
// Notes settings, locking), the Notes User Guide for Mac (macOS 26 and 27: accounts and folders, adding
// accounts, folders, shared notes, locking), and Apple Support 118442, 102476, 102537 and 108770. The
// Mac app's own messages (sharing needs iCloud, the IMAP limits, turning off On My Mac) were read from
// Notes' Localizable.loctable on macOS 26.5, and the settings shown are Notes' own Settings storyboard.
// Rewritten answer first on 10 October: same facts, no new claims about Apple Notes. Pinto Notes: sign-in and
// sync between devices are PaneApp.swift and SyncEngine.swift, and the Apple Notes import is
// AppleNotesImport.swift, on main on 10 October.

const FAQ = [
  { q: "Why are some of my notes in On My iPhone?", a: [
    "On My iPhone is an account for notes kept only on that phone. It appears once it's turned on in Settings, Apps, Notes, and new notes made by Siri or the Notes widget go to whichever account is set as the Default Account there.",
  ] },
  { q: "Will moving notes to iCloud remove them from my iPhone?", a: [
    "No. iCloud notes stay on your iPhone and also appear on every other device signed in to the same Apple Account with Notes turned on for iCloud.",
  ] },
  { q: "Can I move Gmail notes to iCloud?", a: [
    "Yes. Gmail notes show up as their own account in Notes, and you move them into an iCloud folder the same way as notes from On My iPhone. Afterwards you can turn off Notes for the Gmail account.",
  ] },
  { q: "Why can't I lock my Gmail notes?", a: [
    "Apple says notes that sync over IMAP, with accounts like Gmail and Yahoo, can't be locked. Once a note is in iCloud you can lock it, unless it has tags or a file attached, such as a PDF or a recording.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="move-apple-notes-to-icloud"
      intro={<>Some of your notes are under On My iPhone or Gmail, so they never show up on your other devices. Moving them into iCloud takes a few taps on iPhone or one drag on a Mac.</>}
      answer={
        <Answer jump={[
          { href: "#where", label: "See where your notes are" },
          { href: "#before", label: "What can get lost" },
          { href: "#iphone", label: "On iPhone" },
          { href: "#mac", label: "On a Mac" },
          { href: "#gmail", label: "Gmail notes" },
          { href: "#after", label: "After the move" },
        ]}>
          <p>
            On iPhone, open the folder under On My iPhone or Gmail, tap the More button, tap Select Notes, pick the notes, tap the
            Folder button and choose a folder under iCloud. On a Mac, drag the notes onto an iCloud folder in the sidebar, and hold
            Option to copy them instead of moving them. Take the lock off locked notes first, and make iCloud the default account
            afterwards, or new notes keep landing in the old one.
          </p>
        </Answer>
      }
      // Nothing above the intro. The Default account capture sits in "After the move", where it's used.
      hero={<></>}
      faq={FAQ}
    >
      <h2 id="where">See where your notes are</h2>
      <p>
        Notes groups folders by account, under headings such as iCloud, On My iPhone and Gmail. The heading a note sits under decides
        whether it reaches your other devices: only iCloud notes do, with every feature.
      </p>
      <p>On iPhone, go back to the folders list in Notes. On a Mac the same groups are in the sidebar. If it&apos;s hidden:</p>
      <Paths rows={[
        { on: "Mac, macOS 27", steps: ["View", "Show Sidebar"] },
        { on: "Mac, macOS 26", steps: ["View", "Show Folders"] },
      ]} />
      <p>If there&apos;s no iCloud heading at all, Notes is turned off for iCloud. Turn it on here:</p>
      <Paths rows={[
        { on: "iPhone, iOS 27", steps: ["Settings", "Your name", "iCloud", "See All", "Notes"] },
        { on: "iPhone, iOS 26", steps: ["Settings", "Your name", "iCloud", "Notes"] },
      ]} />
      <p>
        If your notes are already under iCloud and still don&apos;t reach your other devices, the problem is somewhere else:{" "}
        <a href="/blog/apple-notes-not-syncing">Apple Notes not syncing between iPhone and Mac</a> finds it.
      </p>

      <h2 id="before">Before you move anything: what can get lost</h2>
      <p>
        Apple&apos;s guide warns that moving notes from one account to another can permanently lose formatting and attachments. So
        keep the originals until you&apos;ve looked at the moved notes.
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">In the note</th><th scope="col">What Apple says</th><th scope="col">What to do first</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Formatting and attachments</th><td>Can be lost for good in the move</td><td>On a Mac, hold Option while you drag. Notes copies instead of moving</td></tr>
            <tr><th scope="row">Drawings</th><td>Can turn into image files you can no longer edit as drawings</td><td>The same: copy first, then check</td></tr>
            <tr><th scope="row">A lock</th><td>Locked notes move only between iCloud and the account on your Mac, and may need unlocking first</td><td>Remove the lock, move the note, lock it again in iCloud</td></tr>
            <tr><th scope="row">Sharing</th><td>Only iCloud notes can be shared, so a shared note is already there</td><td>Nothing</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Apple&apos;s iPhone guide describes moving only, with no way to copy. So on iPhone, back up first: notes in On My iPhone are
        part of your iPhone backup, and <a href="/blog/back-up-apple-notes">how to back up Apple Notes</a> covers the rest.
      </p>
      <p>
        To take the lock off a note on iPhone, tap the locked note, tap View Note and unlock it, then tap the More button and choose
        Remove. Each account can have its own notes password. If you&apos;ve lost the password for a locked note, nobody can open it,
        and <a href="/blog/forgot-apple-notes-password">what to do if you forgot your Apple Notes password</a> explains why.
      </p>
      <p>
        One more thing if you use two Apple Accounts: Apple&apos;s Mac guide says a shared note can only move between folders in the
        same iCloud account.
      </p>

      <h2 id="iphone">Move notes on iPhone</h2>
      <Steps>
        <li>
          <strong>Open the folder that holds the notes</strong>
          For example Notes under On My iPhone, or Notes under Gmail.
        </li>
        <li>
          <strong>Tap the More button, then Select Notes</strong>
          Tap each note you want to move.
        </li>
        <li>
          <strong>Tap the Folder button and choose a folder under iCloud</strong>
          The notes leave the old account and appear in that folder.
        </li>
      </Steps>
      <p>
        For a single note, touch and hold it, tap Move and choose the folder. To bring a whole folder across, create a folder with the
        same name under iCloud and move its notes into it.
      </p>

      <h2 id="mac">Move notes on a Mac</h2>
      <Steps>
        <li>
          <strong>Select the notes in the list</strong>
          They can come from On My Mac, Gmail or any other account in the sidebar.
        </li>
        <li>
          <strong>Drag them onto a folder under iCloud in the sidebar</strong>
          Hold Option as you drop to get copies and keep the originals.
        </li>
      </Steps>
      <p>
        On My Mac is the Mac&apos;s own local account, like On My iPhone. Once it&apos;s empty you can turn it off by clearing Enable
        the On My Mac account in Notes, Settings. Notes won&apos;t turn it off while it still holds notes, and asks you to move or
        delete them first.
      </p>

      <h2 id="gmail">Gmail notes are different</h2>
      <p>
        Notes in a Gmail account are kept in your Google account and sync with Notes over IMAP, the protocol Mail uses. Apple says
        many Notes features don&apos;t work there. What that means in practice:
      </p>
      <ul>
        <li>They can&apos;t be locked.</li>
        <li>On macOS 26, Notes turns down <a href="/blog/apple-notes-tags-smart-folders">tags</a> and pinning in an IMAP account, with a message saying they aren&apos;t supported.</li>
        <li>When you delete one, Gmail usually keeps it in that account&apos;s Trash in the Mail app rather than in Recently Deleted.</li>
      </ul>
      <p>
        Apple says notes moved from another account into iCloud can use every feature. To stop the Gmail account syncing notes once
        it&apos;s empty, turn off Notes for it. Mail keeps working, and any notes still in Gmail stay in your Google account.
      </p>
      <Paths rows={[
        { on: "iPhone", steps: ["Settings", "Apps", "Notes", "Notes Accounts", "Gmail", "Notes"] },
      ]} />

      <h2 id="after">After the move</h2>
      <p>Four things, and the first is the one people skip.</p>
      <Checklist title="After moving notes to iCloud" items={[
        "Set iCloud as the default account, so Siri and the widget stop using the old one",
        "Open a few moved notes and check the formatting, attachments and drawings",
        "Lock again the notes you unlocked for the move",
        "Turn off Notes for the Gmail account, or On My Mac, once it's empty",
      ]} note="Copy gives you plain lines. In Apple Notes, select them and tap the checklist button." />
      <p>The default account is set here:</p>
      <Paths rows={[
        { on: "iPhone", steps: ["Settings", "Apps", "Notes", "Default Account"] },
        { on: "Mac", steps: ["Notes", "Settings", "Default account"] },
      ]} />
      <Figure shot={SHOTS.notesDefaultAccount} ground="sky" caption="Notes, Settings on a Mac running macOS 26. Default account is where new notes land, and Notes says Siri uses it when creating notes." />
      <p>
        Moving also changes what your iPhone&apos;s iCloud backup holds. Notes in On My iPhone are part of it, and Apple leaves out
        notes that are already stored in iCloud. Deleting a note in iCloud removes it from every device after 30 days in Recently
        Deleted, so keep a copy of your own as well.
      </p>

      <h2 id="pinto-notes">A notes app without accounts to sort out</h2>
      <p>
        Pinto Notes, the notes app for iPhone and Mac that I make, has no On My iPhone and no mail accounts. You sign in once, and
        every note syncs between your devices. ChatGPT and Claude can read and edit those notes after you approve them.
      </p>
      <p>
        It won&apos;t tidy up Apple Notes for you, and it has no Windows, Android or web version. <a
        href="/blog/move-from-apple-notes">Moving from Apple Notes</a> takes one import on your Mac and leaves Apple Notes as it was.
      </p>
      <PostCta slug="move-apple-notes-to-icloud" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>One sign-in, and every note is on every device you use.</p>
      </PostCta>
    </PostPage>
  );
}
