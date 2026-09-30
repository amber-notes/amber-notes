import { GuidePage, guideMetadata } from "@/lib/GuidePage";

export const dynamic = "force-static";
export const metadata = guideMetadata("chatgpt-and-apple-notes");

const FAQ = [
  { q: "Can ChatGPT search all my Apple Notes?", a: [
    "No. Apple Notes has no public API, so ChatGPT can only see a note you show it: the one open on your Mac, or text you select or paste.",
  ] },
  { q: "Can ChatGPT save changes to Apple Notes?", a: [
    "Not by itself. On a Mac it can suggest text for the open note, and with Apple Intelligence it can rewrite text you've selected, but it can't open another note or save to it.",
  ] },
];

export default function Page() {
  return (
    <GuidePage
      slug="chatgpt-and-apple-notes"
      lede="ChatGPT can help with the note in front of you, but it can't search your notes or save to them. Here are the three ways it works today."
      faq={FAQ}
    >
      <h2>Why ChatGPT can&apos;t search Apple Notes</h2>
      <p>
        Apple Notes has no public API, and Apple doesn&apos;t let outside services read your notes in iCloud. ChatGPT only ever sees a
        note you put in front of it. It can&apos;t look through your other notes, and it can&apos;t save a change on its own.
      </p>

      <h2>1. ChatGPT for Mac: Work with Apps</h2>
      <p>
        The ChatGPT app for Mac can look at the note you have open in Apple Notes. Press Option-Space (or click ChatGPT in the menu bar),
        choose Notes from the apps it can work with, and ask about the note. OpenAI&apos;s help page, Work with Apps on macOS, lists
        which apps are supported and which plans have it.
      </p>
      <ul>
        <li>Good for: summarizing or rewriting the note you&apos;re looking at.</li>
        <li>Not for: finding something across notes, or editing a note you don&apos;t have open.</li>
      </ul>

      <h2>2. Apple Intelligence with ChatGPT</h2>
      <p>
        On a Mac or iPhone with Apple Intelligence turned on, you can turn on the ChatGPT extension in Settings. Writing Tools in Notes
        can then send text you select to ChatGPT, and put the result back in the note.
      </p>
      <ul>
        <li>Good for: rewriting or expanding a paragraph, on iPhone too.</li>
        <li>Not for: questions about all your notes.</li>
      </ul>

      <h2>3. Copy and paste</h2>
      <p>
        Still the most common way. It works everywhere, and it&apos;s fine for one note at a time. It gets tedious when the answer has to
        go back into your notes.
      </p>

      <h2>When a different notes app makes sense</h2>
      <p>
        If you want to ask ChatGPT &ldquo;what did I write about the kitchen measurements?&rdquo; or &ldquo;add oat milk to my groceries
        note&rdquo; and have it just happen, the notes need to be in an app with an MCP server that ChatGPT can connect to.
      </p>
      <p>
        Amber Notes is a free, open-source notes app for iPhone and Mac that works like Apple Notes and has one built in. It imports your
        Apple Notes on your Mac without changing them. Once you add it to ChatGPT, ChatGPT can search, read and edit your notes, on the
        web and in its phone app. You approve it in Amber Notes, and every change it makes can be undone.
      </p>
      <p>
        <a href="/guides/move-from-apple-notes">How to move from Apple Notes</a> and{" "}
        <a href="/guides/connect-chatgpt-to-your-notes">how to connect ChatGPT</a>. Adding your own app in ChatGPT needs a paid plan
        (Plus or higher).
      </p>
    </GuidePage>
  );
}
