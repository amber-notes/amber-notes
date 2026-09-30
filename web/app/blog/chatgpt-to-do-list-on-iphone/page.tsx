import { Figure } from "@/lib/blog";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("chatgpt-to-do-list-on-iphone", { title: "ChatGPT as a to-do list that syncs to your iPhone" });

const FAQ = [
  { q: "Can ChatGPT keep a to-do list?", a: [
    "Not one you can tick off outside the chat. Connected to a notes app with an MCP server, like Amber Notes, it can add to a checklist note, tick items and tidy the list, and you see the result in the notes app on your phone and Mac.",
  ] },
  { q: "Does it work from the ChatGPT app on my iPhone?", a: [
    "Yes. You add Amber Notes once in ChatGPT on the web; after that it's available in the ChatGPT phone apps too. The Amber Notes iPhone app, where you see and tick the list, is coming soon to the App Store; the Mac app is out now.",
  ] },
  { q: "What if ChatGPT gets it wrong?", a: [
    "Every change keeps the previous version, and Amber Notes shows what ChatGPT changed with an Undo, so a wrong edit is one tap to put back.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="chatgpt-to-do-list-on-iphone"
      intro={<>My to-do list lives in a checklist note, and most items get there by me telling ChatGPT. The list is on my iPhone and Mac a second later, where I tick things off by hand. Here&apos;s the setup, the prompts that work, and how to share a list.</>}
      faq={FAQ}
    >
      <h2>What you need</h2>
      <ul>
        <li>Amber Notes, signed in: the Mac app now, the iPhone app once it&apos;s on the App Store.</li>
        <li>ChatGPT connected to it. It takes a few minutes on the web, on Plus or higher: <a href="/blog/connect-chatgpt-to-your-notes">how to connect ChatGPT to your notes</a>.</li>
        <li>A note called something like &ldquo;To do&rdquo;, with a checklist in it. In the app, the checklist button in the toolbar (or ⌘⇧L on a Mac) starts one. Or ask ChatGPT to create it.</li>
      </ul>

      <h2>Prompts that work</h2>
      <ul>
        <li>&ldquo;Create a note called To do with a checklist: renew passport, call the dentist, book the car service.&rdquo;</li>
        <li>&ldquo;Add &lsquo;pick up the dry cleaning&rsquo; to my To do note.&rdquo;</li>
        <li>&ldquo;Tick off &lsquo;call the dentist&rsquo; in To do.&rdquo;</li>
        <li>&ldquo;What&apos;s still open on my To do list?&rdquo;</li>
        <li>&ldquo;Plan Sunday&apos;s paella for eight and add what I need to Groceries.&rdquo;</li>
      </ul>
      <p>
        Behind these, ChatGPT uses the small tools Amber Notes gives it: <code>append_to_note</code> to add items,{" "}
        <code>set_checklist_item</code> to tick one by its text, and <code>edit_note</code> for a precise change. It doesn&apos;t rewrite the
        whole note, so the rest of your list stays as it was. The <a href="/blog/mcp-server">MCP server page</a> lists every tool.
      </p>

      <h2>On your iPhone</h2>
      <p>
        The list syncs between iPhone and Mac in about a second. The items ChatGPT just added are tinted, with &ldquo;ChatGPT changed 5
        lines&rdquo; and an Undo at the bottom. When you tick an item in the app, it moves below the open ones.
      </p>
      <Figure shot={SHOTS.aiEdit} caption="The same edit on a Mac: what ChatGPT added is tinted, with Undo." />

      <h2>Sharing a list</h2>
      <ul>
        <li><strong>Send someone the list:</strong> open the note and choose Share, then Share Link. Anyone with the link can read it as a web page. Stop Sharing takes it down.</li>
        <li><strong>Save something into your notes from another app:</strong> on iPhone, share text, a link, a photo or a PDF to Amber Notes from the share sheet, and it&apos;s saved as a new note ChatGPT can find later.</li>
      </ul>

      <h2>Other assistants</h2>
      <p>
        The same list works with Claude, Claude Code, Codex and Incredible. Claude Code is handy for work to-dos:{" "}
        <a href="/blog/work-log-with-claude-code">keep a work log with Claude Code</a> shows how. If you&apos;re coming from Apple Notes,{" "}
        <a href="/blog/move-from-apple-notes">import your notes first</a>; ChatGPT can&apos;t reach lists that stay in Apple Notes.
      </p>
      <p>
        Wondering why not just let ChatGPT remember your to-dos? <a href="/blog/chatgpt-memory-vs-notes">ChatGPT memory vs a notes app</a> explains
        what memory keeps and what it doesn&apos;t.
      </p>
    </PostPage>
  );
}
