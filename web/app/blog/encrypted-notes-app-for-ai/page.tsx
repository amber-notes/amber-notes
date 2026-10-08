import { PostPage, postMetadata } from "@/lib/PostPage";
import { APP_STORE_LIVE } from "@/lib/site";
import { PRIVACY_PATH, READABLE } from "@/lib/privacy";

export const dynamic = "force-static";
export const metadata = postMetadata("encrypted-notes-app-for-ai", { title: "An encrypted notes app ChatGPT and Claude can use" });

const FAQ = [
  { q: "Is Amber Notes end-to-end encrypted?", a: [
    "Yes. Your notes, their titles, folder names, file names and files, and every earlier version are encrypted on your iPhone or Mac before they're uploaded, with a key that iCloud Keychain carries between your devices. We store only the encrypted copies and can't read them.",
  ] },
  { q: "If the notes are encrypted, how can ChatGPT read them?", a: [
    "When you approve an AI on your iPhone or Mac, that connection gets a copy of your notes' key, locked with a key derived from that connection's own access token. We store only a hash of the token, so the copy can't be opened at rest; the AI sends the token with each request, and during that request our server unlocks the key in memory, reads the notes the AI asks for, and forgets the key when the request ends. Disconnecting deletes that copy.",
  ] },
  { q: "Can an AI read my locked notes?", a: [
    "No. Locked notes are encrypted a second time with a key made from your notes password, which never leaves your devices. An AI sees only their titles.",
  ] },
  { q: "What can Amber Notes still see?", a: [
    "Account details and structure, not content: your email address, the size and dates of notes, which folder each note is in, which notes are pinned or locked, your devices and your AI connections. The Privacy & Security page lists everything.",
  ] },
  { q: "Can I change my encryption key?", a: [
    "Not yet. Your notes' key stays the same for the life of your account. Disconnecting an AI deletes its copy of the key, but key rotation isn't built yet.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="encrypted-notes-app-for-ai"
      intro={<>Amber Notes now encrypts every note end to end, on your iPhone or Mac, and ChatGPT and Claude can still read and edit them once you approve. Those two things pull against each other, so here&apos;s exactly how it works, what it doesn&apos;t protect, and how other notes apps handle the same trade-off.</>}
      faq={FAQ}
    >
      <h2>What&apos;s encrypted</h2>
      <p>
        Your notes, their titles, folder names, file names and files, and every earlier version are encrypted on your device before
        they&apos;re uploaded. The key is made on your first device. iCloud Keychain carries it to your other iPhone and Mac, and Apple
        encrypts iCloud Keychain end to end too. We store only the encrypted copies, in Frankfurt, and we can&apos;t read them.
      </p>
      <ul>
        <li><strong>Your recovery key</strong> is the fallback when a device can&apos;t get the key from iCloud Keychain. You save it yourself, from Settings, Privacy &amp; Security. We keep your notes&apos; key only locked with it, and we never get the recovery key.</li>
        <li><strong>Locked notes</strong> are encrypted a second time, with a key made from your notes password. That key never leaves your devices.</li>
        <li><strong>Signing in</strong>, with Apple or a password, only says who you are. Your password has nothing to do with your notes&apos; key.</li>
      </ul>

      <h2>How an AI reads encrypted notes</h2>
      <p>
        ChatGPT and Claude run in the cloud, so something has to open your notes for them. Here&apos;s how it goes:
      </p>
      <ol>
        <li>You start connecting from ChatGPT or Claude. A page on ambernotes.app asks you to sign in and shows a two-digit number.</li>
        <li>Amber Notes on your iPhone or Mac asks whether to allow it. You type the number, choose Read Only or Read and Edit, and confirm with Face ID, Touch ID or your passcode.</li>
        <li>That connection gets a copy of your notes&apos; key, locked with a key derived from its own access token. We keep only a hash of the token, so the copy stays locked at rest.</li>
        <li>The AI sends its token with each request. During that request, our server uses it to unlock the key in memory, reads the notes it asks for, encrypts any change it makes, and forgets the key when the request ends.</li>
        <li>Disconnect it in Settings, Connect an AI, and its copy of the key is deleted at once.</li>
      </ol>
      <p>
        So the honest version is: we can&apos;t read your notes at rest, but while an AI you approved is connected, our server opens the
        notes it asks for, in memory, to answer it. Locked notes stay out of reach even then; an AI sees only their titles. The consent
        sheet says so before you allow anything.
      </p>

      <h2>The limits</h2>
      <ul>
        <li><strong>AI requests.</strong> While an AI works, our server handles the text it asks for, and our hosts (Vercel and Supabase) carry that text on its way. Neither stores it, but a changed server could copy it. Disconnecting ends this at once.</li>
        <li><strong>The recovery key in the browser.</strong> Approving on ambernotes.app with your recovery key runs our code in your browser. It never stores or sends the key, but a changed page could read it. Approve from your iPhone or Mac when you can.</li>
        <li><strong>No key rotation yet.</strong> Your notes&apos; key stays the same for the life of your account.</li>
        <li><strong>The database.</strong> Someone running it can&apos;t read your notes, but could roll a note back to an earlier encrypted version, or hide notes from your devices.</li>
        <li><strong>Shared notes.</strong> A note you share as a web page is published as a readable copy while it&apos;s shared.</li>
      </ul>
      <p>Some details also stay readable to us, including:</p>
      <ul>
        {READABLE.slice(0, 8).map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p>
        The full list, every log and how long each is kept are on <a href={PRIVACY_PATH}>Privacy &amp; Security</a>, and the code is
        open source.
      </p>

      <h2>How other notes apps handle it</h2>
      <p>
        End-to-end encryption and a cloud AI want opposite things: the first keeps the server blind, and the second needs someone to
        read the text. Every app picks a side, or finds a way round it on your own computer.
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">App</th><th scope="col">End-to-end encrypted</th><th scope="col">Can a cloud AI reach it?</th><th scope="col">How</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Amber Notes</th><td>Yes, every note; key in iCloud Keychain</td><td>Yes, from any device</td><td>Built-in MCP server; our server opens the notes an approved AI asks for, during its requests</td></tr>
            <tr><th scope="row">Apple Notes</th><td>With <a href="https://support.apple.com/en-us/102651" rel="noopener">Advanced Data Protection</a> turned on; locked notes always</td><td>No</td><td>No API; Claude&apos;s desktop extension and community servers work on your Mac only</td></tr>
            <tr><th scope="row">Standard Notes</th><td>Yes, <a href="https://standardnotes.com/help/3/how-does-standard-notes-secure-my-notes" rel="noopener">keys from your password</a></td><td>No official way</td><td>A <a href="https://github.com/lozit/mcp-standardnotes" rel="noopener">community MCP server</a> decrypts on your own computer, for Claude Desktop</td></tr>
            <tr><th scope="row">Notesnook</th><td>Yes</td><td>No official way</td><td>No official MCP server; third-party ones exist, so check how they get your key</td></tr>
            <tr><th scope="row">Obsidian</th><td>Files are local; <a href="https://obsidian.md/help/sync/security" rel="noopener">Obsidian Sync</a> is end to end</td><td>No official way</td><td>Community plugins and servers on your computer</td></tr>
            <tr><th scope="row">Notion</th><td>No; <a href="https://www.notion.com/help/security-and-privacy" rel="noopener">encrypted at rest</a>, readable to Notion</td><td>Yes</td><td>Official hosted MCP server</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        If you never want a server to see your text, a local setup is the stricter choice: Standard Notes with a local MCP server, or
        Obsidian with a plugin, works while that computer is on. If you want ChatGPT on your phone to add to a list while you&apos;re out,
        something in the cloud has to read it, and the question becomes who, when, and whether you can see and end it. Amber Notes&apos;
        answer is: only for an AI you approved on your own device, only during its requests, never for locked notes, and never at rest.
      </p>
      <p>
        <a href="/blog/notes-apps-with-mcp">Notes apps with an MCP server, compared</a> covers the AI side in more depth, and <a href="/blog/apple-notes-mcp">Apple
        Notes MCP servers compared</a> covers the Mac-only route for Apple Notes.
      </p>

      <h2>Try it</h2>
      <p>
        Amber Notes is free and open source. The Mac app is on the <a href="/download">download page</a>, and the iPhone app is{" "}
        {APP_STORE_LIVE ? "on the App Store" : "in App Store review"}. Import your Apple Notes on the Mac, then <a href="/blog/connect-chatgpt-to-your-notes">connect
        ChatGPT or Claude</a>. You can pick Read Only first and see what it does.
      </p>
    </PostPage>
  );
}
