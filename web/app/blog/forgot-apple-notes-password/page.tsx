import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("forgot-apple-notes-password");

const FAQ = [
  { q: "Can Apple recover my locked notes if I forget the password?", a: [
    "No. Apple says it doesn't have access to locked notes and can't help you open them if you forget your notes password. Locked notes are end-to-end encrypted with a key made from that password.",
  ] },
  { q: "Does resetting the Notes password unlock my old notes?", a: [
    "No. Resetting lets you lock new notes with a new password. Notes you locked before keep the old password, and still need it to open.",
  ] },
  { q: "Can I open a locked note with Face ID or Touch ID?", a: [
    "Try it: if you turned on Face ID or Touch ID for Notes, Apple lists it as a way to view a locked note. It can't be used to change the password, which always needs the current one.",
  ] },
  { q: "Do apps that promise to unlock Apple Notes work?", a: [
    "They can't decrypt a locked note without its password. The key is made from the password, so the most any tool can do is guess passwords. Be wary of anything that asks for your Apple Account password to do it.",
  ] },
  { q: "How do I avoid this next time?", a: [
    "Use your device passcode instead of a separate notes password (iOS 16 or later, with iCloud Keychain on), or keep the notes password in a password manager.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="forgot-apple-notes-password"
      intro={<>If you&apos;ve forgotten the password for your locked notes, the honest news first: nobody can recover it, not Apple and not an unlock app. But there are a few things worth trying before you give up, and one thing you shouldn&apos;t do first. Here&apos;s the order I&apos;d go in.</>}
      faq={FAQ}
    >
      <h2>Why nobody can open it for you</h2>
      <p>
        A locked note is end-to-end encrypted with a key made from your notes password. Apple&apos;s security guide describes it: the key
        is derived from your passphrase, and the note and its attachments are encrypted with it. Apple
        says <a href="https://support.apple.com/en-us/102537" rel="noopener">it doesn&apos;t have access to locked notes</a> and can&apos;t
        help if you forget the password. That&apos;s the point of locking a note, and it&apos;s also why resetting the password can&apos;t
        bring old notes back.
      </p>

      <h2>Try these first</h2>
      <ol>
        <li>
          <strong>Face ID or Touch ID.</strong> If you turned it on for Notes, open the locked note and use it. Apple lists it as a way to
          view a locked note.
        </li>
        <li>
          <strong>The hint.</strong> Enter a wrong password a couple of times and Notes shows the hint you set, if you set one.
        </li>
        <li>
          <strong>Your device passcode or Mac login password.</strong> Since iOS 16, notes can be locked with the device passcode instead of
          a separate password. If you chose that, use your iPhone passcode, or your Mac&apos;s login password on the Mac.
        </li>
        <li>
          <strong>Older passwords.</strong> If you ever reset your notes password, older notes keep the password they were locked with.
          When you enter the current one on an older note, Notes tells you it&apos;s wrong and shows the hint for the old one.
        </li>
        <li>
          <strong>A password manager.</strong> If you use one, search it for &ldquo;notes&rdquo;; you may have saved the password there when you
          set it.
        </li>
      </ol>
      <p>
        Don&apos;t reset first. Resetting is safe, and it won&apos;t delete anything, but once you have two passwords it gets harder to tell
        which note needs which.
      </p>

      <h2>Reset the password (for new notes)</h2>
      <p>
        If none of that works, reset it so you can keep locking new notes. The old locked notes stay as they are, and still open with the
        old password if you ever remember it.
      </p>
      <p className="label"><strong>On iPhone</strong></p>
      <ol>
        <li>Open Settings, tap Apps, then Notes, then Password.</li>
        <li>Choose the account, then tap Reset Password.</li>
        <li>Enter your Apple Account password and tap OK, then tap Reset Password again.</li>
        <li>Choose your device passcode, or enter a new password and a hint, then tap Done.</li>
      </ol>
      <p className="label"><strong>On a Mac</strong></p>
      <ol>
        <li>In Notes, choose Notes, Settings, then Reset Password, and click OK.</li>
        <li>For an iCloud account, enter your iCloud password.</li>
        <li>Click Reset Password again, enter the new password twice and a hint, then click Set Password.</li>
      </ol>
      <p>
        The steps are from Apple: <a href="https://support.apple.com/en-us/102537" rel="noopener">How to lock or unlock notes on your
        iPhone</a> and <a href="https://support.apple.com/guide/notes/apdb021fd5a9/mac" rel="noopener">Change your password for locked
        notes</a> on Mac. If you still know the password and just want a new one, choose Change Password instead: that moves every locked
        note to the new password, so you don&apos;t end up with two.
      </p>

      <h2>About unlock apps</h2>
      <p>
        Search results for this are full of apps that promise to unlock Apple Notes. None of them can decrypt a locked note without its
        password; the most they can do is try passwords for you. If one asks for your Apple Account password or your backup, think hard
        about what you&apos;re handing over.
      </p>

      <h2>So it doesn&apos;t happen again</h2>
      <ul>
        <li>Switch to your device passcode: Settings, Apps, Notes, Password, Use Device Passcode. It needs iCloud Keychain on.</li>
        <li>Or keep your notes password in a password manager.</li>
        <li>Turn on Face ID or Touch ID for Notes, so you rarely have to type it.</li>
        <li>Unlock and <a href="/blog/export-apple-notes-to-markdown">export</a> anything you can&apos;t afford to lose, and keep a copy somewhere safe.</li>
      </ul>

      <h2>If you&apos;re moving to another app</h2>
      <p>
        Locked notes can&apos;t be read without the password, so exporters and importers leave them behind. That includes
        Amber Notes&apos; <a href="/blog/move-from-apple-notes">import from Apple Notes</a>: unlock the notes you need first, or they stay
        behind in Apple Notes. Amber Notes has locked notes too, and they work the same way: encrypted with your notes password on your
        device, unreadable to us and to any AI you connect, and impossible to recover if you forget the password. Everything else in
        Amber Notes is end-to-end encrypted as well; <a href="/blog/encrypted-notes-app-for-ai">how that works with ChatGPT and Claude</a> has the details.
      </p>
    </PostPage>
  );
}
