import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Paths, Steps } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("forgot-apple-notes-password", { title: "Forgot your Apple Notes password? What works" });

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
      intro={<>Forgot the password for your locked notes? Here&apos;s what&apos;s worth trying, in the order I&apos;d go, and the one thing not to do first.</>}
      answer={
        <Answer jump={[
          { href: "#try-these-first", label: "Try these first" },
          { href: "#reset-on-iphone", label: "Reset on iPhone" },
          { href: "#reset-on-a-mac", label: "Reset on a Mac" },
          { href: "#next-time", label: "Avoid it next time" },
        ]}>
          <p>Nobody can open a locked note without its password, not Apple and not an unlock app. Before you reset, try:</p>
          <ul>
            <li>Face ID or Touch ID, if you turned it on for Notes.</li>
            <li>The hint: enter a wrong password a couple of times and Notes shows it.</li>
            <li>Your iPhone passcode, or your Mac login password.</li>
            <li>Any older notes password, and your password manager.</li>
          </ul>
          <p>If none of them work, reset the password. That lets you lock new notes; the old ones still need the old password.</p>
        </Answer>
      }
      art="/blog/art/forgot-apple-notes-password"
      faq={FAQ}
    >
      <h2 id="why">Why nobody can open it for you</h2>
      <p>
        A locked note is end-to-end encrypted with a key made from your notes password. Apple&apos;s security guide describes it: the key
        is derived from your passphrase, and the note and its attachments are encrypted with it. Apple
        says <a href="https://support.apple.com/en-us/102537" rel="noopener">it doesn&apos;t have access to locked notes</a> and can&apos;t
        help if you forget the password. That&apos;s the point of locking a note, and it&apos;s also why resetting the password can&apos;t
        bring old notes back.
      </p>

      <h2 id="try-these-first">Try these first</h2>
      <Steps>
        <li>
          <strong>Face ID or Touch ID</strong>
          If you turned it on for Notes, open the locked note and use it. Apple lists it as a way to view a locked note.
        </li>
        <li>
          <strong>The hint</strong>
          Enter a wrong password a couple of times and Notes shows the hint you set, if you set one.
        </li>
        <li>
          <strong>Your device passcode or Mac login password</strong>
          Since iOS 16, notes can be locked with the device passcode instead of a separate password. If you chose that, use your iPhone
          passcode, or your Mac&apos;s login password on the Mac.
        </li>
        <li>
          <strong>Older passwords</strong>
          If you ever reset your notes password, older notes keep the password they were locked with. When you enter the current one on an
          older note, Notes tells you it&apos;s wrong and shows the hint for the old one.
        </li>
        <li>
          <strong>A password manager</strong>
          If you use one, search it for &ldquo;notes&rdquo;; you may have saved the password there when you set it.
        </li>
      </Steps>
      <p>
        Don&apos;t reset first. Resetting is safe, and it won&apos;t delete anything, but once you have two passwords it gets harder to tell
        which note needs which.
      </p>

      <h2 id="what-works">What each option can do</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Opens a note you already locked?</th><th scope="col">Good to know</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Face ID or Touch ID</th><td>Yes, if it was on for Notes</td><td>Can&apos;t change the password; that always needs the current one</td></tr>
            <tr><th scope="row">The hint</th><td>Only by jogging your memory</td><td>Shows after a couple of wrong tries, if you set one</td></tr>
            <tr><th scope="row">Device passcode</th><td>Yes, for notes locked with it</td><td>An option since iOS 16, with iCloud Keychain on</td></tr>
            <tr><th scope="row">Reset Password</th><td>No</td><td>Sets a password for notes you lock from now on</td></tr>
            <tr><th scope="row">Apple Support</th><td>No</td><td>Apple has no access to locked notes</td></tr>
            <tr><th scope="row">Unlock apps</th><td>No</td><td>They can only guess passwords</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="reset">Reset the password (for new notes)</h2>
      <p>
        If none of that works, reset it so you can keep locking new notes. The old locked notes stay as they are, and still open with the
        old password if you ever remember it.
      </p>
      <Paths rows={[
        { on: "iPhone", steps: ["Settings", "Apps", "Notes", "Password"] },
        { on: "Mac", steps: ["Notes", "Settings", "Reset Password"] },
      ]} />
      <p className="label" id="reset-on-iphone"><strong>On iPhone</strong></p>
      <Steps>
        <li>Open Settings, tap Apps, then Notes, then Password.</li>
        <li>Choose the account, then tap Reset Password.</li>
        <li>Enter your Apple Account password and tap OK, then tap Reset Password again.</li>
        <li>Choose your device passcode, or enter a new password and a hint, then tap Done.</li>
      </Steps>
      <p className="label" id="reset-on-a-mac"><strong>On a Mac</strong></p>
      <Steps>
        <li>In Notes, choose Notes, Settings, then Reset Password, and click OK.</li>
        <li>For an iCloud account, enter your iCloud password.</li>
        <li>Click Reset Password again, enter the new password twice and a hint, then click Set Password.</li>
      </Steps>
      <p>
        The steps are from Apple: <a href="https://support.apple.com/en-us/102537" rel="noopener">How to lock or unlock notes on your
        iPhone</a> and <a href="https://support.apple.com/guide/notes/apdb021fd5a9/mac" rel="noopener">Change your password for locked
        notes</a> on Mac. If you still know the password and just want a new one, choose Change Password instead: that moves every locked
        note to the new password, so you don&apos;t end up with two.
      </p>

      <h2 id="unlock-apps">About unlock apps</h2>
      <p>
        Search results for this are full of apps that promise to unlock Apple Notes. None of them can decrypt a locked note without its
        password; the most they can do is try passwords for you. If one asks for your Apple Account password or your backup, think hard
        about what you&apos;re handing over.
      </p>

      <h2 id="next-time">So it doesn&apos;t happen again</h2>
      <ul>
        <li>Switch to your device passcode: Settings, Apps, Notes, Password, Use Device Passcode. It needs iCloud Keychain on.</li>
        <li>Or keep your notes password in a password manager.</li>
        <li>Turn on Face ID or Touch ID for Notes, so you rarely have to type it.</li>
        <li>Unlock and <a href="/blog/export-apple-notes-to-markdown">export</a> anything you can&apos;t afford to lose, and keep a copy somewhere safe.</li>
        <li>If a note is missing rather than locked, see <a href="/blog/recover-deleted-apple-notes">how to recover deleted Apple Notes</a>.</li>
      </ul>

      <h2 id="amber-notes">If you&apos;re moving to another app</h2>
      <p>
        Locked notes can&apos;t be read without the password, so exporters and importers leave them behind. That includes
        Amber Notes&apos; <a href="/blog/move-from-apple-notes">import from Apple Notes</a>: unlock the notes you need first, or they stay
        behind in Apple Notes.
      </p>
      <p>
        Amber Notes, the notes app for iPhone and Mac that I make, has locked notes too, and they work the same way: encrypted with your
        notes password on your device, unreadable to us and to any AI you connect, and impossible to recover if you forget the password. It
        says so when you set one. Everything else in Amber Notes is end-to-end encrypted as well, and ChatGPT and Claude can still
        use your other notes once you approve them; <a href="/blog/encrypted-notes-app-for-ai">how that works</a> has the details.
      </p>
      <Figure shot={SHOTS.notesPassword} caption="Setting a notes password in Amber Notes on a Mac. Like Apple's, it can't be recovered if you forget it." />
      <PostCta slug="forgot-apple-notes-password" position="how-amber-helps" title="Try Amber Notes on your Mac">
        <p>Locked notes for what&apos;s private, end-to-end encryption for everything else, and notes ChatGPT and Claude can use when you allow it.</p>
      </PostCta>
    </PostPage>
  );
}
