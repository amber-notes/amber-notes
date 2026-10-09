import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Capture, Keep } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-api", { title: "Apple Notes API: what exists and what to use instead" });

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

const APPLESCRIPT = `tell application "Notes"
	set titles to name of every note
	set firstBody to body of note 1
	make new note at folder "Notes" with properties {name:"Groceries", body:"<h1>Groceries</h1><div>Milk</div>"}
end tell`;

const PYTHON = `import subprocess

script = 'tell application "Notes" to get name of every note'
out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
print(out.stdout)`;

const PROMPT = `Write an AppleScript for the Notes app on macOS that [what you want, for example: appends today's date and a line of text to the note called "Work log"]. Notes stores note bodies as HTML, so read and write the body as HTML. Then show me how to run it from Terminal with osascript.`;

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-api"
      intro={<>People ask me whether Apple Notes has an API. It doesn&apos;t, not in the way Notion or Evernote do. Here&apos;s what does exist on a Mac and an iPhone, what each can and can&apos;t do, and what to use when you need more.</>}
      answer={
        <Answer jump={[
          { href: "#which-to-use", label: "Which to use" },
          { href: "#what-exists", label: "What exists" },
          { href: "#applescript", label: "AppleScript and Python" },
          { href: "#real-api", label: "A real API" },
        ]}>
          <p>
            No. Apple doesn&apos;t publish an API for Notes: there&apos;s no web endpoint, and nothing outside your devices can read your notes in
            iCloud. What works goes through the Notes app on your own device, so it runs only while that device is on:
          </p>
          <ul>
            <li><strong>AppleScript</strong> on a Mac reads and writes notes, as HTML.</li>
            <li><strong>Shortcuts</strong> on iPhone and Mac can create notes, append to them and tick checklist items.</li>
            <li>For ChatGPT on your phone, a server or a coding agent, the notes need to live in an app that has an API of its own.</li>
          </ul>
        </Answer>
      }
      art="/blog/art/apple-notes-api"
      faq={FAQ}
    >
      <h2 id="which-to-use">Which one should I use?</h2>
      <p>Find what you want to do, and the right column is your answer.</p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">If you want to</th><th scope="col">Use</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Read every note from a script on your Mac</th><td>AppleScript, or Python running it through <code>osascript</code></td></tr>
            <tr><th scope="row">Add to a note from your iPhone, by tapping or on a schedule</th><td>Shortcuts: Append to Note, or Append Checklist Item</td></tr>
            <tr><th scope="row">Take a copy of one note</th><td>Export, as Markdown on iOS 26 and macOS 26</td></tr>
            <tr><th scope="row">Let Claude on your Mac search and edit notes</th><td>Claude&apos;s Apple Notes extension, or a community MCP server</td></tr>
            <tr><th scope="row">Let ChatGPT or Claude on the web or iPhone use your notes</th><td>Not possible with Apple Notes; use a notes app with an API</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="what-exists">What exists</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">What it can do</th><th scope="col">Limits</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">AppleScript (and JavaScript for Automation), on a Mac</th><td>List folders and notes, read a note&apos;s title, dates and body, create notes and change their body</td><td>Bodies are HTML; locked notes can&apos;t be read; needs your Automation permission</td></tr>
            <tr><th scope="row">Shortcuts, on iPhone and Mac</th><td>Actions such as Create Note, Append to Note, Append Checklist Item, Set Checklist Items Checked, Move Notes to Folder, Pin or Unpin Notes and Delete Notes</td><td>Runs on the device, when you or an automation start it</td></tr>
            <tr><th scope="row">Export, on Mac and iPhone</th><td>Export a note, including as markdown on macOS 26 and iOS 26</td><td>One note at a time; a copy, not a live connection</td></tr>
            <tr><th scope="row">The Notes database, on a Mac</th><td>Read what the app stores, in an undocumented format</td><td>Protected by Full Disk Access; the format can change with any update; read-only in practice</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The action names above are the ones the Notes app offers Shortcuts on macOS 26.5, read from the app itself; Apple describes
        Shortcuts&apos; recent additions in <a href="https://support.apple.com/en-us/125148" rel="noopener">What&apos;s new in Shortcuts</a>. On
        devices with Apple Intelligence, the Use Model action can put a model, including ChatGPT, between those actions: for example, ask it
        to summarize some text and append the result to a note.
      </p>

      <Capture src="/blog/macos27/notes-export-to" width={770} height={795} maxWidth={385}
        alt="The File menu of Apple Notes on macOS 27, open at Export To, with PDF and Markdown, and Import Markdown above it."
        caption="Export To and Import Markdown in Notes on macOS 27: one note at a time, a copy rather than a connection." />

      <h2 id="applescript">AppleScript, and Python on top of it</h2>
      <p>
        On a Mac, the Notes app answers AppleScript. This lists every note&apos;s title, reads the first note&apos;s body (it comes back as
        HTML) and makes a new note in the Notes folder:
      </p>
      <Keep title="AppleScript: list, read and make notes" text={APPLESCRIPT} code note="Run it in Script Editor, or save it and run osascript notes.applescript in Terminal." />
      <p>
        Python has no Notes library of its own; it runs the same script through <code>osascript</code>. The first time, macOS asks whether
        your terminal may control Notes, under Privacy &amp; Security, Automation.
      </p>
      <Keep title="Python: every note's title" text={PYTHON} code />
      <p>
        Locked notes don&apos;t open this way, and the script runs only on a Mac that&apos;s on and signed in.
      </p>
      <Keep title="Or ask an AI to write the script" text={PROMPT}
        note="Fill in the brackets and paste it into ChatGPT, Claude or Gemini. Read the script before you run it: it can change your notes." />

      <h2 id="what-people-build">What people build on it</h2>
      <p>
        Most &ldquo;Apple Notes API&rdquo; projects on GitHub are MCP servers that drive the Notes app with AppleScript, so Claude Desktop or
        Claude Code can search and edit notes on that Mac. <a href="/blog/claude-and-apple-notes">Can Claude read your Apple Notes?</a> goes
        through those options and their limits, and <a href="/blog/apple-notes-mcp">Apple Notes MCP servers compared</a> sets the
        main servers side by side. Exporters that turn every note into markdown files are the other common kind; <a href="/blog/export-apple-notes-to-markdown">exporting Apple Notes to Markdown</a> covers those and the built-in export.
      </p>
      <p>
        Pinto Notes uses the same two doors when it imports: AppleScript to read your notes, and, if you ask it to keep your pins, the notes
        database, which is why that option asks for Full Disk Access. It only reads; nothing in Apple Notes changes.
      </p>

      <h2 id="real-api">What to use when you need a real API</h2>
      <p>
        If you want something outside your Mac to read and write your notes, whether that&apos;s ChatGPT on your phone, a script on a server
        or a coding agent, the notes need to live in an app that has an API of its own. Notion and Evernote have one. Pinto Notes, the notes app
        for iPhone and Mac that I make, has an MCP server built in, which is the kind of API AI apps speak:
      </p>
      <ul>
        <li>Tools to search, read, create and edit notes, with precise edits (<code>edit_note</code>, <code>append_to_note</code>, <code>set_checklist_item</code>) instead of rewriting a whole note.</li>
        <li>Sign-in with OAuth and your approval in the app, read only or read and edit, or an access token for scripts, Claude Code and Codex.</li>
        <li>Every change keeps the previous version, so a bad edit can be put back.</li>
      </ul>
      <Figure shot={SHOTS.connectList} caption="Settings, Connect an AI, in Pinto Notes on a Mac: a guided setup for each app, and everything that's connected." />
      <p>
        ChatGPT, Claude, Claude Code, Codex and Incredible can all use it. The <a href="/blog/mcp-server">Pinto Notes MCP server</a> page has
        the address and every tool, and <a href="/blog/move-from-apple-notes">moving from Apple Notes</a> takes one import on your Mac.
      </p>
      <PostCta slug="apple-notes-api" position="how-amber-helps" title="Notes with an API ChatGPT and Claude can use">
        <p>Pinto Notes works like Apple Notes, imports your notes from it, and has the MCP server built in.</p>
      </PostCta>
    </PostPage>
  );
}
