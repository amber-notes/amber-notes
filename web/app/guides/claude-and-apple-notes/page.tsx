import { GuidePage, guideMetadata } from "@/lib/GuidePage";

export const dynamic = "force-static";
export const metadata = guideMetadata("claude-and-apple-notes", {
  title: "Can Claude read your Apple Notes? What works in 2026",
});

const FAQ = [
  { q: "Can Claude read my Apple Notes?", a: [
    "Yes, on a Mac. The Claude desktop app can read Apple Notes through a desktop extension, and community MCP servers let Claude Desktop and Claude Code search and change notes. It all runs on the Mac where your notes are, so it doesn't work from Claude on iPhone or on the web.",
  ] },
  { q: "Can Claude on my iPhone see my Apple Notes?", a: [
    "No. Apple Notes has no public API and no way for an outside service to reach your notes in iCloud, so nothing can connect Claude on iPhone or claude.ai to them. The only way is to move your notes to an app that has its own MCP server.",
  ] },
  { q: "Is there an official Apple Notes MCP server?", a: [
    "Apple doesn't make one. The Apple Notes MCP servers you'll find on GitHub are community projects that drive the Notes app on your Mac through AppleScript.",
  ] },
];

export default function Page() {
  return (
    <GuidePage
      slug="claude-and-apple-notes"
      lede="Short answer: on a Mac, yes. On iPhone and in the browser, no. Here's what each option can do, and what it can't."
      faq={FAQ}
    >
      <h2>Why it depends on where you use Claude</h2>
      <p>
        Apple Notes has no public API. Your notes live in iCloud, and Apple doesn&apos;t let outside services read them there. The only
        way in is the Notes app itself, on a Mac, through AppleScript. So anything that connects Claude to Apple Notes has to run on a
        Mac that has your notes on it, and it only works while that Mac is on.
      </p>
      <p>
        Claude on the web and Claude on iPhone run in Anthropic&apos;s cloud. They can only reach apps that offer a server on the
        internet, and Apple Notes doesn&apos;t have one.
      </p>

      <h2>Your options</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Where it works</th><th scope="col">What Claude can do</th><th scope="col">Setup</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Copy and paste</th><td>Anywhere</td><td>Read what you paste; you copy the answer back</td><td>None</td></tr>
            <tr><th scope="row">Claude desktop extension for Apple Notes</th><td>Claude desktop app on your Mac</td><td>Read your notes, per Anthropic</td><td>Install it from the connectors directory in Claude for Mac</td></tr>
            <tr><th scope="row">Community Apple Notes MCP server</th><td>Claude Desktop or Claude Code on your Mac</td><td>Search, read, create and edit, depending on the server</td><td>Install it and edit Claude&apos;s config; allow Automation in macOS</td></tr>
            <tr><th scope="row">A notes app with its own MCP server, like Amber Notes</th><td>Claude on the web, desktop, iPhone and Claude Code</td><td>Search, read, create and edit, with your approval and Undo</td><td>Import your notes once, then add a custom connector</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Option 1: the Claude desktop app on a Mac</h2>
      <p>
        Claude&apos;s connectors directory includes desktop extensions, which work with apps on your computer. Anthropic&apos;s own
        tutorial says Claude &ldquo;can read your Apple Notes on desktop&rdquo;. It&apos;s the simplest route if you only use Claude on
        your Mac and mostly want Claude to read. Check what it can change before you rely on it for edits.
      </p>

      <h2>Option 2: a community MCP server</h2>
      <p>
        Developers have built MCP servers that drive the Notes app with AppleScript. The most actively maintained one in September
        2026 is <a href="https://github.com/sweetrb/apple-notes-mcp" rel="noopener">sweetrb/apple-notes-mcp</a>, which can search,
        create and update notes. Follow its README to add it to Claude Desktop or Claude Code. Expect a macOS prompt asking whether
        Claude may control Notes.
      </p>
      <p>Things to know:</p>
      <ul>
        <li>It only works on the Mac it&apos;s installed on, while that Mac is awake.</li>
        <li>AppleScript reads and writes a note as HTML, so depending on the server, an edit can lose formatting such as checklists.</li>
        <li>Apple Notes keeps no version history, so a change Claude makes can&apos;t be rolled back from the Notes app.</li>
        <li>Locked notes can&apos;t be read.</li>
      </ul>

      <h2>Option 3: move your notes to an app Claude can reach</h2>
      <p>
        Amber Notes is a free, open-source notes app for iPhone and Mac that works like Apple Notes and has an MCP server built in. You
        import your Apple Notes once, on your Mac, and add Amber Notes to Claude as a custom connector. After that Claude can search,
        read and edit your notes from claude.ai, the desktop app, the iPhone app and Claude Code.
      </p>
      <ul>
        <li>You approve Claude in Amber Notes and choose Read Only, or Read and Edit.</li>
        <li>When Claude changes a note, Amber Notes shows what changed, with Undo, and keeps the previous version.</li>
        <li>Custom connectors work on every Claude plan. The free plan includes one.</li>
      </ul>
      <p>
        The catch: your notes move to Amber Notes, so you&apos;d write there instead of in Apple Notes. The import leaves Apple Notes
        untouched, so you can try it and go back. <a href="/guides/move-from-apple-notes">How to move from Apple Notes</a>, then{" "}
        <a href="/guides/connect-chatgpt-to-your-notes">connect Claude</a>.
      </p>

      <h2>Which one to pick</h2>
      <ul>
        <li>You use Claude only on your Mac and want it to read notes: the desktop extension.</li>
        <li>You&apos;re comfortable with a config file and want Claude to write to Apple Notes on your Mac: a community MCP server.</li>
        <li>You want Claude to use your notes from your phone or the web, with a way to undo its changes: a notes app with its own MCP server.</li>
      </ul>
    </GuidePage>
  );
}
