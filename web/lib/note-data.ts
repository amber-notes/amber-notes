// What a note page reads as `amber.note`, worked out from the note's markdown in the browser, the
// same shape the app gives it (NotePage.data on the note-pages branch): the title, the markdown,
// today's date, every table with its columns and rows, and every checklist item.
// Prototype: column types from `<!-- pane-table: … -->` are read as plain text.

export type PageNote = {
  title: string;
  markdown: string;
  today: string;
  tables: { index: number; columns: { name: string; type: string }[]; rows: string[][] }[];
  checklists: { line: number; text: string; checked: boolean }[];
};

const cells = (line: string) => {
  const parts = line.trim().split("|").map((c) => c.trim());
  if (parts[0] === "") parts.shift();
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
};
const isRow = (l: string) => l.trim().startsWith("|");
const isSeparator = (l: string) => isRow(l) && l.includes("-") && /^[|\-:\s]+$/.test(l.trim());

export function noteData(markdown: string, today = new Date()): PageNote {
  const lines = markdown.split("\n");
  const tables: PageNote["tables"] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i]) || i + 1 >= lines.length || !isSeparator(lines[i + 1])) continue;
    const columns = cells(lines[i]).map((name) => ({ name, type: "text" }));
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && isRow(lines[j]); j++) rows.push(cells(lines[j]));
    tables.push({ index: tables.length, columns, rows });
    i = j - 1;
  }
  const checklists = lines.flatMap((l, i) => {
    const m = /^\s*[-*+] \[( |x|X)\] (.*)$/.exec(l);
    return m ? [{ line: i + 1, text: m[2], checked: m[1] !== " " }] : [];
  });
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    title: (lines.find((l) => l.trim()) ?? "New Note").replace(/^#+\s*/, "").trim(),
    markdown,
    today: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    tables,
    checklists,
  };
}
