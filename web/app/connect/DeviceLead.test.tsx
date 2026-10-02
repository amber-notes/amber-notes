import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { browserOn, leadFor, parseDevices } from "@/lib/connect-flow";
import ConnectCard from "./ConnectCard";
import { ErrorLine, RequestLine, Steps } from "./ConnectScreens";
import { DeviceScreen, numberTitle, type DeviceArt } from "./DeviceLead";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const screen = (props: Partial<Parameters<typeof DeviceScreen>[0]> = {}) => renderToStaticMarkup(
  <DeviceScreen lead="iphone" devices={{ iphone: true, mac: false }} number={null} action="type" openLink="https://ambernotes.app/open/connect?request=x" onRecover={() => {}} {...props} />,
);

describe("where the account has Amber Notes", () => {
  it("reads two yes-or-no answers, or nothing", () => {
    expect(parseDevices({ asked: true, devices: { iphone: true, mac: false } })).toEqual({ iphone: true, mac: false });
    for (const none of [null, {}, { devices: null }, { devices: { iphone: true } }, { devices: { iphone: "yes", mac: true } }]) expect(parseDevices(none)).toBeNull();
  });

  it("tells an iPhone's browser, a Mac's and any other apart", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    expect(browserOn("MacIntel", mac, 0)).toBe("mac");
    expect(browserOn("iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("iphone");
    // A touch screen that says it's a Mac isn't one we name.
    expect(browserOn("MacIntel", mac, 5)).toBe("other");
    expect(browserOn("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe("other");
  });

  it("names one device: the one the browser is on first, then the iPhone, then the Mac, then the recovery key", () => {
    const both = { iphone: true, mac: true }, phone = { iphone: true, mac: false }, mac = { iphone: false, mac: true }, none = { iphone: false, mac: false };
    expect(leadFor(both, "mac")).toBe("thisMac");
    expect(leadFor(both, "iphone")).toBe("thisIphone");
    expect(leadFor(both, "other")).toBe("iphone");
    expect(leadFor(phone, "mac")).toBe("iphone");
    expect(leadFor(mac, "iphone")).toBe("mac");
    expect(leadFor(mac, "other")).toBe("mac");
    for (const on of ["mac", "iphone", "other"] as const) expect(leadFor(none, on)).toBe("recover");
    // A server that doesn't say: both devices are named, as before.
    expect(leadFor(null, "mac")).toBe("any");
  });
});

describe("the signed-in screen", () => {
  it("says Check your iPhone, with one quiet line for the other ways", () => {
    const t = text(screen());
    expect(t).toContain("Check your iPhone");
    expect(t).toContain("Amber Notes sent it a notification. Open it to see this request.");
    expect(t).toContain("Waiting for your iPhone…");
    expect(t).toContain("Not near your iPhone? Use your recovery key .");
    expect(t).not.toContain("Mac");
    expect(text(screen({ devices: { iphone: true, mac: true } }))).toContain("Not near your iPhone? Open Amber Notes on your Mac, or use your recovery key");
  });

  it("puts the number in the heading: typed for apps before 1.2, compared from 1.2", () => {
    expect(text(screen({ number: "42" }))).toContain("Type 42 on your iPhone");
    expect(text(screen({ number: "42" }))).toContain("If Amber Notes doesn't ask for a number, choose Don't allow.");
    expect(text(screen({ number: "42", action: "compare" }))).toContain("Check that your iPhone shows 42");
    expect(numberTitle("thisMac", "07", "type")).toBe("Type 07 in Amber Notes");
    expect(numberTitle("mac", "07", "compare")).toBe("Check that your Mac shows 07");
  });

  it("leads with one button on the Mac the browser is on, and keeps a way out if nothing opens", () => {
    const html = screen({ lead: "thisMac", devices: { iphone: true, mac: true } });
    expect(html).toContain('href="https://ambernotes.app/open/connect?request=x"');
    const t = text(html);
    expect(t).toContain("Open Amber Notes on this Mac");
    expect(t).toContain("Nothing opened? Check your iPhone for a notification, or use your recovery key");
    expect(text(screen({ lead: "thisMac", devices: { iphone: false, mac: true } }))).toContain("Amber Notes may be on another Mac.");
    expect(text(screen({ lead: "thisIphone" }))).toContain("Open Amber Notes on this iPhone");
    expect(text(screen({ lead: "mac", devices: { iphone: false, mac: true } }))).toContain("Open Amber Notes on your Mac");
  });

  it("shows the push in the server's own words in picture B, and never names another platform", () => {
    expect(text(screen({ art: "b" }))).toContain("An AI connection request Open Amber Notes to see it.");
    for (const art of ["a", "b", "c"] as DeviceArt[]) {
      for (const lead of ["iphone", "mac", "thisMac", "thisIphone"] as const) {
        for (const number of [null, "42"]) {
          const t = text(screen({ art, lead, number, devices: { iphone: true, mac: true } }));
          expect(t).not.toMatch(/iPad|Android|Windows|Watch|—/);
        }
      }
    }
  });
});

describe("the parts every connect screen shares", () => {
  it("says where access goes and what it could do, and the name only as what the app calls itself", () => {
    expect(text(renderToStaticMarkup(<RequestLine to="claude.ai" claimed="Claude" />)))
      .toBe("Access goes to claude.ai . It can read your notes, and edit them if you say so. It calls itself “Claude”.");
    expect(renderToStaticMarkup(<RequestLine to={null} />)).toBe("");
  });

  it("keeps the error's line there when there is no error, so nothing below it moves", () => {
    expect(renderToStaticMarkup(<ErrorLine text={null} />)).toContain('role="alert"');
    expect(text(renderToStaticMarkup(<ErrorLine text="The email or password isn't right." />))).toBe("The email or password isn't right.");
  });

  it("marks the step you're on", () => {
    const html = renderToStaticMarkup(<Steps at={2} to="claude.ai" />);
    expect(html).toMatch(/data-state="done"[^>]*>.*Sign in/);
    expect(html).toMatch(/aria-current="step"[^>]*>.*Allow it/);
    expect(text(html)).toContain("Back to claude.ai");
  });

  it("shows where access goes beside the form only in look b, and never another app's mark", () => {
    const label = { claimed_name: "Claude", redirect_host: "claude.ai", loopback: false };
    const b = renderToStaticMarkup(<ConnectCard look="b" label={label}><p>x</p></ConnectCard>);
    expect(text(b)).toContain("Access goes to claude.ai");
    expect(text(b)).toContain("Nothing is shared until you allow it.");
    const a = renderToStaticMarkup(<ConnectCard look="a" label={label}><p>x</p></ConnectCard>);
    expect(a).not.toContain("<aside");
    for (const html of [a, b]) expect([...html.matchAll(/<img[^>]*src="([^"]+)"/g)].every((m) => m[1] === "/mark-256.png")).toBe(true);
  });
});
