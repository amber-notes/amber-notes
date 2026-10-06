import { back, route } from "amber-router";
import { Button, Icon } from "amber-ui";

// The title of a screen, with Back for pushed screens and Settings for the others.
export default function ScreenHeader({ title, subtitle, canGoBack }) {
  return (
    <header class="screen-header">
      {canGoBack && <Button variant="secondary" size="small" class="round" aria-label="Back" onClick={back}><Icon name="back" /></Button>}
      <div class="screen-header__text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {!canGoBack && <Button variant="secondary" size="small" class="round" aria-label="Settings" onClick={() => route("/settings")}><Icon name="gear" /></Button>}
    </header>
  );
}
