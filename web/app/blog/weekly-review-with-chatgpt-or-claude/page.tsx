import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Checklist, Keep, Steps } from "@/lib/PostParts";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("weekly-review-with-chatgpt-or-claude", { title: "Weekly review with ChatGPT or Claude: prompt and questions" });

// Checked on 10 October 2026. The prompt is plain text and names no product, so it works in any AI.
// The five questions and the twenty minutes are the Weekly review template's
// (content/templates/weekly-review.json). Apple Notes: Edit, Paste as Markdown turning "- [ ]" lines
// into a checklist is what the apple-notes-templates post checked in Notes on macOS 27 on 8 October.
// Pinto Notes: append_to_note (under_heading, at_start), set_checklist_item and read_table are in
// supabase/functions/mcp/tools.ts, the "changed N lines, Undo" bar is AIEdit.swift and version
// history is VersionHistoryView.swift, on main on 10 October. The capture is the Evening tracker one: there
// is no capture of a Weekly review note yet, and the caption says what it shows.

const PROMPT = `Let's do my weekly review. Ask me these five questions one at a time, and wait for my answer before you ask the next.

1. What went well this week?
2. What didn't, and why?
3. What did I learn?
4. What am I grateful for?
5. What are my top three for next week?

If an answer is vague, ask one short follow-up, then move on.

When I've answered all five, write the week up like this:
- A heading: "Week of" and Monday's date.
- One short bullet per question, in my own words. No advice.
- My top three as a Markdown checklist, one line each:
  - [ ] task

If I paste last week's review before we start, first ask me how each of last week's three went.
`;

const FAQ = [
  { q: "Can ChatGPT do a weekly review with me?", a: [
    "Yes. Give it the questions and tell it to ask them one at a time and wait for your answer. Then ask for a short write-up with your top three for next week as a checklist. The prompt in this post does both.",
  ] },
  { q: "What questions should a weekly review ask?", a: [
    "Five are enough: what went well, what didn't and why, what you learned, what you're grateful for, and your top three for next week. The last one is the one you'll use on Monday.",
  ] },
  { q: "How long does a weekly review take?", a: [
    "About twenty minutes for five questions. If it takes an hour you'll skip it in week three, so keep the answers short.",
  ] },
  { q: "Will ChatGPT or Claude remember last week's review?", a: [
    "Don't count on it. Paste last week's review in, or keep the reviews in a note the AI can read, so it works from what you wrote and not from what it recalls.",
  ] },
  { q: "Does Pinto Notes remind me to do the review?", a: [
    "No. It's a notes app and sends no reminders. Put the review in your calendar, and say \"it's time for my weekly review\" to your AI when the time comes.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="weekly-review-with-chatgpt-or-claude"
      intro={<>The hard part of a weekly review is the blank page on Sunday evening. Let an AI ask the questions one at a time, and all you have to do is answer.</>}
      answer={
        <Answer jump={[
          { href: "#prompt", label: "The prompt" },
          { href: "#what-you-get", label: "What you get" },
          { href: "#keep-going", label: "Keeping it going" },
          { href: "#keep-it", label: "Where the reviews live" },
          { href: "#in-a-note", label: "Let the AI keep them" },
        ]}>
          <p>
            Paste the prompt below into ChatGPT or Claude. It asks five questions, one at a time: what went well, what didn&apos;t,
            what you learned, what you&apos;re grateful for, and your top three for next week. Then it writes the week up as a few
            bullets and a checklist. Keep every week in one note, newest first, so next Sunday starts from last week&apos;s three.
          </p>
        </Answer>
      }
      // Nothing above the intro: there's no capture of a Weekly review note yet, and the tracker one
      // belongs further down, in the Pinto Notes section, captioned as what it is.
      hero={<></>}
      faq={FAQ}
    >
      <h2 id="prompt">The prompt</h2>
      <p>It names no app, so it works in ChatGPT, Claude, Gemini or anything else. It takes about twenty minutes from first question to write-up.</p>
      <Keep title="Weekly review" text={PROMPT}
        note="Keep “in my own words” and “no advice”. Without them the write-up comes back longer and tidier than your week was, and it's less use when you read it in a month." />

      <h2 id="what-you-get">What you get back</h2>
      <p>A few lines you can read in ten seconds next Sunday. For a week that started on Monday 5 October:</p>
      <ul>
        <li><strong>Went well:</strong> shipped the pricing page; two early nights.</li>
        <li><strong>Didn&apos;t:</strong> no deep work on Thursday, too many meetings.</li>
        <li><strong>Learned:</strong> a 30-minute agenda beats a 60-minute meeting.</li>
        <li><strong>Grateful for:</strong> dinner with my sister.</li>
      </ul>
      <Checklist title="Top three for next week" items={[
        "Block Thursday mornings for deep work",
        "Send the Q4 plan to Jonas",
        "Book the dentist",
      ]} note="Copy gives you plain lines. In Apple Notes, select them and tap the checklist button." />

      <h2 id="keep-going">Three things that keep it going</h2>
      <Steps>
        <li>
          <strong>Give it a fixed time</strong>
          Sunday evening or Friday afternoon, in your calendar. The AI won&apos;t start the review for you.
        </li>
        <li>
          <strong>Stop at three for next week</strong>
          A list of nine is a to-do list, and by Wednesday you won&apos;t remember what was on it.
        </li>
        <li>
          <strong>Start from last week&apos;s three</strong>
          &ldquo;How did those go?&rdquo; is the most useful question in the review, and you can only ask it if last week is still
          somewhere you can find.
        </li>
      </Steps>

      <h2 id="keep-it">Where the reviews live</h2>
      <p>The third habit depends on where you keep the write-ups.</p>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th scope="col">The reviews live in</th><th scope="col">You can read back over the weeks</th><th scope="col">The AI starts from last week</th></tr>
          </thead>
          <tbody>
            <tr><th scope="row">The chat</th><td>By scrolling, if you keep to one chat</td><td>Only in that chat</td></tr>
            <tr><th scope="row">Apple Notes, pasted in</th><td>Yes</td><td>No. You paste last week back in</td></tr>
            <tr><th scope="row">A note your AI can edit</th><td>Yes</td><td>Yes. It reads the note first</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Apple Notes is a fine place for them, and it costs nothing. On a Mac with macOS 27, copy the write-up and choose Edit, Paste
        as Markdown: the lines that start with <code>- [ ]</code> become a checklist. On iPhone, paste it, select the three lines
        and tap the checklist button. <a href="/blog/apple-notes-templates">Apple Notes templates</a> has a Weekly review note to
        duplicate each week.
      </p>

      <h2 id="in-a-note">Let the AI keep the reviews itself</h2>
      <p>
        The third row is what I built Pinto Notes for. It&apos;s a notes app for iPhone and Mac that ChatGPT and Claude can read and
        edit once you allow it. With one Weekly review note, Sunday looks like this:
      </p>
      <Steps>
        <li>
          <strong>Say &ldquo;it&apos;s time for my weekly review&rdquo;</strong>
          The AI reads the note, so it has the questions and last week&apos;s three before it asks anything.
        </li>
        <li>
          <strong>Answer the five questions</strong>
          It adds the week at the top of the Reviews section, with your top three as a checklist.
        </li>
        <li>
          <strong>Tick things off during the week</strong>
          In the app, by hand. Or tell the AI &ldquo;the dentist is booked&rdquo; and it ticks that line.
        </li>
      </Steps>
      <p>
        Because every week is in the same note, you can also ask &ldquo;what keeps coming up in my reviews?&rdquo; and get an answer
        from what you wrote. And if you keep a tracker in another note, the AI can read its rows and bring the week&apos;s numbers
        into the review.
      </p>
      <Figure shot={SHOTS.tracker} ground="teal" caption="An Evening tracker in Pinto Notes on a Mac, not a weekly review: one row a day. The AI can read these rows when it writes up the week." />
      <p>
        What the AI wrote is tinted in the note, with a bar that says how many lines it changed and an Undo. Every earlier version is
        kept, so a wrong edit is easy to put back.
      </p>
      <p>
        What it doesn&apos;t do: it sends no reminders, so the fixed time is still yours to keep. You need ChatGPT on a plan that
        allows custom apps, or Claude; <a href="/blog/connect-chatgpt-to-your-notes">connecting ChatGPT</a> takes a few minutes. The
        free <a href="/templates/weekly-review">Weekly review template</a> has the note and the prompt that goes with it, and there
        are ones for a <a href="/templates/habit-tracker">habit tracker</a> and a <a href="/templates/daily-journal">daily
        journal</a> too.
      </p>
      <PostCta slug="weekly-review-with-chatgpt-or-claude" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>One note for every week&apos;s review, written up by your AI and read back by you.</p>
      </PostCta>
    </PostPage>
  );
}
