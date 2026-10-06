import { PostPage, postMetadata } from "@/lib/PostPage";
import { Figure } from "@/lib/blog";
import { SHOTS } from "@/lib/posts";
import { APP_STORE_LIVE } from "@/lib/site";

export const dynamic = "force-static";
export const metadata = postMetadata("apple-notes-tables", { title: "Apple Notes tables: column width, sums and formulas" });

// Checked on 4 October 2026 against Apple's pages: Add a table in Notes on Mac (macOS 27 and 26), Create
// and format notes on iPhone (iOS 27), and Solve math in Notes on Mac. Menu names read from Notes on
// macOS 26.5: MainMenu.nib (Format, Table, Option-Command-T; Convert to Text; Format, Math Results) and the
// app's Shortcuts actions (Add Table to Note, which takes comma-separated values). Amber Notes' side
// checked in Pane/Editor/TableGrid.swift, Pane/Editor/TableChart.swift, Pane/Model/XLSXImporter.swift and
// the read_table and log_table_row tools in supabase/functions/mcp/tools.ts.

const FAQ = [
  { q: "Can you change the column width of a table in Apple Notes?", a: [
    "No. Apple Notes sets column widths itself, and neither the Format menu nor Apple's guide has a way to drag or set them. Shorter header text, and longer text moved below the table, are the only levers.",
  ] },
  { q: "Can Apple Notes add up a column in a table?", a: [
    "No. Tables in Apple Notes have no formulas and no sum. Math Results, which solves sums like 120+45= as you type, is documented for the body of a note, not for table cells. Write the total as a sum under the table, or move the data to Numbers.",
  ] },
  { q: "How do I add a row or column to an Apple Notes table?", a: [
    "On a Mac, click the table, click the handle to the left of a row or above a column, then click its down arrow and choose to add or remove. Pressing Tab or Return in the last cell adds a row at the bottom.",
  ] },
  { q: "How do I turn a table back into text in Apple Notes?", a: [
    "Click anywhere in the table, click the Table Actions button and choose Convert to Text. On a Mac, Format, Convert to Text does the same.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="apple-notes-tables"
      intro={<>Apple Notes tables are deliberately simple. You can add and remove rows and columns, move them around and paste into them. You can&apos;t set a column&apos;s width, sort, or add up a column, because there are no formulas at all. Here&apos;s what they do, with the steps on a Mac, the workarounds that hold up, and when a table belongs somewhere else.</>}
      faq={FAQ}
    >
      <h2>Add a table</h2>
      <p>
        On a Mac, click where the table should go and click the Table button in the toolbar, or choose Format, Table (Option-Command-T).
        Notes adds an empty table with two rows and two columns. On iPhone, tap the Add Table button while you write.
      </p>
      <p>
        To turn text you&apos;ve already written into a table, select the paragraphs first and then click the Table button. To go the other
        way, click in the table, click the Table Actions button and choose Convert to Text. Apple&apos;s steps are in <a href="https://support.apple.com/guide/notes/add-a-table-apd0a136b9cc/mac" rel="noopener">Add
        a table in Notes on Mac</a>.
      </p>

      <h2>Rows and columns</h2>
      <p>On a Mac:</p>
      <ul>
        <li>Move between cells with Tab or the arrow keys.</li>
        <li>Press Tab or Return in the last cell to add a row at the bottom.</li>
        <li>To add or delete a row or column, click the table, click the handle to the left of the row or above the column, then click its down arrow and choose.</li>
        <li>To move a row or column, select it, then click and hold until it lifts off the table, and drag.</li>
        <li>Selecting a row or column and pressing Delete clears it. If it&apos;s already empty, Delete removes it.</li>
      </ul>
      <p>
        On iPhone, tap a cell, then tap the handle above its column or beside its row for the same options: add one before or after,
        or delete it.
      </p>
      <p>
        Pasting into a cell drops named styles such as Monostyled and Subheading. You can also copy a whole
        table out of Safari or Pages and paste it into a note, though Apple warns that some formatting won&apos;t come along.
      </p>

      <h2>Column width: you can&apos;t change it</h2>
      <p>
        This is the most common complaint, and there&apos;s no setting for it. Notes decides how wide each column is. There&apos;s no
        edge to drag, and neither the Format menu nor Apple&apos;s guide has anything for width. What helps:
      </p>
      <ul>
        <li>Keep headers short. &ldquo;Qty&rdquo; leaves more room for the column next to it than &ldquo;Quantity needed&rdquo;.</li>
        <li>Keep long text out of the table. Put a short label in the cell and the paragraph under the table.</li>
        <li>Split a wide table into two narrower ones. A table with eight columns is cramped on an iPhone whatever you do.</li>
      </ul>

      <h2>Sums and formulas: there aren&apos;t any</h2>
      <p>
        A table in Apple Notes holds text. It can&apos;t total a column, count rows or refer to another cell. Notes does have Math Results,
        which solves a sum as you type it: write <code>120+45+80=</code> and it offers 245. It also works with names: <code>Rent=1200</code> and{" "}
        <code>Food=450</code> on their own lines, then <code>Rent+Food=</code> below them, gives a total that updates when you change either number.
        Apple documents this for the body of a note, in iCloud notes and notes on your Mac, and says nothing about table cells. The
        setting is Format, Math Results, with Insert Results, Suggest Results or Off; the steps are in <a href="https://support.apple.com/guide/notes/solve-math-apda85974595/mac" rel="noopener">Solve
        math in Notes on Mac</a>.
      </p>
      <p>
        So for a budget or a tally, the workable pattern is the table for the items and a line of Math Results under it for the total. If
        you need real formulas, sorting or charts, the table has outgrown Notes, and Numbers is the place for it.
      </p>

      <h2>Getting data in from elsewhere</h2>
      <p>
        On macOS 26, Notes gives the Shortcuts app an Add Table to Note action that takes comma-separated values. Export a sheet from
        Numbers as CSV, pass the text to that action, and the rows arrive as a table in the note you pick.
      </p>
      <p>
        Getting tables out is less certain. Before you rely on the Markdown export for tables, try it on one note and check the file; <a href="/blog/export-apple-notes-to-markdown">how
        to export Apple Notes to Markdown</a> covers what to look for, and <a href="/blog/back-up-apple-notes">how to back up Apple Notes</a> covers
        keeping a copy.
      </p>

      <h2>When you want a table that does more</h2>
      <p>
        Amber Notes, the notes app for iPhone and Mac that I make, keeps tables just as plain to edit, but lets you give a column a type.
        On a Mac it&apos;s Format, Table (Option-Command-T), or the Table button. The handle above a column sets it to Text, Number, Date
        or Yes/No, and a Yes/No column becomes a tap instead of typing. With a date column, Show Trend draws a number column as a line over
        time, with its average. It doesn&apos;t do sums or formulas either, and you can&apos;t set column widths, which fit the text. A table too
        wide for the window scrolls sideways instead of squeezing every column.
      </p>
      <Figure shot={SHOTS.tracker} />
      <p>
        Two things Apple Notes can&apos;t do. File, Import Spreadsheet as Table on the Mac turns the first sheet of an Excel file into a
        table in a new note, with dropdowns as choices and each formula&apos;s last value. And ChatGPT or Claude can work with the table:
        they read its rows and column types, add a row for today, and answer questions such as &ldquo;what did I spend on food this
        month?&rdquo; by doing the sum themselves. The table stays markdown underneath, so any editor can open it.
      </p>
      {APP_STORE_LIVE ? (
        <p>
          The iPhone app has the same tables, with the Table button in the format bar. <a href="/blog/move-from-apple-notes">Moving
          from Apple Notes</a> brings your existing tables across in one import on your Mac.
        </p>
      ) : (
        <p>
          The iPhone app is coming soon to the App Store, with the same tables. <a href="/blog/move-from-apple-notes">Moving from
          Apple Notes</a> brings your existing tables across in one import on your Mac, and <a href="/blog/amber-notes-vs-apple-notes">Amber
          Notes vs Apple Notes</a> compares the rest.
        </p>
      )}
    </PostPage>
  );
}
