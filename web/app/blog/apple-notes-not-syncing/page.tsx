import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Paths, Steps } from "@/lib/PostParts";
import { SyncChooser } from "@/lib/SyncChooser";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-not-syncing", { title: "Apple Notes not syncing between iPhone and Mac? Fixes" });

// Checked on 5 October 2026 against Apple Support 121669 (If you don't see your iCloud notes, published
// 21 March 2025), 108922 (Manage your iCloud storage, published 14 September 2026) and 102462 (If you
// can't collaborate in the Notes app, published 23 September 2026), the iCloud User Guide (Set up iCloud
// for Notes on all your devices) and the Notes User Guide for Mac (About using iCloud Notes, macOS 27
// back to 10.14). The iOS 27 Settings path is the one move-apple-notes-to-icloud checked on 2 October.
// iCloud Notes is a row on Apple's System Status page. The Mac app's own messages (unsupported features,
// a shared note whose owner's storage is full, the account security upgrade) were read from Notes'
// Localizable.loctable on macOS 26.5. Pinto Notes' sync status and Sync Now are SettingsView.swift and
// SyncEngine.swift, as shipped in 1.1.2 (checked at the mac-v1.1.2 tag on 9 October 2026). Rewritten
// answer first on 9 October: same facts, no new claims about Apple Notes.

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
      intro={<>A note you wrote on your iPhone isn&apos;t on your Mac, or the other way round. One look at icloud.com tells you which of the two devices to fix.</>}
      answer={
        <Answer jump={[
          { href: "#find-it", label: "Find the cause" },
          { href: "#where-notes-live", label: "Which notes sync" },
          { href: "#checks", label: "The checks in order" },
          { href: "#shared", label: "Shared notes" },
        ]}>
          <p>
            Apple Notes syncs through iCloud. A note reaches your other device only if it sits under the iCloud heading, and both devices
            are signed in to the same Apple Account with Notes turned on for iCloud. Check those three things first. Full iCloud storage
            and a Mac on an older macOS than your iPhone come after.
          </p>
        </Answer>
      }
      caption="Notes, Settings on a Mac running macOS 26. Default account is where new notes land, so it should say iCloud."
      faq={FAQ}
    >
      <h2 id="find-it">Find what&apos;s stopping it</h2>
      <p>Two or three questions, and it tells you the one thing to do next.</p>
      <SyncChooser />

      <h2 id="where-notes-live">Which notes sync, and where to</h2>
      <p>
        Notes groups folders by account, and the heading a note sits under decides where it goes. In Notes on a Mac, Default account
        under Notes, Settings is where new notes land (the picture above). On iPhone it&apos;s Default Account in Settings, Apps,
        Notes. Set it to iCloud, or the next note Siri makes may end up in the wrong place again.
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">The note is under</th><th scope="col">Reaches your other devices?</th><th scope="col">Good to know</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">iCloud</th><td>Yes</td><td>Every device signed in to the same Apple Account, with Notes on for iCloud</td></tr>
            <tr><th scope="row">On My iPhone</th><td>No</td><td>Stays on that iPhone. <a href="/blog/move-apple-notes-to-icloud">Move it into an iCloud folder</a></td></tr>
            <tr><th scope="row">On My Mac</th><td>No</td><td>Stays on that Mac</td></tr>
            <tr><th scope="row">Gmail or another email account</th><td>Only through that email account</td><td>It never goes through iCloud</td></tr>
            <tr><th scope="row">A note shared with you</th><td>Yes</td><td>It&apos;s stored in the owner&apos;s iCloud, so the owner&apos;s storage counts</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="checks">The checks, in order</h2>
      <Steps>
        <li id="icloud-on">
          <strong>Notes is turned on for iCloud, on both devices</strong>
          The switch is called Sync this iPhone or Sync this Mac. Apple says that if notes are still missing after you turn it on,
          restart the device and check the setting again.
          <Paths rows={[
            { on: "iPhone, iOS 27", steps: ["Settings", "Your name", "iCloud", "See All", "Notes"] },
            { on: "iPhone, iOS 26", steps: ["Settings", "Your name", "iCloud", "Notes"] },
            { on: "Mac, macOS 15 or later", steps: ["System Settings", "Your name", "iCloud", "Notes"] },
          ]} />
        </li>
        <li id="same-account">
          <strong>Both devices use the same Apple Account</strong>
          The name at the top of Settings on iPhone, and at the top of System Settings on a Mac, is the account that device syncs with.
          A work Mac signed in to a company Apple Account won&apos;t show the notes from your own iPhone.
        </li>
        <li id="icloud-has-it">
          <strong>iCloud has the note</strong>
          Open icloud.com/notes in a browser and sign in with the same Apple Account. If the note is there, the device that&apos;s missing
          it is the one to fix. If it isn&apos;t, the device where you wrote it hasn&apos;t uploaded it yet, so start with that one.
        </li>
        <li id="status">
          <strong>iCloud Notes is up</strong>
          Apple lists iCloud Notes on its System Status page, at apple.com/support/systemstatus. If it shows an outage, no setting on
          your side will fix it. Wait until Apple marks it resolved.
        </li>
        <li id="storage">
          <strong>Your iCloud storage isn&apos;t full</strong>
          Apple says that when iCloud storage is full, iCloud apps don&apos;t stay up to date across your devices, and Notes is one of
          them. Open Settings, tap your name, then iCloud to see how much you&apos;re using. Freeing some space or moving to a bigger plan
          lets syncing continue.
        </li>
        <li id="update">
          <strong>Neither device is behind on updates</strong>
          A note made with a newer version of Notes can use features an older one doesn&apos;t have. On a Mac, Notes then shows it with
          the message &ldquo;This note uses unsupported features. To view or edit it, upgrade to the latest version of macOS.&rdquo; The
          note has synced, but this Mac can&apos;t open it. Since iOS 27 came out on 14 September, an iPhone on iOS 27 with a Mac still on
          macOS 26 is the likely setup, and updating the Mac to macOS 27 is the fix.
        </li>
      </Steps>
      <p>
        Apple doesn&apos;t document a button that forces a sync, so there&apos;s nothing to press. For much older devices, Apple&apos;s
        Mac guide says upgraded iCloud notes can&apos;t be opened on versions earlier than OS X 10.11 or iOS 9, and that the Notes sidebar
        shows an Upgrade button next to iCloud until you upgrade.
      </p>

      <h2 id="shared">When a shared note won&apos;t update</h2>
      <ul>
        <li>Everyone needs to be signed in to an Apple Account with Notes turned on for iCloud. Apple&apos;s guide for collaborating in Notes also asks for the latest iOS.</li>
        <li>You can&apos;t collaborate on a locked note, or on a folder that holds one.</li>
        <li>A shared note is stored in its owner&apos;s iCloud. When the owner&apos;s storage is full, Notes on a Mac says your changes can&apos;t be uploaded, are saved on your device, and will be uploaded once the owner creates space.</li>
        <li>If Notes asks you to upgrade your account security &ldquo;to see edits in real time and use the latest collaboration features&rdquo;, others&apos; edits won&apos;t show live until you do.</li>
      </ul>
      <p>
        On iOS 27, sharing has moved: tap the Share button, then Share a Link or Send a Copy, and set who can edit under People you
        choose can edit.
      </p>

      <h2 id="vanished">If notes vanished from every device</h2>
      <p>
        Deleting a note on one device deletes it everywhere, which can look like a sync problem. Deleted notes stay in Recently Deleted for
        30 days on every device signed in to the same Apple Account. <a href="/blog/recover-deleted-apple-notes">How to recover deleted
        Apple Notes</a> covers that folder and what to try after the 30 days. Keeping your own copy helps too, and <a
        href="/blog/back-up-apple-notes">how to back up Apple Notes</a> shows how.
      </p>

      <h2 id="pinto-notes">A notes app that shows its sync</h2>
      <p>
        Apple Notes doesn&apos;t show when it last synced, which is why this takes six checks. Pinto Notes, the notes app for iPhone and
        Mac that I make, syncs through its own end-to-end encrypted service rather than iCloud, so iCloud storage doesn&apos;t affect it.
        Its Settings show the sync status, such as &ldquo;last synced 9:41&rdquo; or the reason it can&apos;t sync right now, next to a
        Sync Now button. If the same note changed on two devices before they synced, the newer edit wins and the other is kept as a
        conflicted copy, so neither is lost.
      </p>
      <p>
        It won&apos;t fix Apple Notes for you, and it has no Windows, Android or web version. <a href="/blog/move-from-apple-notes">Moving
        from Apple Notes</a> takes one import on your Mac and leaves Apple Notes as it was.
      </p>
      <PostCta slug="apple-notes-not-syncing" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>You can see when your notes last synced, and press Sync Now when you want to be sure.</p>
      </PostCta>
    </PostPage>
  );
}
