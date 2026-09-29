import type { Metadata } from "next";
import { GuidePage } from "@/lib/GuidePage";
import { pageMetadata } from "@/lib/site";

// Draft for Emil's approval: noindex, and not in the navigation or the sitemap until it's approved.
export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "How to connect ChatGPT to your notes · Amber Notes",
  shareTitle: "How to connect ChatGPT to your notes",
  description: "Let ChatGPT or Claude read and update your notes on iPhone and Mac. What you need, the steps, and how you stay in control.",
  path: "/guides/connect-chatgpt-to-your-notes",
  index: false,
});

export default function Page() {
  return (
    <GuidePage
      title="How to connect ChatGPT to your notes"
      lede="Ask ChatGPT to add to a list, plan a trip or tidy a note, and the change lands in your notes. Here's how to set it up, and how you stay in control."
    >
      <h2>How it works</h2>
      <p>
        ChatGPT and Claude can use apps that offer an MCP server. MCP (Model Context Protocol) is an open standard that lets an
        assistant find, read and change things in another app. Amber Notes has one built in, so once you connect it, ChatGPT can
        search your notes, read them, write new ones and edit the ones you have.
      </p>
      <p>
        Apple Notes doesn&apos;t have one. ChatGPT can help with a note you have open, but it can&apos;t look through your notes or save
        changes to them on its own.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>Amber Notes on your Mac. It&apos;s free. <a href="/download">Download it here</a>.</li>
        <li>A ChatGPT account. Adding your own connector in ChatGPT needs Developer mode, which is on paid plans (Plus or higher).</li>
        <li>A computer for the first step. After that, it works in the ChatGPT app on your phone too.</li>
      </ul>

      <h2>Connect ChatGPT</h2>
      <ol>
        <li>Open Amber Notes and sign in. If your notes are in Apple Notes, <a href="/guides/move-from-apple-notes">import them first</a>.</li>
        <li>Open Settings and choose Connect an AI, then ChatGPT.</li>
        <li>Follow the steps shown. You copy Amber Notes&apos; address and add it in ChatGPT.</li>
        <li>ChatGPT asks Amber Notes for permission. Choose Allow in Amber Notes, and pick read-only, or read and edit.</li>
        <li>Try it. Ask ChatGPT: &ldquo;Add oat milk to my groceries note.&rdquo;</li>
      </ol>

      <h2>Claude, Claude Code and Codex</h2>
      <p>
        Claude works the same way: in Settings, choose Connect an AI, then Claude, and approve it in Amber Notes. Claude Code and
        Codex get a one-line command with a token of their own, which you paste into your terminal. Any other app that supports MCP
        can connect too.
      </p>

      <h2>You stay in control</h2>
      <ul>
        <li>Nothing is shared until you approve the connection in Amber Notes.</li>
        <li>You choose read-only, or read and edit, for each assistant.</li>
        <li>When an assistant changes a note, Amber Notes shows what changed, with Undo. The previous version is kept in the note&apos;s version history.</li>
        <li>You can disconnect any assistant in Settings at any time.</li>
      </ul>

      <h2>Things to ask</h2>
      <ul>
        <li>&ldquo;Plan 4 days in Lisbon for us and save it to my notes.&rdquo;</li>
        <li>&ldquo;What did I write about the kitchen measurements?&rdquo;</li>
        <li>&ldquo;Turn my meeting notes into a checklist of next steps.&rdquo;</li>
        <li>&ldquo;Add today&apos;s standup to my work notes.&rdquo;</li>
      </ul>
      <p>
        Stuck? The <a href="/help#connect">help page</a> has the short version, and you can message me on X.
      </p>
    </GuidePage>
  );
}
