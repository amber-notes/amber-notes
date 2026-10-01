import { renderTemplate } from "@/lib/templates";
import s from "./templates.module.css";

/// A note as Amber Notes shows it on a Mac: the window, the folder in the title bar, the date, the
/// title, then the note. With `before`, the lines that differ from it are tinted, as the app tints
/// what an AI just changed.
export default function NoteWindow({ markdown, folder, date, before, label }: { markdown: string; folder: string; date: string; before?: string; label: string }) {
  const title = markdown.split("\n")[0];
  return (
    <figure className={s.window} aria-label={label} style={{ margin: 0 }}>
      <div className={s.bar} aria-hidden="true">
        <span className={s.lights}><i /><i /><i /></span>
        <span className={s.folder}><FolderGlyph />{folder}</span>
      </div>
      <div className={s.paper}>
        <p className={s.paperDate}>{date}</p>
        <h3 className={s.paperTitle}>{title}</h3>
        <div className="note" dangerouslySetInnerHTML={{ __html: renderTemplate(markdown, before) }} />
      </div>
    </figure>
  );
}

const FolderGlyph = () => <svg width="15" height="12" viewBox="0 0 17 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.5 1.6H14a1.5 1.5 0 0 1 1.5 1.5v6.4A1.5 1.5 0 0 1 14 13H3a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>;
