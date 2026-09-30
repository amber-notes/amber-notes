import { GuidePage, guideMetadata } from "@/lib/GuidePage";

export const dynamic = "force-static";
export const metadata = guideMetadata("connect-chatgpt-to-your-notes");

const FAQ = [
  { q: "Which ChatGPT plans can add Amber Notes?", a: [
    "Adding your own app in ChatGPT needs Developer mode, which OpenAI offers on Plus, Pro, Business, Enterprise and Edu, on the web. The free plan can't add one.",
  ] },
  { q: "Does it work in the ChatGPT app on my phone?", a: [
    "Yes. You add Amber Notes once in ChatGPT on the web. After that, it's available in the ChatGPT apps too.",
  ] },
  { q: "Can ChatGPT delete my notes?", a: [
    "Only if you chose read and edit. A deleted note goes to Recently Deleted for 30 days, and every change keeps the previous version in the note's history, so you can undo it.",
  ] },
];

export default function Page() {
  return (
    <GuidePage
      slug="connect-chatgpt-to-your-notes"
      lede="Ask ChatGPT to add to a list, plan a trip or tidy a note, and the change lands in your notes. Here's how to set it up, and how you stay in control."
      faq={FAQ}
    >
      <h2>How it works</h2>
      <p>
        ChatGPT and Claude can use apps that offer an MCP server. MCP (Model Context Protocol) is an open standard that lets an
        assistant find, read and change things in another app. Amber Notes, the notes app for iPhone and Mac, has one built in. Once you
        connect it, ChatGPT can search your notes, read them, write new ones and edit the ones you have.
      </p>
      <p>
        Apple Notes doesn&apos;t have one. On a Mac, ChatGPT can look at a note you have open, but it can&apos;t search your notes or
        save changes to them. <a href="/guides/chatgpt-and-apple-notes">More on ChatGPT and Apple Notes</a>.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>Amber Notes on your Mac, signed in. It&apos;s free. <a href="/download">Download it here</a>.</li>
        <li>ChatGPT Plus, Pro, Business, Enterprise or Edu. Adding your own app needs Developer mode, which the free plan doesn&apos;t have.</li>
        <li>ChatGPT on the web, for the first step. After that, it works in the ChatGPT apps too.</li>
      </ul>

      <h2>Connect ChatGPT</h2>
      <ol>
        <li>In Amber Notes, open Settings (Amber Notes, then Settings, or ⌘,). If your notes are in Apple Notes, <a href="/guides/move-from-apple-notes">import them first</a>.</li>
        <li>Under Connect an AI, choose ChatGPT. Amber Notes copies its address and opens ChatGPT&apos;s Plugins page. The steps stay on screen while you work.</li>
        <li>In ChatGPT, turn on Developer mode in Settings, Security and login. You only do this once.</li>
        <li>In Plugins, choose + and name it Amber Notes.</li>
        <li>Paste the address, choose OAuth, then Create.</li>
        <li>ChatGPT asks Amber Notes for permission. Amber Notes opens and asks &ldquo;Allow ChatGPT to use your notes?&rdquo; Pick Read and Edit, or Read Only, and choose Allow.</li>
        <li>Try it. Ask ChatGPT: &ldquo;Search my Amber Notes and tell me what I wrote most recently.&rdquo;</li>
      </ol>
      <p>
        OpenAI renamed some of these pages in 2026. If you see Connectors or Apps instead of Plugins, it&apos;s the same place.
      </p>

      <h2>Claude</h2>
      <p>
        Under Connect an AI, choose Claude. Claude opens its Add custom connector dialog with Amber Notes already filled in. Choose Add,
        then Connect, then Allow in Amber Notes. It works on every Claude plan. The free plan includes one custom connector, and on Team
        and Enterprise an Owner adds it for the organization.
      </p>

      <h2>Claude Code and Codex</h2>
      <p>
        These use an access token instead of a sign-in. On a Mac, choose Claude Code under Connect an AI and then Add to Claude Code,
        or copy the command it shows. For Codex, Amber Notes gives you a few lines to paste into <code>~/.codex/config.toml</code>.
        The <a href="/guides/notes-in-claude-code-and-codex">Claude Code and Codex guide</a> has the details. Any other app that
        supports MCP can connect too; the <a href="/guides/mcp-server">MCP server page</a> has the address and the tools.
      </p>

      <h2>You stay in control</h2>
      <ul>
        <li>Nothing is shared until you choose Allow in Amber Notes.</li>
        <li>You choose Read Only, or Read and Edit, for each assistant.</li>
        <li>When an assistant changes a note, Amber Notes shows what changed, with Undo. The previous version is kept in the note&apos;s version history (File, then Show Version History).</li>
        <li>Settings lists everything that&apos;s connected. Choose Disconnect, and it loses access right away.</li>
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
