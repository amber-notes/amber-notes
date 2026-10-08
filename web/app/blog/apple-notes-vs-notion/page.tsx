import { DEVICES } from "@/lib/site";
import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-vs-notion", { title: "Apple Notes vs Notion for everyday notes (and AI)" });

type Row = [string, string, string, string];

// Checked against Apple's and Notion's own pages on 30 September 2026.
const ROWS: Row[] = [
  ["Best at", "Quick notes, lists and scans, instantly", "Structured pages and databases, shared with a team", "Quick notes like Apple Notes, that your AI can use"],
  ["Devices", "Every Apple device, and iCloud.com in a browser", "Web, Mac, Windows, iPhone, Android", DEVICES],
  ["Offline", "Yes, everything", "Pages you mark for offline, in the apps", "Yes, everything"],
  ["Price", "Free with your Apple account", "Free plan; paid plans per member", "Free"],
  ["Built-in AI", "Apple Intelligence Writing Tools, on supported devices", "Notion AI; full use on Business and Enterprise", "None built in; you bring your own AI"],
  ["ChatGPT and Claude can search and edit", "Only Claude Desktop on a Mac, through Anthropic's extension", "Yes, through Notion's MCP server", "Yes, through its MCP server, with Undo"],
  ["Version history", "No", "Page history, longer on paid plans", "Every version, including AI edits"],
];

const FAQ = [
  { q: "Is Notion better than Apple Notes?", a: [
    "For structured work, yes: databases, linked pages and a shared team workspace are things Apple Notes doesn't try to do. For quick everyday notes, Apple Notes is faster to open and write in, and it works fully offline.",
  ] },
  { q: "Can ChatGPT or Claude use my Apple Notes like they can use Notion?", a: [
    "No. Notion has an MCP server that ChatGPT and Claude connect to; Apple Notes has no API, so they can't reach it from the web or your phone; only the Claude desktop app on a Mac can, through Anthropic's Read and Write Apple Notes extension. Pinto Notes works like Apple Notes and has an MCP server built in.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-vs-notion"
      intro={<>I&apos;ve used both for years. Apple Notes is where a thought goes in two seconds; Notion is where a project lives with its tables and team. Here&apos;s how they compare for everyday notes, and what changes once you want ChatGPT or Claude to use them.</>}
      faq={FAQ}
    >
      <h2>At a glance</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Apple Notes</th><th scope="col">Notion</th><th scope="col">Pinto Notes</th></tr>
          </thead>
          <tbody>
            {ROWS.map(([what, apple, notion, amber]) => (
              <tr key={what}><th scope="row">{what}</th><td>{apple}</td><td>{notion}</td><td>{amber}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Sources: Notion&apos;s pages on <a href="https://www.notion.com/help/use-pages-offline" rel="noopener">offline pages</a>,{" "}
        <a href="https://www.notion.com/pricing" rel="noopener">pricing</a> and <a href="https://www.notion.com/help/notion-mcp" rel="noopener">Notion MCP</a>.
      </p>

      <h2>Where Apple Notes wins</h2>
      <ul>
        <li>It opens instantly and gets out of the way. A grocery list, a door code or a quick idea takes seconds.</li>
        <li>It&apos;s on every Apple device already, syncs through iCloud, and works fully offline.</li>
        <li>Scanning documents, drawing, handwriting, locked notes and shared folders are built in.</li>
      </ul>

      <h2>Where Notion wins</h2>
      <ul>
        <li>Databases: a reading list, a CRM or a project tracker with views, filters and properties.</li>
        <li>Pages inside pages, linked across a workspace, and real-time editing with a team.</li>
        <li>Windows and Android apps, and the web, so it goes wherever your team works.</li>
      </ul>

      <h2>Where AI fits</h2>
      <p>
        This is where they differ most. Notion has Notion AI inside, and an official MCP server, so ChatGPT and Claude can search and edit your
        workspace. Apple Notes has Writing Tools for the text in front of you, and on a Mac, Anthropic&apos;s Read and Write Apple Notes
        extension lets the Claude desktop app read and edit your notes. But there&apos;s no API, so no AI app can search your notes or save to
        them from the web or your phone. <a href="/blog/apple-notes-api">Apple Notes API: what exists</a> explains why.
      </p>
      <p>
        If you like how Apple Notes feels and want your AI to use your notes, that&apos;s the gap I built Pinto Notes for. It works like Apple
        Notes, imports your Apple Notes on the Mac, and ChatGPT, Claude, Claude Code, Codex and Incredible can use it, with your approval and
        an Undo for every change. <a href="/blog/pinto-notes-vs-apple-notes">Pinto Notes vs Apple Notes</a> covers what it doesn&apos;t do yet.
      </p>

      <h2>Which to use</h2>
      <ul>
        <li><strong>Mostly quick personal notes:</strong> Apple Notes, or Pinto Notes if you want AI in the loop.</li>
        <li><strong>Team projects and databases:</strong> Notion.</li>
        <li><strong>Both:</strong> plenty of people keep quick notes in one and projects in the other. <a href="/blog/notes-apps-that-work-with-chatgpt">Notes apps that work with ChatGPT</a> compares the options if AI access is the deciding factor.</li>
      </ul>
    </PostPage>
  );
}
