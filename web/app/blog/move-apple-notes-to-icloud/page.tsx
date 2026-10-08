import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("move-apple-notes-to-icloud", { title: "Move Apple Notes from On My iPhone or Gmail to iCloud" });

// Checked on 2 October 2026 against Apple's iPhone User Guide (iOS 26 and 27: accounts in Notes, folders,
// Notes settings, locking), the Notes User Guide for Mac (macOS 26 and 27: accounts and folders, adding
// accounts, folders, shared notes, locking), and Apple Support 118442, 102476, 102537 and 108770. The
// Mac app's own messages (sharing needs iCloud, the IMAP limits, turning off On My Mac) were read from
// Notes' Localizable.loctable on macOS 26.5, and the settings shown are Notes' own Settings storyboard.

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
      intro={<>Apple Notes keeps each note in an account. Most people&apos;s notes are in iCloud, but some can sit in On My iPhone, which never leaves the phone, or in an email account such as Gmail. Only iCloud notes reach all your devices with every feature, and notes in the other accounts stay put until you move them. Moving them takes a few taps on iPhone or a drag on a Mac, though locked notes and Gmail notes need some care first.</>}
      faq={FAQ}
    >
      <h2>See where your notes are</h2>
      <p>
        On iPhone, go back to the folders list in Notes. Folders are grouped by account, under headings such as iCloud and On My
        iPhone. On a Mac the same groups are in the sidebar; if it&apos;s hidden, choose View, Show Folders on macOS 26, or View, Show
        Sidebar on macOS 27.
      </p>
      <p>
        If there&apos;s no iCloud heading, turn on iCloud for Notes. On iOS 26, open Settings, tap your name, tap iCloud and turn on
        Notes. On iOS 27, tap See All next to Saved to iCloud first, then turn on Notes. If your notes are in iCloud and still don&apos;t
        reach your other devices, see <a href="/blog/apple-notes-not-syncing">Apple Notes not syncing between iPhone and Mac</a>.
      </p>

      <h2>Before you move anything</h2>
      <p>
        Apple&apos;s guide warns that moving notes from one account to another can permanently lose formatting and attachments, and that
        drawings can turn into image files you can no longer edit as drawings. On a Mac, hold Option while you drag, and Notes copies the
        notes instead of moving them. Check the copies in iCloud before you delete the originals. Apple&apos;s iPhone guide describes moving
        only, so back up first: notes in On My iPhone are part of your iPhone backup, and <a href="/blog/back-up-apple-notes">how to back
        up Apple Notes</a> covers the rest.
      </p>
      <p>
        Locked notes need one more step, because Apple&apos;s Mac guide says they move only between iCloud and the account on your Mac,
        and that you may need to unlock them first. Each account can also have its own notes password. Remove the lock before you move a
        note, then lock it again once it&apos;s in iCloud. On iPhone, tap the locked note, tap View Note and unlock it. Then tap the More
        button and choose Remove. If you&apos;ve lost the password for a locked note, nobody can open it, and <a
        href="/blog/forgot-apple-notes-password">what to do if you forgot your Apple Notes password</a> explains why.
      </p>
      <p>
        Shared notes are already in iCloud, since only iCloud notes can be shared. Apple&apos;s Mac guide adds that a shared note can only
        move between folders in the same iCloud account, which matters if you use two Apple Accounts.
      </p>

      <h2>Move notes on iPhone</h2>
      <ol>
        <li>Open the folder that holds the notes, such as Notes under On My iPhone or under Gmail.</li>
        <li>Tap the More button, then Select Notes, and tap each note you want to move. Tap the Folder button and choose a folder under iCloud.</li>
      </ol>
      <p>
        For a single note, touch and hold it, tap Move and choose the folder. To bring a whole folder across, create a folder with the same
        name under iCloud and move its notes into it.
      </p>

      <h2>Move notes on a Mac</h2>
      <p>
        Select the notes in the list, then drag them onto a folder under iCloud in the sidebar. Hold Option as you drop if you want copies
        first.
      </p>
      <p>
        The same applies to On My Mac, the Mac&apos;s own local account. Once it&apos;s empty you can turn it off by clearing Enable the On My
        Mac account in Notes, Settings. Notes won&apos;t turn it off while it still holds notes, and asks you to move or delete them first.
      </p>

      <h2>Gmail notes are different</h2>
      <p>
        Notes in a Gmail account are kept in your Google account and sync with Notes over IMAP, the protocol Mail uses. Apple says many
        Notes features don&apos;t work there, and those notes can&apos;t be locked. On macOS 26, Notes also turns down <a href="/blog/apple-notes-tags-smart-folders">tags</a> and pinning in
        an IMAP account, with a message saying they aren&apos;t supported. When you delete one, Gmail usually keeps it in that
        account&apos;s Trash in the Mail app rather than in Recently Deleted.
      </p>
      <p>
        Apple says notes moved from another account into iCloud can use every feature. To stop the Gmail account syncing notes once
        it&apos;s empty, open Settings, tap Apps, then Notes, then Notes Accounts, tap the Gmail account and turn off Notes. Mail keeps
        working, and any notes still in Gmail stay in your Google account.
      </p>

      <h2>After the move</h2>
      <p>
        Set iCloud as the default account, or the next note Siri makes may go back into the old account. On iPhone it&apos;s Default
        Account in Settings, Apps, Notes. On a Mac it&apos;s Default account in Notes, Settings, which Notes says Siri uses when creating
        notes.
      </p>
      <p>
        Moving also changes what your iPhone&apos;s iCloud backup holds. Notes in On My iPhone are part of it, and Apple leaves out notes
        that are already stored in iCloud. Deleting a note in iCloud removes it from every device after 30 days in Recently Deleted, so
        keep a copy of your own as well.
      </p>

      <h2>Moving to another notes app</h2>
      <p>
        Pinto Notes, the notes app for iPhone and Mac that I make, syncs every note between your devices once you sign in, and ChatGPT
        and Claude can read and edit those notes after you approve them. <a href="/blog/move-from-apple-notes">Moving from Apple
        Notes</a> takes one import on your Mac and leaves Apple Notes as it was.
      </p>
    </PostPage>
  );
}
