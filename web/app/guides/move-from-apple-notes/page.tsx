import type { Metadata } from "next";
import { GuidePage } from "@/lib/GuidePage";
import { pageMetadata } from "@/lib/site";

// Draft for Emil's approval: noindex, and not in the navigation or the sitemap until it's approved.
export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "How to move from Apple Notes to Amber Notes",
  description: "Import all your Apple Notes into Amber Notes on your Mac, with folders, checklists and tables. Apple Notes stays untouched.",
  path: "/guides/move-from-apple-notes",
  index: false,
});

export default function Page() {
  return (
    <GuidePage
      title="How to move from Apple Notes to Amber Notes"
      lede="Bring all your notes over in one go on your Mac. Nothing in Apple Notes changes, so you can take your time."
    >
      <h2>Before you start</h2>
      <ul>
        <li>A Mac with macOS 26 or later, and your notes in the Notes app on it.</li>
        <li>Amber Notes, free from the <a href="/download">download page</a>. Open it and sign in with Apple or email.</li>
      </ul>

      <h2>Import everything on your Mac</h2>
      <ol>
        <li>In Amber Notes, choose File, then Import from Apple Notes.</li>
        <li>The first time, macOS asks whether Amber Notes may control Notes. Choose OK. That&apos;s how it reads your notes.</li>
        <li>Pick everything, or just the notes you want. Notes with the same title as one you already have are marked Already imported.</li>
        <li>To keep your pinned notes pinned, turn on the pins option. It asks for Full Disk Access, because Apple Notes keeps pins where only apps with that permission can read them. Everything else imports without it.</li>
        <li>Choose Import. You can watch it count through your notes.</li>
      </ol>

      <h2>What comes along</h2>
      <ul>
        <li>Your notes, in their folders.</li>
        <li>Checklists and tables.</li>
        <li>Pins, if you turned that option on.</li>
      </ul>
      <p>Your notes in Apple Notes stay exactly as they were. The import only reads them.</p>

      <h2>On your iPhone</h2>
      <p>
        Everything you import on your Mac shows up on your iPhone a second later, once you sign in there with the same account. To bring
        over a single note from your iPhone, open it in Apple Notes, tap Share and choose Amber Notes.
      </p>

      <h2>After the move</h2>
      <ul>
        <li>If you know Apple Notes, you already know Amber Notes: folders, a note list by date, pins, search and Recently Deleted work the same way.</li>
        <li>Your notes are stored as markdown underneath, formatted on screen.</li>
        <li>Want ChatGPT or Claude to use them? <a href="/guides/connect-chatgpt-to-your-notes">Connect your AI</a>.</li>
      </ul>
    </GuidePage>
  );
}
