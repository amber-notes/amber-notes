import { PostPage, postMetadata } from "@/lib/PostPage";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-ios-27", { title: "Apple Notes in iOS 27: what's new, and what AI can't do" });

const FAQ = [
  { q: "What's new in Apple Notes in iOS 27?", a: [
    "Divider lines, links to a section of a note, Copy as Markdown and Markdown that formats itself when you paste it, and Siri AI, which can find a note or search inside one. On a Mac, macOS 27 brings the same, and renames File, Export as to File, Export To.",
  ] },
  { q: "How do I add a divider line in Apple Notes?", a: [
    "On iPhone, tap where the line should go, tap the Expand button in the edit menu, then choose Insert Divider Line. On a Mac, choose Edit, Insert Divider Line, or press Command-L.",
  ] },
  { q: "Can Siri read my Apple Notes in iOS 27?", a: [
    "Siri AI can search for a note and search inside notes, for example “What was the note with the cookie recipe?”. It's in beta, in English to start, on iPhone 15 Pro and later, and not yet in the EU.",
  ] },
  { q: "Can ChatGPT or Claude read my Apple Notes in iOS 27?", a: [
    "Not on their own. Siri can pass a request to ChatGPT if you turn on the ChatGPT extension, and you choose what goes with it. Claude isn't offered there. Apple Notes still has no API, so the ChatGPT and Claude apps can't search or edit your notes from iPhone or the web.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-ios-27"
      intro={<>iOS 27 and macOS 27 came out on 14 September, and Apple Notes got some of the features I&apos;ve wanted for years: divider lines, links to a section of a note, and Markdown both ways. Here&apos;s what&apos;s new, how to use each one, and the part the roundups skip: what ChatGPT and Claude still can&apos;t do with your notes.</>}
      faq={FAQ}
    >
      <h2>What&apos;s new, in one table</h2>
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
            <tr><th scope="row">Siri AI finds notes</th><td>&ldquo;What was the note with the cookie recipe?&rdquo;</td><td>Siri AI is in beta on macOS 27 too</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Divider lines</h2>
      <p>
        A plain horizontal line between parts of a note. On iPhone, tap where you want it, tap the Expand button in the edit menu, and choose
        Insert Divider Line. On a Mac, choose Edit, Insert Divider Line, or press Command-L. Apple describes both in its
        guides, <a href="https://support.apple.com/guide/iphone/create-and-format-notes-iph1ac0b3a2/ios" rel="noopener">Create and format notes on iPhone</a> and <a href="https://support.apple.com/guide/notes/apd1955d3b21/mac" rel="noopener">Format notes on Mac</a>.
      </p>

      <h2>Links to a section of a note</h2>
      <p>
        Headings in a note are now places you can link to, in the same note or in another one. It&apos;s the feature that turns a long note into
        something you can navigate: a contents list at the top, or a link from your weekly plan straight to the right day.
      </p>
      <ol>
        <li>Make the sections first: select a line, tap the Format button, and choose Heading or Subheading.</li>
        <li>Select the text for the link, or tap where it should go, then choose Add Link from the edit menu (on a Mac, Edit, Add Link).</li>
        <li>Choose Link to Section and pick a heading. Turn on Use Section Title to name the link after it, or type your own name.</li>
      </ol>
      <p>
        To link to a section in another note, link to that note first, then choose Link to Section. There&apos;s a shortcut on iPhone: type
        <code>&gt;&gt;</code> and the note&apos;s title, then <code>/</code> to pick one of its sections. If a heading is renamed, links named after
        it update too. The steps are in <a href="https://support.apple.com/guide/iphone/iph908d1558b/ios" rel="noopener">Add links in Notes on iPhone</a>.
      </p>

      <h2>Markdown in and out</h2>
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

      <h2>Siri AI and your notes</h2>
      <p>
        The new Siri, called Siri AI, can search for notes and search inside them. Apple&apos;s example is &ldquo;What was the note with the
        cookie recipe?&rdquo;, in <a href="https://support.apple.com/en-us/118442" rel="noopener">Use Notes on your iPhone</a>. Siri AI can also
        write a draft or proofread something you&apos;ve written, such as a note. A few limits, from Apple:
      </p>
      <ul>
        <li>It&apos;s in beta, in English to start, with French, Japanese, Korean, Portuguese and Spanish due in October.</li>
        <li>It needs an iPhone that runs Apple Intelligence: iPhone 15 Pro, iPhone 15 Pro Max, or any iPhone 16 or later.</li>
        <li>It isn&apos;t available in the EU on iPhone at first, and some requests count against a daily limit.</li>
      </ul>

      <h2>What ChatGPT and Claude still can&apos;t do</h2>
      <p>
        This is the part people ask me about most. Apple Notes still has no public API, so everything an AI does with it goes through your
        device, and it stops there:
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">What works with Apple Notes</th><th scope="col">What doesn&apos;t</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">ChatGPT through Siri</th><td>Turn on the ChatGPT extension in Settings, Siri, and Siri can pass a request to ChatGPT, with content you choose to send</td><td>Apple doesn&apos;t describe a way for ChatGPT to search your notes or save into one</td></tr>
            <tr><th scope="row">The ChatGPT app</th><td>Paste a note in, and paste the answer back (it now arrives formatted)</td><td>Searching or editing your notes</td></tr>
            <tr><th scope="row">Claude</th><td>On a Mac, the Claude desktop app can read Apple Notes through a desktop extension, and community MCP servers can edit them</td><td>Claude on iPhone and on the web can&apos;t reach Apple Notes; Siri doesn&apos;t offer Claude as an extension</td></tr>
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

      <h2>If you want your AI to work in your notes</h2>
      <p>
        iOS 27 makes Apple Notes a nicer place to write. It doesn&apos;t let ChatGPT or Claude keep a list for you, fix a note while you&apos;re
        on the train, or write your standup into it. That&apos;s the gap I built Amber Notes for: a notes app for iPhone and Mac that looks and
        works like Apple Notes, with a server built in that ChatGPT, Claude, Claude Code, Codex and Incredible can use to search, read and
        edit your notes. You approve each app once, every AI change shows up tinted with an Undo, and older versions stay in the history.
      </p>
      <p>
        <a href="/blog/connect-chatgpt-to-your-notes">Connecting ChatGPT or Claude</a> takes a couple of minutes. For the full comparison,
        including what Apple Notes still does better, see <a href="/blog/amber-notes-vs-apple-notes">Amber Notes vs Apple Notes</a>.
      </p>
    </PostPage>
  );
}
