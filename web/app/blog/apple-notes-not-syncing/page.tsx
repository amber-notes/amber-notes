import { PostPage, postMetadata } from "@/lib/PostPage";
import { APP_STORE_LIVE } from "@/lib/site";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-not-syncing", { title: "Apple Notes not syncing between iPhone and Mac? Fixes" });

// Checked on 5 October 2026 against Apple Support 121669 (If you don't see your iCloud notes, published
// 21 March 2025), 108922 (Manage your iCloud storage, published 14 September 2026) and 102462 (If you
// can't collaborate in the Notes app, published 23 September 2026), the iCloud User Guide (Set up iCloud
// for Notes on all your devices) and the Notes User Guide for Mac (About using iCloud Notes, macOS 27
// back to 10.14). The iOS 27 Settings path is the one move-apple-notes-to-icloud checked on 2 October.
// iCloud Notes is a row on Apple's System Status page. The Mac app's own messages (unsupported features,
// a shared note whose owner's storage is full, the account security upgrade) were read from Notes'
// Localizable.loctable on macOS 26.5. Amber Notes' sync status and Sync Now are SettingsView.swift and
// SyncEngine.swift.

const FAQ = [
  { q: "Why are my notes not syncing between my iPhone and Mac?", a: [
    "Most often Notes is turned off for iCloud on one of the devices, or the two are signed in to different Apple Accounts. Notes kept in On My iPhone or in Gmail never sync through iCloud, and a full iCloud storage plan stops syncing too. Apple's own fix is to check Sync this iPhone in iCloud settings, then restart the device if notes are still missing.",
  ] },
  { q: "How do I force Apple Notes to sync?", a: [
    "Apple doesn't document a button that forces a sync. What Apple suggests is checking that Notes is turned on for iCloud and restarting the device. Opening icloud.com/notes in a browser shows whether a note made it to iCloud at all.",
  ] },
  { q: "Do notes in On My iPhone sync to my Mac?", a: [
    "No. On My iPhone is for notes kept only on that phone, and On My Mac is the same on a Mac. Move the notes into an iCloud folder and they appear on every device signed in to the same Apple Account.",
  ] },
  { q: "Why isn't a shared note updating?", a: [
    "Check that everyone is signed in to their Apple Account with Notes turned on in iCloud, and that the note isn't locked, since locked notes can't be shared. If the owner's iCloud storage is full, Notes keeps your changes on your device and uploads them once the owner frees up space.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-not-syncing"
      intro={<>Apple Notes syncs through iCloud. A note reaches your Mac only if it&apos;s stored in iCloud and both devices are signed in to the same Apple Account with Notes turned on for iCloud. When a note made on your iPhone doesn&apos;t show up on your Mac, the cause is nearly always in those settings, so check them first. Full iCloud storage and a Mac still on an older macOS than your iPhone come after that.</>}
      faq={FAQ}
    >
      <h2>1. Check that Notes is turned on for iCloud</h2>
      <p>
        On iPhone with iOS 27, open Settings, tap your name, then iCloud. Tap See All next to Saved to iCloud, tap Notes and make sure
        Sync this iPhone is on. On iOS 26, it&apos;s Settings, your name, iCloud, Notes. Apple says that if notes are still missing after
        this, restart the iPhone and check the setting again.
      </p>
      <p>
        On a Mac with macOS 15 or later, including macOS 26 and 27, choose Apple menu, System Settings, click your name, then iCloud. Under
        Saved to iCloud, click Notes and turn on Sync this Mac. In Notes, iCloud then appears in the sidebar, and choosing All iCloud shows
        every note it holds.
      </p>

      <h2>2. Check that both devices use the same Apple Account</h2>
      <p>
        Your name at the top of Settings on iPhone, and at the top of System Settings on a Mac, is the Apple Account that device syncs
        with. Apple&apos;s guide says a device that isn&apos;t signed in to the same account, or has Notes turned off, can&apos;t see your iCloud
        notes. A work Mac signed in to a company Apple Account won&apos;t show the notes from your own iPhone.
      </p>

      <h2>3. Check which account the note is in</h2>
      <p>
        Notes groups folders by account. Only notes under the iCloud heading sync. Notes under On My iPhone or On My Mac stay on that one
        device, and notes under Gmail or another email account sync with that email account, not with iCloud. If the missing note sits in
        one of those, <a href="/blog/move-apple-notes-to-icloud">move it into an iCloud folder</a>, and it reaches your other devices.
      </p>
      <p>
        Then check where new notes go, or the next note Siri makes may land in the wrong account again. On iPhone it&apos;s Default Account
        in Settings, Apps, Notes. On a Mac it&apos;s Default account in Notes, Settings, as in the picture above.
      </p>

      <h2>4. See whether iCloud has the note</h2>
      <p>
        Open icloud.com/notes in a browser and sign in with the same Apple Account. If the note is there, iCloud has it, and the device
        that&apos;s missing it is the one to fix: go back to step 1 on that device and restart it. If the note isn&apos;t there, the device
        where you wrote it hasn&apos;t uploaded it yet, so start with that one.
      </p>
      <p>
        Apple also lists iCloud Notes on its System Status page, at apple.com/support/systemstatus. If it shows an outage, no setting on
        your side will fix it, so wait until Apple marks it resolved.
      </p>

      <h2>5. Check your iCloud storage</h2>
      <p>
        Apple says that when your iCloud storage is full, iCloud Drive and other iCloud apps don&apos;t stay up to date across your
        devices, and your device stops backing up to iCloud. Notes is one of those apps. To see how much you&apos;re using, open Settings, tap
        your name, then iCloud. Freeing some space or moving to a bigger plan lets syncing continue.
      </p>

      <h2>6. Update the device that&apos;s behind</h2>
      <p>
        A note made with a newer version of Notes can use features an older one doesn&apos;t have. On a Mac, Notes then shows the note with
        the message &ldquo;This note uses unsupported features. To view or edit it, upgrade to the latest version of macOS.&rdquo; In that case the
        note has synced, but this Mac can&apos;t open it. Since iOS 27 came out on 14 September, an iPhone on iOS 27 with a Mac still on
        macOS 26 is the likely setup for this, and updating the Mac to macOS 27 is the fix.
      </p>
      <p>
        For much older devices, Apple&apos;s Mac guide says notes in iCloud that have been upgraded can&apos;t be opened on
        versions earlier than OS X 10.11 or iOS 9, and that the Notes sidebar shows an Upgrade button next to iCloud until you upgrade.
      </p>

      <h2>When a shared note won&apos;t update</h2>
      <p>
        Apple&apos;s guide for collaborating in Notes asks for an iPhone on the latest iOS, signed in to an Apple Account with Sync this
        iPhone turned on for Notes. You can&apos;t collaborate on a locked note, or on a folder that holds one. On iOS 27, sharing
        has moved: tap the Share button, then Share a Link or Send a Copy, and set who can edit under People you choose can edit.
      </p>
      <p>
        A shared note is stored in its owner&apos;s iCloud. When the owner&apos;s storage is full, Notes on a Mac says your changes can&apos;t be
        uploaded, are saved on your device, and will be uploaded once the owner creates space. If Notes asks you to upgrade your
        account security &ldquo;to see edits in real time and use the latest collaboration features&rdquo;, others&apos; edits won&apos;t
        show live until you do.
      </p>

      <h2>If notes vanished from every device</h2>
      <p>
        Deleting a note on one device deletes it everywhere, which can look like a sync problem. Deleted notes stay in Recently Deleted for
        30 days on every device signed in to the same Apple Account. <a href="/blog/recover-deleted-apple-notes">How to recover deleted
        Apple Notes</a> covers that folder and what to try after the 30 days. Keeping your own copy helps too, and <a
        href="/blog/back-up-apple-notes">how to back up Apple Notes</a> shows how.
      </p>

      <h2>A notes app that shows its sync</h2>
      <p>
        Apple Notes doesn&apos;t show when it last synced. Amber Notes, the notes app for iPhone and Mac that I make, syncs through its own
        end-to-end encrypted service rather than iCloud, so iCloud storage doesn&apos;t affect it. Its Settings show the sync status, such as
        &ldquo;last synced 9:41&rdquo; or the reason it can&apos;t sync right now, next to a Sync Now button. If the same note changed on two
        devices before they synced, the newer edit wins and the other is kept as a conflicted copy, so neither is lost.
      </p>
      {APP_STORE_LIVE ? (
        <p>
          <a href="/blog/move-from-apple-notes">Moving from Apple Notes</a> takes one import on your Mac and leaves Apple Notes as it was.
        </p>
      ) : (
        <p>
          The Mac app is out now, and the iPhone app is coming soon to the App Store. <a href="/blog/move-from-apple-notes">Moving from
          Apple Notes</a> takes one import on your Mac and leaves Apple Notes as it was.
        </p>
      )}
    </PostPage>
  );
}
