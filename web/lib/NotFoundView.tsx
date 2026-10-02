import NoteWindow from "@/app/templates/NoteWindow";
import { ui } from "./ui";
import s from "./not-found.module.css";

/// The site's 404, inside its header and footer. Two candidate looks until one is picked:
/// "hero": the app's mark and one big line, like the download page.
/// "note": the missing page as a note in an Amber Notes window, the way the site shows every note.
export type NotFoundDesign = "hero" | "note";
export const NOT_FOUND_DESIGN: NotFoundDesign = "hero";

const TITLE = "This page doesn’t exist";
const TEXT = "The address may be mistyped, or the page has moved.";

const LOST_NOTE = `${TITLE}

${TEXT}

- [ ] [Browse the templates](/templates)
- [ ] [Read the blog](/blog)
- [ ] [Get help](/help)
`;

export function NotFoundView({ design = NOT_FOUND_DESIGN }: { design?: NotFoundDesign }) {
  if (design === "note") {
    return (
      <div className={s.lost}>
        <h1 className={s.hidden}>{TITLE}</h1>
        <div className={`${s.window} rise`}>
          <NoteWindow markdown={LOST_NOTE} folder="Recently Deleted" date="Page not found" label={`${TITLE}. ${TEXT}`} />
        </div>
        <a className={`${ui.primary} ${s.home} rise`} style={{ "--i": 1 } as React.CSSProperties} href="/">Go to the home page</a>
      </div>
    );
  }
  return (
    <div className={s.hero}>
      <img className={`${s.icon} rise`} src="/mark-256.png" alt="" width={104} height={104} />
      <h1 className={`${s.h1} rise`} style={{ "--i": 1 } as React.CSSProperties}>{TITLE}</h1>
      <p className={`${s.lede} rise`} style={{ "--i": 2 } as React.CSSProperties}>{TEXT}</p>
      <div className={`${s.ctas} rise`} style={{ "--i": 3 } as React.CSSProperties}>
        <a className={`${ui.primary} ${s.home}`} href="/">Go to the home page</a>
        <a className={ui.quiet} href="/help">Get help</a>
      </div>
    </div>
  );
}
