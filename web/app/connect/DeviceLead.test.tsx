import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { browserOn, leadFor, parseDevices } from "@/lib/connect-flow";
import ConnectCard from "./ConnectCard";
import { ErrorLine, RequestLine } from "./ConnectScreens";
import { DeviceScreen, numberBody, numberTitle } from "./DeviceLead";

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
  it("says what to do as the heading, in one sentence under the picture, with two quiet ways out", () => {
    const t = text(screen({ onResend: async () => null }));
    expect(t).toContain("Open Amber Notes on your iPhone");
    expect(t).toContain("Amber Notes sent a notification to your iPhone. Open the notification to approve this connection.");
    expect(t).toContain("Send it again");
    expect(t).toContain("Use your recovery key");
    expect(t).not.toContain("Mac");
  });

  it("has no spinner and no waiting line: the person is the one with something to do", () => {
    for (const lead of ["iphone", "mac", "thisMac", "thisIphone"] as const) {
      for (const number of [null, "42"]) {
        const html = screen({ lead, number, devices: { iphone: true, mac: true } });
        expect(html).not.toContain('role="status"');
        expect(text(html)).not.toMatch(/Waiting|…/);
      }
    }
  });

  it("shows the notification in the server's own words, with the app's mark and name", () => {
    const html = screen();
    expect(text(html)).toContain("Amber Notes now An AI connection request Open Amber Notes to see it.");
    expect(html).toContain('src="/mark-256.png"');
  });

  it("puts the number in the heading and the sentence: typed for apps before 1.2, compared from 1.2", () => {
    const typed = text(screen({ number: "42" }));
    expect(typed).toContain("Type 42 on your iPhone");
    expect(typed).toContain("Open the notification from Amber Notes, type 42, then choose Allow. If Amber Notes shows no number box, choose Don't allow.");
    const compared = text(screen({ number: "42", action: "compare" }));
    expect(compared).toContain("Check that your iPhone shows 42");
    expect(compared).toContain("Open the notification from Amber Notes and check that it shows 42, then choose Allow. If the number is different, choose Don't allow.");
    expect(numberTitle("thisMac", "07", "type")).toBe("Type 07 in Amber Notes");
    expect(numberTitle("mac", "07", "compare")).toBe("Check that your Mac shows 07");
    expect(numberBody("thisMac", "07", "type")).toBe("Type 07 in Amber Notes, then choose Allow. If Amber Notes shows no number box, choose Don't allow.");
  });

  it("leads with one button on the device the browser is on, and says what to do if nothing opens", () => {
    const html = screen({ lead: "thisMac", devices: { iphone: true, mac: true } });
    expect(html).toContain('href="https://ambernotes.app/open/connect?request=x"');
    const t = text(html);
    expect(t).toContain("Open Amber Notes on this Mac");
    expect(t).toContain("Nothing opened? Open the notification on your iPhone instead.");
    expect(text(screen({ lead: "thisMac", devices: { iphone: false, mac: true } }))).toContain("Amber Notes may be on another Mac.");
    expect(text(screen({ lead: "thisIphone" }))).toContain("Open Amber Notes on this iPhone");
    expect(text(screen({ lead: "mac", devices: { iphone: false, mac: true } }))).toContain("Open Amber Notes on your Mac");
    // Sending again is for the notification on an iPhone.
    expect(text(screen({ lead: "mac", devices: { iphone: false, mac: true }, onResend: async () => null }))).not.toContain("Send it again");
  });

  it("never calls a device \"it\", and never names another platform", () => {
    for (const lead of ["iphone", "mac", "thisMac", "thisIphone"] as const) {
      for (const number of [null, "42"]) {
        for (const action of ["type", "compare"] as const) {
          const t = text(screen({ lead, number, action, devices: { iphone: true, mac: true }, onResend: async () => null }));
          expect(t).not.toMatch(/iPad|Android|Windows|Watch|—/);
          expect(t).not.toMatch(/sent it |asks it |on it\b|Open it\b/);
        }
      }
    }
  });
});

describe("the parts every connect screen shares", () => {
  it("says what the app could do, once, and leaves the host to the frame", () => {
    // The frame names the host; the line says only what the app could do.
    expect(text(renderToStaticMarkup(<RequestLine to="claude.ai" claimed="Claude" />))).toBe("It can read your notes, and edit them if you say so.");
    expect(renderToStaticMarkup(<RequestLine to={null} />)).toBe("");
  });

  it("keeps the error's line there when there is no error, so nothing below it moves", () => {
    expect(renderToStaticMarkup(<ErrorLine text={null} />)).toContain('role="alert"');
    expect(text(renderToStaticMarkup(<ErrorLine text="The email or password isn't right." />))).toBe("The email or password isn't right.");
  });

  it("shows where access goes beside the form only on a page about one request, and never another app's mark", () => {
    const label = { claimed_name: "Claude", redirect_host: "claude.ai", loopback: false };
    const b = renderToStaticMarkup(<ConnectCard request label={label}><p>x</p></ConnectCard>);
    expect(text(b)).toContain("Access goes to claude.ai");
    expect(text(b)).toContain("Nothing is shared until you allow it.");
    expect(text(b)).toContain("It calls itself “Claude”.");
    const a = renderToStaticMarkup(<ConnectCard label={label}><p>x</p></ConnectCard>);
    expect(a).not.toContain("<aside");
    for (const html of [a, b]) expect([...html.matchAll(/<img[^>]*src="([^"]+)"/g)].every((m) => m[1] === "/mark-256.png")).toBe(true);
  });

  it("puts the site's logo at the top, linking home, and no other way out of the flow", () => {
    for (const html of [renderToStaticMarkup(<ConnectCard><p>x</p></ConnectCard>), renderToStaticMarkup(<ConnectCard request><p>x</p></ConnectCard>)]) {
      const bar = html.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? "";
      expect(text(bar)).toBe("Amber Notes");
      expect([...bar.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/"]);
    }
  });
});
