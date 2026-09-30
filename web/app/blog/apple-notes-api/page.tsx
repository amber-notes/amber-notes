import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-api");

const FAQ = [
  { q: "Does Apple Notes have an API?", a: [
    "No. Apple doesn't offer a public web or cloud API for Notes, and outside services can't reach your notes in iCloud. On a Mac you can script the Notes app with AppleScript, and on iPhone and Mac you can use its Shortcuts actions, but both run on your own device.",
  ] },
  { q: "Can I read Apple Notes from Python?", a: [
    "On a Mac, yes: Python can run an AppleScript through the osascript command, and the Notes app answers with each note's title, dates and body as HTML. It needs the Notes app on that Mac and your permission under Privacy & Security, Automation.",
  ] },
  { q: "Can an AI use Apple Notes through an API?", a: [
    "Only on a Mac, through community MCP servers or Claude's desktop extension, which drive the Notes app with AppleScript. Nothing in the cloud can reach Apple Notes, so ChatGPT or Claude on the web and on iPhone can't.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-api"
      intro={<>People ask me whether Apple Notes has an API. It doesn&apos;t, not in the way Notion or Evernote do. Here&apos;s what does exist on a Mac and an iPhone, what each can and can&apos;t do, and what to use when you need more.</>}
      faq={FAQ}
    >
      <h2>The short answer</h2>
      <p>
        Apple doesn&apos;t publish an API for Notes. There&apos;s no web endpoint, and no way for an outside service to read your notes in
        iCloud. Everything that works goes through the Notes app on one of your own devices, which means it only runs while that device is
        on, and only for the notes on it.
      </p>

      <h2>What exists</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Where</th><th scope="col">What it can do</th><th scope="col">Limits</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">AppleScript (and JavaScript for Automation)</th><td>Mac</td><td>List folders and notes, read a note&apos;s title, dates and body, create notes and change their body</td><td>Bodies are HTML; locked notes can&apos;t be read; needs your Automation permission</td></tr>
            <tr><th scope="row">Shortcuts</th><td>iPhone and Mac</td><td>Actions such as Create Note, Append to Note, Append Checklist Item, Move Notes to Folder, Pin Notes and Delete Notes</td><td>Runs on the device, when you or an automation start it</td></tr>
            <tr><th scope="row">Export</th><td>Mac, iPhone</td><td>Export a note, including as markdown on macOS 26 and iOS 26</td><td>One note at a time; a copy, not a live connection</td></tr>
            <tr><th scope="row">The Notes database</th><td>Mac</td><td>Read what the app stores, in an undocumented format</td><td>Protected by Full Disk Access; the format can change with any update; read-only in practice</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Apple lists the Shortcuts actions in <a href="https://support.apple.com/en-us/125148" rel="noopener">What&apos;s new in Shortcuts</a>. On
        devices with Apple Intelligence, the Use Model action can put a model, including ChatGPT, between those actions: for example, ask it
        to summarize some text and append the result to a note.
      </p>

      <h2>What people build on it</h2>
      <p>
        Most &ldquo;Apple Notes API&rdquo; projects on GitHub are MCP servers that drive the Notes app with AppleScript, so Claude Desktop or
        Claude Code can search and edit notes on that Mac. <a href="/blog/claude-and-apple-notes">Can Claude read your Apple Notes?</a> goes
        through those options and their limits, and <a href="/blog/apple-notes-mcp">Apple Notes MCP servers compared</a> sets the
        main servers side by side. Exporters that turn every note into markdown files are the other common kind; <a href="/blog/export-apple-notes-to-markdown">exporting Apple Notes to Markdown</a> covers those and the built-in export.
      </p>
      <p>
        Amber Notes uses the same two doors when it imports: AppleScript to read your notes, and, if you ask it to keep your pins, the notes
        database, which is why that option asks for Full Disk Access. It only reads; nothing in Apple Notes changes.
      </p>

      <h2>What to use when you need a real API</h2>
      <p>
        If you want something outside your Mac to read and write your notes, whether that&apos;s ChatGPT on your phone, a script on a server
        or a coding agent, the notes need to live in an app that has an API of its own. Notion and Evernote have one. Amber Notes, the notes app
        for iPhone and Mac that I make, has an MCP server built in, which is the kind of API AI apps speak:
      </p>
      <ul>
        <li>Tools to search, read, create and edit notes, with precise edits (<code>edit_note</code>, <code>append_to_note</code>, <code>set_checklist_item</code>) instead of rewriting a whole note.</li>
        <li>Sign-in with OAuth and your approval in the app, read only or read and edit, or an access token for scripts, Claude Code and Codex.</li>
        <li>Every change keeps the previous version, so a bad edit can be put back.</li>
      </ul>
      <p>
        ChatGPT, Claude, Claude Code, Codex and Incredible can all use it. The <a href="/blog/mcp-server">Amber Notes MCP server</a> page has
        the address and every tool, and <a href="/blog/move-from-apple-notes">moving from Apple Notes</a> takes one import on your Mac.
      </p>
    </PostPage>
  );
}
