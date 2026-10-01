import { PostPage, postMetadata } from "@/lib/PostPage";
import { MCP_URL } from "@/lib/facts";

export const dynamic = "force-static";
export const metadata = postMetadata("claude-cowork-apple-notes");

// Checked against Anthropic's own pages on 1 October 2026: Cowork on web, desktop and mobile
// (support article 15520349), desktop and web connectors (11725091), custom connectors (11175166),
// and the Read and Write Apple Notes listing on claude.com/connectors. Not tested hands-on in Cowork.

const FAQ = [
  { q: "Can Claude Cowork read my Apple Notes?", a: [
    "Yes, on a Mac, through Anthropic's Read and Write Apple Notes extension for Claude Desktop. It can list, read, add and update notes. It runs on your Mac, so Cowork can only use it while Claude Desktop is open there.",
  ] },
  { q: "Can Cowork on my iPhone use Apple Notes?", a: [
    "Only through your Mac. Anthropic says desktop extensions aren't available on the web or mobile, and that Cowork reaches local connectors through the Claude Desktop app while it's open. With the Mac asleep or the app closed, there's no way in, because Apple Notes has no API.",
  ] },
  { q: "Can Cowork use custom connectors?", a: [
    "Yes. Anthropic lists custom connectors using remote MCP for Cowork, on Free (one connector), Pro, Max, Team and Enterprise plans. Remote connectors work on desktop, web and mobile. Cowork itself needs a paid plan.",
  ] },
  { q: "Is the Apple Notes extension enough?", a: [
    "If you use Cowork on your Mac, with the app open, and mostly want Claude to read your notes or add new ones, yes. It's weaker for editing existing notes with checklists, and for anything from your phone while the Mac is off.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="claude-cowork-apple-notes"
      intro={<>People keep asking how to get Claude Cowork working with Apple Notes, and the answers in the threads range from &ldquo;use the Mac connector&rdquo; to &ldquo;impossible&rdquo;. Both are partly right. Here&apos;s what works today, from Anthropic&apos;s own documentation, and when you need something else.</>}
      faq={FAQ}
    >
      <h2>The short answer</h2>
      <p>
        On a Mac, install Anthropic&apos;s <strong>Read and Write Apple Notes</strong> extension in Claude Desktop, and Cowork can list, read,
        add and update your notes while the app is open on that Mac. From your phone or the web, Cowork can only reach it through that open
        Mac. If you want Claude to use your notes from any device with the Mac off, your notes need to live in an app with a connector on the
        internet, which means moving them out of Apple Notes.
      </p>

      <h2>What Cowork is, and where it runs</h2>
      <p>
        Cowork is Claude doing longer tasks for you: you describe the outcome, and it works through the steps. It&apos;s on Claude Desktop, the
        web, the phone apps and the Claude in Chrome side panel, on paid plans (Pro, Max, Team and Enterprise). Anthropic is folding it into
        regular Claude, so on some accounts there&apos;s no separate Cowork button any more.
      </p>
      <p>
        Cowork tasks run in Anthropic&apos;s cloud, so they keep going when you close your laptop, and from 6 October 2026 new tasks on Pro and
        Max always run there. Anything on your computer, such as local files, browser use and local connectors, still needs the Claude Desktop
        app open on that computer. Anthropic explains this in <a href="https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile" rel="noopener">Use
        Claude Cowork on web, desktop, and mobile</a>.
      </p>

      <h2>Option 1: the Apple Notes extension, on your Mac</h2>
      <p>
        Anthropic makes a desktop extension called <a href="https://www.claude.com/connectors/read-and-write-apple-notes" rel="noopener">Read and
        Write Apple Notes</a>. It drives the Notes app through macOS automation, with four tools: list notes, get a note&apos;s content, add a
        note, and update a note&apos;s content.
      </p>
      <ol>
        <li>Open Claude Desktop on your Mac and go to Settings, then Extensions.</li>
        <li>Find Read and Write Apple Notes and install it.</li>
        <li>The first time Claude uses it, macOS asks whether Claude may control Notes. Allow it. You can change this later in System Settings, Privacy &amp; Security, Automation.</li>
        <li>In Cowork, describe the task, for example: &ldquo;Find my packing list note and add a section for the Lisbon trip.&rdquo;</li>
      </ol>
      <p>What to know before you rely on it:</p>
      <ul>
        <li><strong>It needs the Mac.</strong> Desktop extensions run on your computer. Anthropic says they aren&apos;t available on the web or mobile, and Cowork reaches them only through Claude Desktop while it&apos;s open. A scheduled task that runs while your Mac sleeps can&apos;t use it.</li>
        <li><strong>Checklists don&apos;t survive edits.</strong> When the extension updates a note, its checkboxes become plain bullets and lose their ticks. That was <a href="https://github.com/anthropics/claude-ai-mcp/issues/29" rel="noopener">reported to Anthropic</a> and closed as not planned.</li>
        <li><strong>Locked notes stay locked.</strong> Automation can&apos;t read a note locked with a password.</li>
        <li><strong>No undo.</strong> Apple Notes keeps no version history, so if Claude rewrites a note badly, the earlier text is gone.</li>
      </ul>
      <p>
        I haven&apos;t been able to test the extension inside Cowork myself; the above follows Anthropic&apos;s pages. If a step looks different
        in your app, the <a href="/blog/claude-and-apple-notes">Claude and Apple Notes guide</a> has the troubleshooting for the extension, and{" "}
        <a href="/blog/apple-notes-mcp">Apple Notes MCP servers compared</a> covers the community alternatives, which have the same Mac-only limit.
      </p>

      <h2>When the extension is enough</h2>
      <ul>
        <li>You use Cowork on your Mac, or on your phone while the Mac sits at home with Claude Desktop open, which Anthropic says is how Cowork reaches local connectors.</li>
        <li>Claude mostly reads your notes, or adds new ones, rather than editing long notes full of checklists.</li>
        <li>You want to stay in Apple Notes, with its iCloud sync, scans, drawings and shared notes.</li>
      </ul>
      <p>If that&apos;s you, stop here. The extension is free with Claude Desktop and takes a minute to set up.</p>

      <h2>Option 2: a notes app with its own connector</h2>
      <p>
        Cowork can use custom connectors, which Anthropic runs from its cloud, so they work on desktop, web and mobile without your Mac
        (see <a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" rel="noopener">Get
        started with custom connectors</a>). Apple Notes has no API, so it can&apos;t be one. A notes app that runs its own MCP server can.
      </p>
      <p>
        I make one, Amber Notes: a free notes app for iPhone and Mac that works like Apple Notes, with an MCP server built in. In Cowork it
        behaves like any custom connector:
      </p>
      <ol>
        <li>On claude.ai, go to Customize, Connectors, choose + and then Add custom connector, and paste <code>{MCP_URL}</code>.</li>
        <li>Sign in when asked, and approve Claude in Amber Notes on your iPhone or Mac by typing the number the page shows. Pick Read Only or Read and Edit.</li>
        <li>In Cowork, turn the connector on from the + menu and ask away, from any device.</li>
      </ol>
      <p>
        Every change Claude makes shows up tinted in the note, with an Undo, and the version before is kept, so a bad edit is one tap to put
        back. Checklists stay checklists. The catch is that your notes have to move: Amber Notes imports them from Apple Notes on your Mac,
        with their folders, checklists and tables, but images, attachments and locked notes stay behind.{" "}
        <a href="/blog/move-from-apple-notes">How to move from Apple Notes</a> walks through it, and Apple Notes stays untouched, so you can
        try it and go back. To give Cowork something to fill in from day one, the <a href="/templates">note templates</a> have a prompt for
        each.
      </p>

      <h2>If it doesn&apos;t work</h2>
      <ul>
        <li><strong>Cowork can&apos;t see your notes:</strong> check that Claude Desktop is open on the Mac with the extension, and that the extension is on for the task.</li>
        <li><strong>macOS keeps saying no:</strong> System Settings, Privacy &amp; Security, Automation, and allow Claude to control Notes. Then quit Claude and open it again.</li>
        <li><strong>A note is missing:</strong> it has to be on that Mac. Check it synced from iCloud, and that it isn&apos;t locked.</li>
        <li><strong>You&apos;d rather keep a copy for Claude to read:</strong> <a href="/blog/export-apple-notes-to-markdown">export your notes to Markdown</a> into a folder Cowork can use.</li>
      </ul>
    </PostPage>
  );
}
