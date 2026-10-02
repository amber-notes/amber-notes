"use client";

import { endPreview, PREVIEWS } from "@/lib/platform";

/// The pill that says the site is being shown as another platform's visitor sees it (?as=windows,
/// lib/platform.ts), with the way out. It's in every page's HTML and site.css shows it only in a
/// preview, so nobody else ever sees it.
export default function PlatformPreview() {
  return (
    <div className="pi-dev">
      <span>Dev · viewing as {PREVIEWS.map(([as, name]) => <span key={as} data-as={as}>{name}</span>)} ·</span>
      <button type="button" onClick={() => endPreview(() => sessionStorage, location)}>Reset</button>
    </div>
  );
}
