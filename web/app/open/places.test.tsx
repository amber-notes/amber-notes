import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APP_LINK } from "./OpenApp";
import ConnectAI from "./connect-ai/page";
import Import from "./import/page";
import History from "./history/page";

describe("the places the onboarding emails open", () => {
  it.each([
    ["connect-ai", ConnectAI, "Connect an AI", "/blog/connect-chatgpt-to-your-notes"],
    ["import", Import, "Import from Apple Notes", "/blog/move-from-apple-notes"],
    ["history", History, "Show Version History", null],
  ] as const)("/open/%s tries the app, then says how by hand, with Open in Amber Notes and the download", (place, Page, step, guide) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain(`href="ambernotes://${place}"`);
    expect(html).toContain("Open in Amber Notes");
    expect(html).toContain('href="/download/mac"');
    expect(html).toContain(step);
    if (guide) expect(html).toContain(`href="${guide}"`);
  });

  it("only tries the app's own links", () => {
    for (const ok of ["ambernotes://connect-ai", "ambernotes://import", "ambernotes://history", "ambernotes://template/trip-plan"]) expect(APP_LINK.test(ok)).toBe(true);
    for (const bad of ["ambernotes://connect-ai/x", "https://ambernotes.app/open/history", "javascript:alert(1)", "ambernotes://settings"]) expect(APP_LINK.test(bad)).toBe(false);
  });
});
