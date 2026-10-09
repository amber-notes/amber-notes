import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Checklist, Keep, Steps } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("meeting-notes-to-action-items", { title: "Meeting notes to action items with ChatGPT or Claude" });

// Checked on 9 October 2026. The prompt is plain text and names no product, so it works in any AI.
// Apple Notes: Edit, Paste as Markdown turning "- [ ]" lines into a checklist is what the
// apple-notes-templates post checked in Notes on macOS 27 on 8 October. Pinto Notes: append_to_note
// (under_heading, at_start) and set_checklist_item are in supabase/functions/mcp/tools.ts, the
// "changed N lines, Undo" bar is AIMarks.swift, and "Use this template" links are NoteSource.swift,
// all present at the mac-v1.1.2 tag. The Meeting notes template is content/templates/meeting-notes.json.
// The capture is the Groceries one: there is no capture of a meeting note yet, and the caption says so.

const PROMPT = `Below are my rough notes from a meeting. Turn them into three parts.

1. Summary: two lines. What the meeting was about, and what changed because of it.
2. Decisions: a short bullet list. Only what was actually decided.
3. Action items: a Markdown checklist, one line per task, written as
   - [ ] Owner: task (due date)
   Start each task with a verb.

Rules:
- Use only what is in my notes. Don't add tasks that nobody took.
- If a task has no owner, write "Owner?". If it has no date, write "no date". Don't guess either.
- Put anything unclear under "Open questions" at the end, and ask me about it.

My notes:
`;

const FAQ = [
  { q: "Can ChatGPT turn meeting notes into action items?", a: [
    "Yes. Paste your rough notes or a transcript with a prompt that asks for decisions and a checklist with an owner and a date on every line. Tell it not to guess owners or dates, or it will fill the gaps with plausible ones.",
  ] },
  { q: "Does this work with a transcript instead of notes?", a: [
    "Yes, the same prompt works. A transcript is longer and has more small talk, so read the decisions list before you trust it: a thing somebody suggested is easily written down as a thing that was decided.",
  ] },
  { q: "How do I get the action items into Apple Notes as a checklist?", a: [
    "On a Mac with macOS 27, copy the checklist lines and choose Edit, Paste as Markdown in Notes: lines that start with - [ ] become a checklist. On iPhone, ask the AI for plain lines, paste them, select them and tap the checklist button.",
  ] },
  { q: "Does Pinto Notes record or transcribe meetings?", a: [
    "No. It's a notes app. You bring the notes or the transcript, and ChatGPT or Claude writes the decisions and action items into a note there.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="meeting-notes-to-action-items"
      intro={<>You leave the meeting with a page of half sentences and a vague idea of who does what. Here&apos;s the prompt I use to turn that page into decisions and a checklist, and what to do so the list is still alive next week.</>}
      answer={
        <Answer jump={[
          { href: "#prompt", label: "The prompt" },
          { href: "#what-you-get", label: "What you get" },
          { href: "#keep-it", label: "Where to keep the list" },
          { href: "#in-a-note", label: "Let the AI keep it" },
        ]}>
          <p>
            Paste your notes into ChatGPT or Claude with a prompt that asks for three things: a two-line summary, the decisions, and a
            checklist with an owner and a date on every line. Tell it not to guess. Then move the checklist somewhere you can tick it
            off, because a list that stays in the chat is forgotten by Thursday.
          </p>
        </Answer>
      }
      // Nothing above the intro: there's no capture of a meeting note yet, and the Groceries one belongs
      // further down, in the Pinto Notes section, captioned as what it is.
      hero={<></>}
      faq={FAQ}
    >
      <h2 id="prompt">The prompt</h2>
      <p>It names no app, so it works in ChatGPT, Claude, Gemini or anything else. Paste it, then paste your notes under it.</p>
      <Keep title="Meeting notes to action items" text={PROMPT}
        note="The two rules about guessing matter most. Without them you get a tidy list with owners nobody agreed to." />

      <h2 id="what-you-get">What you get back</h2>
      <p>
        From a page of notes on a pricing meeting, the action items come back like this. The one nobody took is marked, so you can
        sort it out while people still remember the meeting.
      </p>
      <Checklist title="Open action items" items={[
        "Sara: send the new pricing table to sales (Fri 16 Oct)",
        "Jonas: review the checkout page design (Thu 15 Oct)",
        "Owner?: check the VAT rules for Norway (no date)",
      ]} note="Copy gives you plain lines. In Apple Notes, select them and tap the checklist button." />

      <h2 id="better-notes">Three habits that make it work better</h2>
      <Steps>
        <li>
          <strong>Write names next to tasks while you&apos;re in the meeting</strong>
          &ldquo;Sara pricing table Fri&rdquo; is enough. The AI can tidy a sentence. It can&apos;t know who said they&apos;d do it.
        </li>
        <li>
          <strong>Mark decisions as you hear them</strong>
          A &ldquo;D:&rdquo; at the start of the line does it. Otherwise a suggestion and a decision look the same on the page, to you
          and to the AI.
        </li>
        <li>
          <strong>Read the list before you send it to anyone</strong>
          It takes a minute. Look at the owners and the dates, since those are the two things a wrong guess does damage with.
        </li>
      </Steps>

      <h2 id="keep-it">Where to keep the list</h2>
      <p>
        Writing the list is the easy part. The question next week is &ldquo;what&apos;s still open?&rdquo;, and the answer depends on
        where the list lives.
      </p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">The list lives in</th><th scope="col">You can tick items off</th><th scope="col">The AI knows what&apos;s open next time</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">The chat</th><td>No</td><td>Only if you find that chat again</td></tr>
            <tr><th scope="row">Apple Notes, pasted in</th><td>Yes</td><td>No. You paste the open items back in</td></tr>
            <tr><th scope="row">A note your AI can edit</th><td>Yes</td><td>Yes. It reads the note first</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Pasting into Apple Notes is a fine answer, and it costs nothing. On a Mac with macOS 27, copy the checklist and choose Edit,
        Paste as Markdown: the lines that start with <code>- [ ]</code> become a checklist. On iPhone, ask for plain lines, paste
        them, select them and tap the checklist button. <a href="/blog/apple-notes-templates">Apple Notes templates</a> has a meeting
        note to paste them into.
      </p>

      <h2 id="in-a-note">Let the AI keep the list itself</h2>
      <p>
        The third row is what I built Pinto Notes for. It&apos;s a notes app for iPhone and Mac that ChatGPT and Claude can read and
        edit once you allow it. With one Meeting notes note, the routine gets shorter:
      </p>
      <Steps>
        <li>
          <strong>After a meeting, paste your notes into the chat</strong>
          The AI adds the meeting, with its summary and decisions, at the top of the note, and each task under Open action items.
        </li>
        <li>
          <strong>Tick things off wherever you are</strong>
          In the app, by hand. Or tell the AI &ldquo;Jonas&apos;s design review is done&rdquo; and it ticks that line.
        </li>
        <li>
          <strong>Ask what&apos;s still open</strong>
          Next week, in a new chat, it reads the note and answers from what&apos;s actually unticked.
        </li>
      </Steps>
      <p>
        What the AI wrote is tinted in the note, with a bar that says how many lines it changed and an Undo. Every earlier version is
        kept, so a wrong edit is easy to put back.
      </p>
      <Figure shot={SHOTS.aiEdit} caption="A Groceries list here, not a meeting: the lines ChatGPT added are tinted, with Undo. Action items land the same way." />
      <p>
        What it doesn&apos;t do: it doesn&apos;t record or transcribe meetings, and it won&apos;t remind anyone of anything. You need
        ChatGPT on a plan that allows custom apps, or Claude; <a href="/blog/connect-chatgpt-to-your-notes">connecting ChatGPT</a> takes
        a few minutes. The free <a href="/templates/meeting-notes">Meeting notes template</a> has the note and the prompt that goes
        with it, and there&apos;s one for <a href="/templates/one-on-one-notes">one-on-ones</a> too.
      </p>
      <PostCta slug="meeting-notes-to-action-items" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>One note for every meeting&apos;s decisions and action items, written by your AI and ticked off by you.</p>
      </PostCta>
    </PostPage>
  );
}
