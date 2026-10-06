import { Figure } from "@/lib/blog";
import { Loop } from "@/lib/Loop";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Checklist, Keep, Paths, Steps } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-ios-27", { title: "What's new in Apple Notes in iOS 27, and how to use it" });

const FAQ = [
  { q: "What's new in Apple Notes in iOS 27?", a: [
    "Divider lines, links to a section of a note, Copy as Markdown and Markdown that formats itself when you paste it, and Siri AI, which can find a note, search inside one, and add to or reformat a note when you ask. On a Mac, macOS 27 brings the same, and renames File, Export as to File, Export To.",
  ] },
  { q: "How do I add a divider line in Apple Notes?", a: [
    "On iPhone, tap where the line should go, tap the Expand button in the edit menu, then choose Insert Divider Line. On a Mac, choose Edit, Insert Divider Line, or press Command-L.",
  ] },
  { q: "Can Siri read and write my Apple Notes in iOS 27?", a: [
    "Siri AI can search for a note and search inside notes, for example “What was the note with the cookie recipe?”, and it can add information to a new or existing note and reformat it when you ask. It's in beta, in English to start, on iPhone 15 Pro and later, and not yet in the EU.",
  ] },
  { q: "Can ChatGPT or Claude read my Apple Notes in iOS 27?", a: [
    "Not on their own. Siri can pass a request to ChatGPT if you turn on the ChatGPT extension, and you choose what goes with it. Claude isn't offered there. Apple Notes still has no API, so the ChatGPT and Claude apps can't search or edit your notes from iPhone or the web.",
  ] },
];

const CHEAT_SHEET = `# Apple Notes in iOS 27

## Divider line
- iPhone: edit menu, Expand, Insert Divider Line
- Mac: Edit, Insert Divider Line (Command-L)

## Link to a section
- Make headings first: Format, Heading
- Add Link, then Link to Section, and pick a heading
- iPhone shortcut: type >> and a note's title, then / for a section

## Markdown
- Paste Markdown and it turns into headings and lists
- Copy as Markdown: select text, then Copy as Markdown
- Mac export: File, Export To, Markdown

## Siri AI
- "What was the note with the cookie recipe?"
- Ask it to add to a note, or to reformat one`;

const TRY_TODAY = [
  "Add a divider line to your longest note",
  "Make its sections headings, then link to one from the top",
  "Paste a ChatGPT or Claude answer into a note and watch it format itself",
  "Select part of a note and choose Copy as Markdown",
  "Ask Siri AI \u201cWhat was the note with\u2026\u201d (iPhone 15 Pro or later)",
];

const PROMPT = "Answer in Markdown, with short headings and bullet lists, so I can paste it straight into Apple Notes. No tables, no emoji.";

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-ios-27"
      intro={<>iOS 27 and macOS 27 came out on 14 September, and Apple Notes got some of the features I&apos;ve wanted for years. Here&apos;s what&apos;s new, how to use each one, and where ChatGPT and Claude fit.</>}
      answer={
        <Answer jump={[
          { href: "#divider-lines", label: "Divider lines" },
          { href: "#section-links", label: "Section links" },
          { href: "#markdown", label: "Markdown" },
          { href: "#siri-ai", label: "Siri AI" },
          { href: "#chatgpt-and-claude", label: "ChatGPT and Claude" },
        ]}>
          <ul>
            <li><strong>Divider lines.</strong> On iPhone, Insert Divider Line in the edit menu; on a Mac, Command-L.</li>
            <li><strong>Links to a section of a note.</strong> Add Link, then Link to Section, and pick a heading.</li>
            <li><strong>Markdown both ways.</strong> Pasted Markdown turns into headings and lists, and Copy as Markdown takes it out.</li>
            <li><strong>Siri AI.</strong> Finds notes, searches inside them, and adds to or reformats one. In beta, in English, on iPhone 15 Pro and later, not yet in the EU.</li>
            <li><strong>ChatGPT and Claude</strong> still can&apos;t search or edit Apple Notes from iPhone or the web.</li>
          </ul>
        </Answer>
      }
      art="/blog/art/apple-notes-ios-27"
      faq={FAQ}
    >
      <Checklist title="Try these 5 things in Apple Notes today" items={TRY_TODAY}
        note="Copy it into a note, select the lines and tap the checklist button. That's every new feature, tried once." />

      <h2 id="in-one-table">What&apos;s new, in one table</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">Feature</th><th scope="col">On iPhone</th><th scope="col">On a Mac</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Divider lines</th><td>Edit menu, Expand button, Insert Divider Line</td><td>Edit, Insert Divider Line (Command-L)</td></tr>
            <tr><th scope="row">Links to a section</th><td>Add Link, then Link to Section</td><td>Edit, Add Link, then Link to Section</td></tr>
            <tr><th scope="row">Copy as Markdown</th><td>In the edit menu</td><td>Edit, Copy as Markdown</td></tr>
            <tr><th scope="row">Paste Markdown</th><td>Turns into headings and lists as you paste</td><td>The same</td></tr>
            <tr><th scope="row">Export as Markdown</th><td>Share, Export as Markdown (since iOS 26)</td><td>File, Export To, Markdown (was Export as)</td></tr>
            <tr><th scope="row">Siri AI in Notes</th><td>Finds notes, and adds to or reformats one when you ask</td><td>Siri AI is in beta on macOS 27 too</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="divider-lines">Divider lines</h2>
      <Paths rows={[
        { on: "iPhone", steps: ["Edit menu", "Expand", "Insert Divider Line"] },
        { on: "Mac", steps: ["Edit", "Insert Divider Line"], keys: "⌘L" },
      ]} />
      <p>
        A plain horizontal line between parts of a note. On iPhone, tap where you want it, tap the Expand button in the edit menu, and choose
        Insert Divider Line. On a Mac, choose Edit, Insert Divider Line, or press Command-L. Apple describes both in its
        guides, <a href="https://support.apple.com/guide/iphone/create-and-format-notes-iph1ac0b3a2/ios" rel="noopener">Create and format notes on iPhone</a> and <a href="https://support.apple.com/guide/notes/apd1955d3b21/mac" rel="noopener">Format notes on Mac</a>.
      </p>
      <p>
        Tables aren&apos;t on this year&apos;s list. They still have no column widths and no formulas; <a href="/blog/apple-notes-tables">tables
        in Apple Notes</a> covers what they do and the workarounds.
      </p>

      <h2 id="section-links">Links to a section of a note</h2>
      <p>
        Headings in a note are now places you can link to, in the same note or in another one. It&apos;s the feature that turns a long note into
        something you can navigate: a contents list at the top, or a link from your weekly plan straight to the right day.
      </p>
      <Steps>
        <li>Make the sections first: select a line, tap the Format button, and choose Heading or Subheading.</li>
        <li>Select the text for the link, or tap where it should go, then choose Add Link from the edit menu (on a Mac, Edit, Add Link).</li>
        <li>Choose Link to Section and pick a heading. Turn on Use Section Title to name the link after it, or type your own name.</li>
      </Steps>
      <p>
        To link to a section in another note, link to that note first, then choose Link to Section. There&apos;s a shortcut on iPhone: type
        <code>&gt;&gt;</code> and the note&apos;s title, then <code>/</code> to pick one of its sections. If a heading is renamed, links named after
        it update too. The steps are in <a href="https://support.apple.com/guide/iphone/iph908d1558b/ios" rel="noopener">Add links in Notes on iPhone</a>.
      </p>

      <h2 id="markdown">Markdown in and out</h2>
      <Paths rows={[
        { on: "iPhone", steps: ["Select text", "Edit menu", "Copy as Markdown"] },
        { on: "Mac", steps: ["Edit", "Copy as Markdown"] },
        { on: "Export, Mac", steps: ["File", "Export To", "Markdown"] },
      ]} />
      <p>
        iOS 26 and macOS 26 added Markdown export and import, one note at a time. iOS 27 and macOS 27 add the everyday half: paste Markdown
        into a note and it becomes headings, lists and bold text, and select part of a note and choose Copy as Markdown to take it out
        again. That&apos;s handy for anything you write with an AI chat: paste ChatGPT&apos;s answer and it arrives formatted, not full of
        asterisks.
      </p>
      <p>
        On a Mac, the export menu moved: it&apos;s now File, Export To, then Markdown or PDF. <a href="/blog/export-apple-notes-to-markdown">How
        to export Apple Notes to Markdown</a> has the steps for both versions, what to check in the file, and what to use for every note at once.
      </p>
      <Keep title="The cheat sheet, as Markdown" text={CHEAT_SHEET} code
        note="Copy it and paste it into a new note on iOS 27 or macOS 27: it arrives as headings and lists, which makes it a good first test of the new Markdown paste." />
      <Keep title="A prompt for ChatGPT, Claude or Gemini" text={PROMPT}
        note="Add it to the end of a question, then paste the answer into a note. It arrives formatted instead of full of asterisks." />
      <Figure shot={SHOTS.notesExportMenu} caption="The menu before the move: File, Export as, Markdown, in Notes on macOS 26. On macOS 27 it reads File, Export To." />

      <h2 id="siri-ai">Siri AI and your notes</h2>
      <p>
        The new Siri, called Siri AI, can search for notes and search inside them. Apple&apos;s example is &ldquo;What was the note with the
        cookie recipe?&rdquo;, in <a href="https://support.apple.com/en-us/118442" rel="noopener">Use Notes on your iPhone</a>. It can also
        write into Notes: ask it to add something to a new or existing note, or to reformat what&apos;s there, as 9to5Mac
        found in <a href="https://9to5mac.com/2026/09/28/heres-everything-new-for-apple-notes-in-ios-27/" rel="noopener">its roundup</a> on
        28 September. That&apos;s a real change from earlier versions, where Siri could do little more than make a note. Siri AI can also
        write a draft or proofread something you&apos;ve written. A few limits, from Apple:
      </p>
      <ul>
        <li>It&apos;s in beta, in English to start, with French, Japanese, Korean, Portuguese and Spanish due in October.</li>
        <li>It needs an iPhone that runs Apple Intelligence: iPhone 15 Pro, iPhone 15 Pro Max, or any iPhone 16 or later.</li>
        <li>It isn&apos;t available in the EU on iPhone at first, and some requests count against a daily limit.</li>
      </ul>

      <h2 id="chatgpt-and-claude">Where ChatGPT and Claude fit</h2>
      <p>
        Siri now works in your notes, but ChatGPT and Claude mostly still can&apos;t. Apple Notes has no public API, so everything an
        outside AI does with it goes through your device, and it stops there:
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">What works with Apple Notes</th><th scope="col">What doesn&apos;t</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">ChatGPT through Siri</th><td>Turn on the ChatGPT extension in Settings, Siri, and Siri can pass a request to ChatGPT, with content you choose to send</td><td>Apple doesn&apos;t describe a way for ChatGPT to search your notes or save into one</td></tr>
            <tr><th scope="row">The ChatGPT app</th><td>Paste a note in, and paste the answer back (it now arrives formatted)</td><td>Searching or editing your notes</td></tr>
            <tr><th scope="row">Claude</th><td>On a Mac, the Claude desktop app can read and edit Apple Notes through Anthropic&apos;s Read and Write Apple Notes extension, and community MCP servers can too</td><td>Claude on iPhone and on the web can&apos;t reach Apple Notes; Siri doesn&apos;t offer Claude as an extension</td></tr>
            <tr><th scope="row">MCP in iOS</th><td>Nothing yet</td><td>Code for MCP support was spotted in a macOS 26.1 beta, but Apple hasn&apos;t shipped or announced it</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Apple&apos;s ChatGPT steps are in <a href="https://support.apple.com/guide/iphone/iph0193a9d54/ios" rel="noopener">Use Siri to get answers
        from ChatGPT</a>. MacRumors found code for other AI providers in macOS 27, and reported
        on <a href="https://www.macrumors.com/2026/09/14/siri-can-be-swapped-out-for-chatgpt-claude/" rel="noopener">14 September</a> that
        Claude isn&apos;t available yet. <a href="/blog/claude-and-apple-notes">Can Claude read your Apple Notes?</a> sets out the Mac options, and
        the <a href="/blog/apple-notes-api">Apple Notes API</a> post covers what AppleScript and Shortcuts can do.
      </p>

      <h2 id="amber-notes">If you want your AI to work in your notes</h2>
      <p>
        iOS 27 makes Apple Notes a nicer place to write, and Siri can now help in it. It doesn&apos;t let ChatGPT or Claude keep a list for you, fix a note while you&apos;re
        on the train, or write your standup into it. That&apos;s the gap I built Amber Notes for: a notes app for iPhone and Mac that looks and
        works like Apple Notes, with a server built in that ChatGPT, Claude, Claude Code, Codex and Incredible can use to search, read and
        edit your notes. You approve each app once, every AI change shows up tinted with an Undo, and older versions stay in the history.
      </p>
      <Loop src="/blog/loops/amber-notes-chatgpt-edit.mp4" poster="/blog/loops/amber-notes-chatgpt-edit.webp" width={1120} height={1136}
        label="A Lisbon trip note in Amber Notes on a Mac. ChatGPT changes day 3 to Sintra and adds a dinner spot to the table; the two changed lines turn amber, a bar says ChatGPT changed 2 lines with Undo, and the tint fades."
        caption="ChatGPT edits a note in Amber Notes: the two lines it changed are tinted, with an Undo, then the tint fades." />
      <p>
        <a href="/blog/connect-chatgpt-to-your-notes">Connecting ChatGPT or Claude</a> takes a couple of minutes. For the full comparison,
        including what Apple Notes still does better, see <a href="/blog/amber-notes-vs-apple-notes">Amber Notes vs Apple Notes</a>,
        and the <a href="/templates">free templates</a> are ready-made notes, like a trip plan or a weekly review, to start from.
      </p>
      <PostCta slug="apple-notes-ios-27" position="how-amber-helps" title="Notes ChatGPT and Claude can work in">
        <p>Amber Notes looks and works like Apple Notes, and imports your notes from it on the Mac.</p>
      </PostCta>
    </PostPage>
  );
}
