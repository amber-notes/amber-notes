import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Capture, Keep, Steps } from "@/lib/PostParts";
import { CLAUDE_DIRECTORY_URL, MCP_URL } from "@/lib/facts";

export const dynamic = "force-static";
export const metadata = postMetadata("claude-memory-vs-notes", { title: "Claude memory vs notes Claude can read and write" });

const FAQ = [
  { q: "Can ChatGPT or other apps read Claude's memory?", a: [
    "No. It lives in your Claude account. You can copy it out by asking Claude to write its memories out word for word, which Anthropic documents, but nothing else reads it directly. A note in an app with an MCP server can be read by Claude, ChatGPT, Claude Code and Codex alike.",
  ] },
  { q: "Should I turn Claude's memory off if I keep notes?", a: [
    "Not necessarily. Memory is good for how you like Claude to work with you. Notes are for anything you want to read again word for word, tick off or keep. They work well together.",
  ] },
];

const MEMORY_LINE = `Remember this: when I ask you to note, save or add something, put it in Amber Notes. Look for an existing note first and add to it, and only start a new note when nothing fits.`;

const MOVE_PROMPT = `Write out your memories of me verbatim, exactly as they appear in your memory. Then create a note in Amber Notes called "About me (for Claude)" with them, under the headings Work, Preferences and Projects. Don't add anything that isn't in your memory, and tell me what you left out.`;

export default function Page() {
  return (
    <PostPage
      slug="claude-memory-vs-notes"
      intro={<>Claude remembers things about you now, so why connect it to your notes? Because they keep different things. Here&apos;s the difference, and how to use both.</>}
      answer={
        <Answer jump={[
          { href: "#side-by-side", label: "Side by side" },
          { href: "#use-both", label: "Use both" },
          { href: "#connect", label: "Connect Claude" },
        ]}>
          <p>
            Claude&apos;s memory is Claude&apos;s own summary of you, in topics it writes and you can edit under Settings, Memory. A note is your
            own text, word for word, on your phone and computer. Use memory for how Claude should work with you, and notes for anything you
            want to read again, tick off or keep. With a notes app Claude can reach, it can write to both.
          </p>
        </Answer>
      }
      hero={<Capture priority src="/blog/amber-notes-claude-edit-lisbon" width={1500} height={748} maxWidth={750}
        phone={{ src: "/blog/amber-notes-claude-edit-lisbon-note", width: 865, height: 555 }}
        alt="A Lisbon trip note in Amber Notes on a Mac. In the Plan checklist, the line Claude just added, Late checkout requested, confirm by 10 May, is tinted, and a bar at the bottom says Claude changed 1 line, with Undo."
        caption="Amber Notes on a Mac, just after Claude added a line to a trip plan. The new line is tinted, with Undo." />}
      faq={FAQ}
    >
      <h2 id="what-it-is">What Claude&apos;s memory is</h2>
      <p>
        According to Anthropic&apos;s <a href="https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context" rel="noopener">help
        page on memory</a>, Claude saves what it learns about you as a set of separate topics while you chat, and you can ask it to remember
        something on purpose. A few details matter:
      </p>
      <ul>
        <li><strong>Where it lives.</strong> Settings, Memory, where &ldquo;Generate memory from chats&rdquo; turns it on or off. You can open each topic, edit it or delete it there.</li>
        <li><strong>Who has it.</strong> On by default on Free, Pro and Max, on the web, in Claude Desktop and in the iPhone app. On Team and Enterprise, an owner decides.</li>
        <li><strong>Projects.</strong> Each project has its own memory, separate from your other chats.</li>
        <li><strong>What it leaves out.</strong> Incognito chats, and by default sensitive topics such as financial account numbers.</li>
      </ul>

      <h2 id="side-by-side">Side by side</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col"></th><th scope="col">Claude&apos;s memory</th><th scope="col">Notes Claude can read and write</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">Who writes it</th><td>Claude, plus what you ask it to remember</td><td>You, and Claude when you ask it to</td></tr>
            <tr><th scope="row">Exact wording</th><td>Short topics in Claude&apos;s words</td><td>The whole text, as written</td></tr>
            <tr><th scope="row">Where you read it</th><td>Claude&apos;s settings</td><td>Your notes app, on iPhone and Mac</td></tr>
            <tr><th scope="row">Lists you tick off</th><td>No</td><td>Yes, as checklists</td></tr>
            <tr><th scope="row">Other AI apps</th><td>Claude only</td><td>Any app that connects to the notes app, such as ChatGPT or Claude Code</td></tr>
            <tr><th scope="row">A change you didn&apos;t want</th><td>Edit or delete the topic</td><td>In Amber Notes: Undo, and earlier versions kept</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        So memory suits things like your job, the tone you like and the tools you use: context you&apos;d otherwise repeat. Notes suit trip
        plans, shopping lists, meeting notes and drafts: things you&apos;ll read again yourself, often on your phone. If you also use ChatGPT,{" "}
        <a href="/blog/chatgpt-memory-vs-notes">ChatGPT memory vs notes</a> is the same comparison for its memory, and the notes are the one
        place both can read.
      </p>

      <h2 id="use-both">Use both</h2>
      <p>
        Put the habit in memory and the content in notes. Once Claude can reach your notes, send it this once, and it keeps the rule in its
        memory:
      </p>
      <Keep title="A line for Claude's memory" text={MEMORY_LINE} />
      <p>
        You can also move what Claude remembers into a note you can read and edit. The first sentence is the one Anthropic suggests for
        copying your memory out; the rest saves it as a note.
      </p>
      <Keep title="Copy Claude's memory into a note" text={MOVE_PROMPT}
        note="Claude reads the result back from the note in later chats, and you can fix anything it got wrong in the note itself." />

      <h2 id="connect">Connect Claude to your notes</h2>
      <p>
        Claude reaches a notes app through a connector, which is an MCP server. Amber Notes is in Claude&apos;s connector directory:
      </p>
      <Steps>
        <li>Open <a href={CLAUDE_DIRECTORY_URL} rel="noopener">the Amber Notes listing</a> on claude.ai or in the Claude desktop app, and choose Connect to Claude.</li>
        <li>Sign in to Amber Notes on the page that opens.</li>
        <li>Amber Notes on your iPhone or Mac asks whether to allow Claude. Pick Read and Edit or Read Only, and choose Allow.</li>
      </Steps>
      <p>
        Once it&apos;s added, the Claude iPhone app can use it too. On Team and Enterprise an owner may need to allow it first. If your Claude
        app doesn&apos;t show the listing, add <code>{MCP_URL}</code> as a custom connector, under Customize, Connectors; that
        works on every plan. <a href="/blog/connect-chatgpt-to-your-notes">Connecting ChatGPT and Claude</a> has the details, and{" "}
        <a href="/blog/claude-and-apple-notes">Claude and Apple Notes</a> covers your options if your notes are still in Apple Notes.
      </p>

      <h2 id="amber-notes">Why I built Amber Notes this way</h2>
      <p>
        I make Amber Notes, a notes app for iPhone and Mac that Claude, ChatGPT, Claude Code and Codex can use. When Claude adds to a note
        it changes only those lines, the change shows up tinted with Undo, and the version before is kept in the note&apos;s history, with
        Claude named as the one who made it. Your notes are end-to-end encrypted, and only the AI connections you approve can read them;
        locked notes stay out of reach even then.
      </p>
      <p>
        It isn&apos;t a replacement for Claude&apos;s memory, and it doesn&apos;t read it. It&apos;s the place for the things you want to keep in
        your own words. <a href="/blog/move-from-apple-notes">Moving from Apple Notes</a> is one import on your Mac.
      </p>
      <PostCta slug="claude-memory-vs-notes" position="how-amber-helps" title="Try Amber Notes on your Mac">
        <p>Notes Claude can read and add to when you allow it, with every change marked and undoable.</p>
      </PostCta>
    </PostPage>
  );
}
