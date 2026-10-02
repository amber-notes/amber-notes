import NoteWindow from "@/app/templates/NoteWindow";
import { ui } from "./ui";
import s from "./not-found.module.css";

/// The site's 404, inside its header and footer: the missing page as a note in an Amber Notes
/// window, the way the site shows every note, with one way home under it.
const TITLE = "This page doesn’t exist";
const TEXT = "The address may be mistyped, or the page has moved.";

const LOST_NOTE = `${TITLE}

${TEXT}

- [ ] [Browse the templates](/templates)
- [ ] [Read the blog](/blog)
- [ ] [Get help](/help)
`;

export function NotFoundView() {
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
