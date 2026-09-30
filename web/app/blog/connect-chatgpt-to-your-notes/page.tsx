import { Figure } from "@/lib/blog";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";
import { MCP_URL } from "@/lib/facts";

export const dynamic = "force-static";
export const metadata = postMetadata("connect-chatgpt-to-your-notes");

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
    <PostPage
      slug="connect-chatgpt-to-your-notes"
      intro={<>I wanted to ask ChatGPT to add to a list, plan a trip or tidy a note, and have the change land in my notes instead of in a chat I&apos;d have to copy from. That&apos;s what Amber Notes does. Here&apos;s how to set it up in a few minutes, and how you stay in control.</>}
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
        save changes to them. If you&apos;re wondering why, <a href="/blog/claude-and-apple-notes">why AI apps can&apos;t reach Apple Notes</a>{" "}
        explains it, and <a href="/blog/notes-apps-that-work-with-chatgpt">notes apps that work with ChatGPT</a> compares the alternatives.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>Amber Notes on your Mac, signed in. It&apos;s free. <a href="/download">Download it here</a>.</li>
        <li>ChatGPT Plus, Pro, Business, Enterprise or Edu. Adding your own app needs Developer mode, which the free plan doesn&apos;t have.</li>
        <li>ChatGPT on the web, for the first step. After that, it works in the ChatGPT apps too.</li>
      </ul>

      <h2>Connect ChatGPT</h2>
      <ol>
        <li>In Amber Notes, open Settings (Amber Notes, then Settings, or ⌘,). If your notes are in Apple Notes, <a href="/blog/move-from-apple-notes">import them first</a>.</li>
        <li>Under Connect an AI, choose ChatGPT, then Copy Address and Open ChatGPT. Amber Notes copies its address and opens ChatGPT&apos;s Plugins page. The steps stay on screen while you work.</li>
        <li>In ChatGPT, turn on Developer mode in Settings, Security and login. You only do this once.</li>
        <li>In Plugins, choose + and name it Amber Notes.</li>
        <li>Paste the address, choose OAuth, then Create.</li>
        <li>
          ChatGPT asks Amber Notes for permission. A page on ambernotes.app opens: choose Open in Amber Notes, or sign in right there.
          Either way you see &ldquo;Allow ChatGPT to use your notes?&rdquo; Pick Read and Edit, or Read Only, and choose Allow.
        </li>
        <li>Try it. Ask ChatGPT: &ldquo;Search my Amber Notes and tell me what I wrote most recently.&rdquo;</li>
      </ol>
      <Figure shot={SHOTS.consent} caption="Nothing is shared until you choose Allow, and you pick Read and Edit or Read Only." />
      <p>
        OpenAI renamed some of these pages in 2026. If you see Connectors or Apps instead of Plugins, it&apos;s the same place.
      </p>

      <h2>Claude</h2>
      <p>
        Under Connect an AI, choose Claude, then Add to Claude. Claude opens its Add custom connector dialog with Amber Notes already filled in. Choose Add,
        then Connect, then Allow. It works on every Claude plan. The free plan includes one custom connector, and on Team
        and Enterprise an Owner adds it for the organization.
      </p>

      <h2>Claude Code and Codex</h2>
      <p>
        These use an access token instead of a sign-in. On a Mac, choose Claude Code under Connect an AI and then Add to Claude Code,
        or copy the command it shows. For Codex, Amber Notes gives you a few lines to paste into <code>~/.codex/config.toml</code>.
        <a href="/blog/notes-in-claude-code-and-codex">Using your notes from Claude Code and Codex</a> has the details.
      </p>

      <h2 id="incredible">Incredible</h2>
      <p>
        <a href="https://incredible.one" rel="noopener">Incredible</a>, the AI assistant my company makes, is a desktop app for Mac and
        Windows, and Amber Notes is one of its apps. In Incredible:
      </p>
      <ol>
        <li>Open Apps and search for Amber Notes.</li>
        <li>Choose Connect. Your browser opens Amber Notes.</li>
        <li>
          Amber Notes asks to allow an app on this computer that calls itself &ldquo;incredible&rdquo;. A sign-in that returns to your own
          computer can&apos;t prove which app is asking, so it starts at Read Only. Pick Read and Edit if Incredible should change notes,
          then choose Allow. On a Windows PC, you sign in and choose Allow on the page that opens.
        </li>
        <li>Back in Incredible, choose Let&apos;s go.</li>
      </ol>
      <p>
        On an older version of Incredible, where Amber Notes isn&apos;t in Apps, add it as your own MCP server: choose Add it here at the
        bottom of Apps (or Add another MCP server), paste <code>{MCP_URL}</code>, choose Continue, then Sign in. After you choose Allow,
        choose Add server. In Amber Notes, Settings, Connect an AI, Incredible has the same steps.
      </p>

      <h2>Other MCP apps</h2>
      <p>
        Any other app that supports MCP connects the same way: add the Amber Notes server address, <code>{MCP_URL}</code>, and sign in
        when it asks, then choose Allow. The <a href="/blog/mcp-server">Amber Notes MCP server page</a> has the address, the sign-in and every tool.
      </p>

      <h2>You stay in control</h2>
      <Figure shot={SHOTS.aiEdit} caption="When ChatGPT changes a note, the new lines are tinted and you can undo the change." />
      <ul>
        <li>Nothing is shared until you choose Allow, in Amber Notes or signed in to your account on ambernotes.app.</li>
        <li>You choose Read Only, or Read and Edit, for each assistant.</li>
        <li>When an assistant changes a note, Amber Notes shows what changed, with Undo. The previous version is kept in the note&apos;s version history (File, then Show Version History).</li>
        <li>Settings lists everything that&apos;s connected. Choose Disconnect, and it loses access right away.</li>
      </ul>

      <h2>Things to ask</h2>
      <p>For a to-do list you tick on your phone, see <a href="/blog/chatgpt-to-do-list-on-iphone">how to use ChatGPT as a to-do list</a>. A few more:</p>
      <ul>
        <li>&ldquo;Plan 4 days in Lisbon for us and save it to my notes.&rdquo;</li>
        <li>&ldquo;What did I write about the kitchen measurements?&rdquo;</li>
        <li>&ldquo;Turn my meeting notes into a checklist of next steps.&rdquo;</li>
        <li>&ldquo;Add today&apos;s standup to my work notes.&rdquo;</li>
      </ul>
      <p>
        Stuck? The <a href="/help#connect">help page</a> has the short version, and you can message me on X.
      </p>
    </PostPage>
  );
}
