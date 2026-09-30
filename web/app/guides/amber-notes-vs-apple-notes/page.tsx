import type { Metadata } from "next";
import { GuidePage } from "@/lib/GuidePage";
import { pageMetadata } from "@/lib/site";

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Amber Notes vs Apple Notes: an honest comparison",
  description: "What Amber Notes adds to the Apple Notes way of writing, what Apple Notes still does better, and who each one is for.",
  path: "/guides/amber-notes-vs-apple-notes",
});

const ROWS: [string, string, string][] = [
  ["Price", "Free", "Free"],
  ["Devices", "Mac now; iPhone coming soon to the App Store", "Every Apple device, and iCloud.com in a browser"],
  ["Folders, pins, checklists, tables", "Yes", "Yes"],
  ["ChatGPT and Claude can find, read and edit notes", "Yes, with your approval (MCP)", "No"],
  ["Claude Code and Codex", "Yes", "No"],
  ["Version history", "Yes, including every change an AI makes", "No"],
  ["Stored as markdown", "Yes, formatted on screen", "No, but a note can be exported as markdown"],
  ["Share a note", "As a read-only web page, with a link you can stop", "Invite people to edit with you"],
  ["Lock a note with a password", "No", "Yes"],
  ["Drawing, handwriting, scanning documents", "No", "Yes"],
  ["Sync", "Amber Notes' own sync, stored in the EU", "iCloud"],
  ["Open source", "Yes (MIT)", "No"],
];

export default function Page() {
  return (
    <GuidePage
      title="Amber Notes vs Apple Notes"
      lede="Amber Notes is built to feel like Apple Notes, with a few things it always missed. Here's where they differ, including what Apple Notes still does better."
    >
      <h2>At a glance</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Amber Notes</th><th scope="col">Apple Notes</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([what, amber, apple]) => (
              <tr key={what}><th scope="row">{what}</th><td>{amber}</td><td>{apple}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The big difference: your AI can use it</h2>
      <p>
        In Amber Notes, ChatGPT, Claude, Claude Code and Codex can search your notes, read them, write new ones and edit the ones you have,
        through MCP. You approve each assistant in the app and choose read-only, or read and edit. When one changes a note, you see what
        changed, with Undo, and the previous version stays in the note&apos;s history.
      </p>
      <p>
        With Apple Notes, ChatGPT can help with a note you have open, but it can&apos;t look through your notes or save changes on its own.
      </p>

      <h2>What Apple Notes does better</h2>
      <ul>
        <li>Drawing, handwriting and scanning documents.</li>
        <li>Locked notes with a password.</li>
        <li>Collaborating: invite people to edit a note or folder with you.</li>
        <li>It&apos;s already on every Apple device, and on the web at iCloud.com.</li>
      </ul>

      <h2>Who each one is for</h2>
      <p>
        If you want your notes to stay exactly where they are and never talk to an AI, Apple Notes is great. If you already ask ChatGPT or
        Claude for help every day and want the result in your notes instead of copying and pasting, Amber Notes is made for that.
      </p>

      <h2>Try it without giving anything up</h2>
      <p>
        The import only reads Apple Notes, so you can bring everything over and keep using both. <a href="/guides/move-from-apple-notes">Here&apos;s how to move</a>,
        or <a href="/download">download Amber Notes for Mac</a>.
      </p>
    </GuidePage>
  );
}
