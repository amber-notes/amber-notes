import { Figure } from "@/lib/blog";
import { PostCta } from "@/lib/PostCta";
import { PostPage, postMetadata } from "@/lib/PostPage";
import { Answer, Capture, Steps } from "@/lib/PostParts";
import { APPLE_NOTES_TEMPLATES } from "@/lib/apple-notes-templates";
import { TemplatePicker } from "@/lib/TemplatePicker";
import { SHOTS } from "@/lib/posts";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-templates", { title: "Apple Notes templates: make your own, plus five to copy" });

const FAQ = [
  { q: "Does Apple Notes have templates?", a: [
    "No. Notes on iPhone and Mac has no template feature, in iOS 27 and macOS 27 either. Keep each template as a note in its own folder, and duplicate or copy it when you need it.",
  ] },
  { q: "Can every new note start from a template?", a: [
    "No. A new note in Apple Notes always starts empty, and there's no setting for what goes in it.",
  ] },
  { q: "How do I duplicate a note in Apple Notes?", a: [
    "On a Mac, select the note and choose File, Duplicate Note, or press Command-D. The copy lands in the same folder. On iPhone, select everything in the note, copy it, and paste it into a new note.",
  ] },
  { q: "How do I make a checklist template?", a: [
    "Write the items as lines, select them and tap the checklist button, or on a Mac choose Format, Checklist. On macOS 27 you can instead paste lines that start with - [ ] using Edit, Paste as Markdown, and they become a checklist.",
  ] },
  { q: "Where can I download Apple Notes templates?", a: [
    "There's nothing to download or install: a template is just a note. Copy one of the five on this page and paste it into a new note.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-templates"
      intro={<>Apple Notes has no templates button, but a folder of notes does the same job. Here&apos;s how to set one up, and five templates to copy that paste in with real headings and checklists.</>}
      answer={
        <Answer jump={[
          { href: "#set-it-up", label: "Set it up once" },
          { href: "#templates", label: "Five templates" },
          { href: "#paste", label: "Paste formatted" },
        ]}>
          <p>
            Apple Notes has no templates. Make a Templates folder with one note per template. When you need one, duplicate it on a Mac
            (File, Duplicate Note) or copy it into a new note on iPhone. On macOS 27, the templates below paste in with Edit, Paste as
            Markdown, headings and checklists included.
          </p>
        </Answer>
      }
      hero={<Capture priority src="/blog/macos27/notes-templates-window" width={1538} height={984} maxWidth={760}
        phone={{ src: "/blog/macos27/notes-templates", width: 620, height: 730 }}
        alt="Apple Notes on macOS 27 with a Templates folder of five notes: Meeting notes, Weekly review, Packing list, Groceries and Today. Packing list is open, with Documents, Clothes and Bag headings, each over a checklist of three items."
        caption="A Templates folder in Notes on macOS 27. Each note was pasted in from this page with Edit, Paste as Markdown." />}
      faq={FAQ}
    >
      <h2 id="set-it-up">Set it up once</h2>
      <Steps>
        <li>In Notes, make a new folder and call it Templates.</li>
        <li>Add one note per template: paste one of <a href="#templates">the five below</a>, or write your own.</li>
        <li>Leave the templates blank. Fill in the copies, so a template never carries last week&apos;s answers.</li>
      </Steps>
      <p className="label"><strong>Using one on a Mac</strong></p>
      <p>
        Select the template and choose File, Duplicate Note, or press Command-D. The copy appears in the Templates folder with its
        checklists intact; drag it to the folder where it belongs.
      </p>
      <Capture src="/blog/macos27/notes-file-duplicate-note" width={554} height={296} maxWidth={277}
        alt="The lower part of the File menu in Notes on macOS 27: Export To, Pin Note, Lock Note, Duplicate Note with Command-D, highlighted, and Print."
        caption="File, Duplicate Note in Notes on macOS 27." />
      <p className="label"><strong>Using one on iPhone</strong></p>
      <p>
        Open the template, select everything in it and copy it, then start a new note in the folder where it belongs and paste.
        Checklists and headings come along, because you&apos;re copying from one note to another.
      </p>

      <h2 id="templates">Five templates to copy</h2>
      <p>Each is written in Markdown, so it arrives formatted when you <a href="#paste">paste it as Markdown</a>. Every item has a word in it, on purpose: an empty checklist item doesn&apos;t survive the paste.</p>
      <TemplatePicker templates={APPLE_NOTES_TEMPLATES} legend="Pick a template" />

      <h2 id="paste">Paste them in formatted</h2>
      <p>
        On a Mac with macOS 27, start a new note and choose Edit, Paste as Markdown. The # line becomes the title, ## lines become
        headings, and - [ ] lines become a checklist. A plain Command-V keeps the symbols as text.
      </p>
      <p>
        On iPhone with iOS 27, Apple says Markdown formats itself when you paste it. On older versions, paste the text, select the
        lines that should be a checklist and tap the checklist button. The rest of what changed for Markdown in Notes is in{" "}
        <a href="/blog/apple-notes-ios-27">what&apos;s new in Apple Notes in iOS 27</a>.
      </p>

      <h2 id="amber-notes">Templates that fill themselves in</h2>
      <p>
        A template in Apple Notes stays a blank form you fill in by hand. I make Pinto Notes, a notes app for iPhone and Mac that ChatGPT
        and Claude can read and write, and its free <a href="/templates">template library</a> works differently. Use template adds the note
        to Pinto Notes, and each one comes with a prompt, so you tell ChatGPT or Claude what happened and it files it under the right
        heading, ticking things off as you go. <a href="/blog/move-from-apple-notes">Your Apple Notes come over</a> in one import, and
        Apple Notes isn&apos;t changed.
      </p>
      <Figure shot={SHOTS.lisbon} caption="A trip note in Pinto Notes on a Mac: a plan checklist, places to see, a linked booking and a table of where to eat." />
      <PostCta slug="apple-notes-templates" position="how-amber-helps" title="Try Pinto Notes on your Mac">
        <p>Free templates that ChatGPT and Claude fill in for you, with every change marked and undoable.</p>
      </PostCta>
    </PostPage>
  );
}
