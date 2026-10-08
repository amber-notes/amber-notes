import { DEVICES } from "@/lib/site";
import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-vs-obsidian");

type Row = [string, string, string, string];

// Checked against Apple's and Obsidian's own pages on 30 September 2026.
const ROWS: Row[] = [
  ["Where notes live", "In iCloud, in Apple's own format", "Markdown files in a folder on your computer", "In the cloud and on your devices, as markdown"],
  ["Devices", "Every Apple device, and iCloud.com in a browser", "Mac, Windows, Linux, iPhone, Android", DEVICES],
  ["Sync", "iCloud, free", "Obsidian Sync (paid), or your own: iCloud Drive, Git", "Built in, free"],
  ["Price", "Free", "Free for personal and work use; Sync and Publish are paid", "Free"],
  ["Extend it", "Shortcuts", "Thousands of community plugins and themes", "An MCP server for AI apps"],
  ["AI apps can search and edit", "Only on a Mac: Claude Desktop through Anthropic's extension, or community servers", "Through community plugins, on your computer", "Yes, from any device, with your approval"],
  ["Open source", "No", "No (many plugins are)", "Yes (MIT)"],
];

const FAQ = [
  { q: "Should I use Obsidian or Apple Notes?", a: [
    "Obsidian if you want your notes as plain files you own, links between notes and plugins for everything. Apple Notes if you want to open, write and close in seconds on every Apple device, with nothing to set up.",
  ] },
  { q: "Can Obsidian sync with iPhone for free?", a: [
    "Yes, by keeping the vault in iCloud Drive, or with Git and a community plugin. Obsidian Sync is the paid option that handles it for you, with version history.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-vs-obsidian"
      intro={<>Obsidian and Apple Notes sit at opposite ends: one hands you a folder of markdown files and endless plugins, the other hides everything and just works. Here&apos;s a fair look at where each one wins, and where AI fits in.</>}
      faq={FAQ}
    >
      <h2>At a glance</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Apple Notes</th><th scope="col">Obsidian</th><th scope="col">Amber Notes</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([what, apple, obsidian, amber]) => (
              <tr key={what}><th scope="row">{what}</th><td>{apple}</td><td>{obsidian}</td><td>{amber}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Source for Obsidian&apos;s plans: <a href="https://obsidian.md/pricing" rel="noopener">obsidian.md/pricing</a>.
      </p>

      <h2>Where Obsidian wins</h2>
      <ul>
        <li><strong>Your notes are files.</strong> Every note is a markdown file in a folder you choose. Any editor can open them, and they&apos;ll outlive any app.</li>
        <li><strong>Plugins.</strong> Calendars, kanban boards, spaced repetition, queries across notes: someone has built it.</li>
        <li><strong>Links between notes.</strong> Backlinks, a graph view and canvases for people who think in connections.</li>
        <li><strong>Every platform,</strong> including Windows, Linux and Android.</li>
      </ul>

      <h2>Where Apple Notes wins</h2>
      <ul>
        <li><strong>Nothing to set up.</strong> It&apos;s already on your iPhone and Mac, syncing through iCloud.</li>
        <li><strong>Speed for small things.</strong> A list, a code, a quick thought, from the lock screen or Control Center.</li>
        <li><strong>Built in extras:</strong> scanning documents, drawing, locked notes and shared folders.</li>
      </ul>

      <h2>Where AI fits</h2>
      <p>
        Neither ships an MCP server of its own. With Obsidian, community plugins give Claude Desktop or Claude Code access to a vault on the
        same computer, and because the notes are files, a file-system server works too. With Apple Notes, Anthropic&apos;s Read and Write Apple Notes
        extension for Claude Desktop and community servers drive the Notes app on a Mac. Either way it stays on that computer: ChatGPT on the web and the phone apps can&apos;t reach it.{" "}
        <a href="/blog/obsidian-mcp">Obsidian MCP servers, compared</a> goes through the Obsidian ones and how to set them up, and{" "}
        <a href="/blog/notes-apps-with-mcp">notes apps with an MCP server, compared</a> covers the other apps.
      </p>
      <p>
        Amber Notes is my middle ground: it feels like Apple Notes, keeps every note as markdown underneath, and has an MCP server in the cloud,
        so ChatGPT, Claude, Claude Code, Codex and Incredible can use your notes from any device. It keeps files and photos in notes too, like
        the trip documents above. It doesn&apos;t have plugins, and it isn&apos;t a folder of files on your disk.{" "}
        <a href="/blog/move-from-apple-notes">Moving from Apple Notes</a> is one import on your Mac.
      </p>

      <h2>Which to use</h2>
      <ul>
        <li><strong>You want to own plain files and tinker:</strong> Obsidian.</li>
        <li><strong>You want notes that are simply there on your iPhone and Mac:</strong> Apple Notes.</li>
        <li><strong>You want the Apple Notes feel, and your AI using your notes:</strong> Amber Notes. <a href="/blog/apple-notes-vs-notion">Apple Notes vs Notion</a> covers the other popular choice.</li>
      </ul>
    </PostPage>
  );
}
