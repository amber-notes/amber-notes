import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return { scheme: await import("./app-scheme"), connect: await import("./connect"), open: await import("@/app/open/OpenApp") };
};

describe("the app's links on the staging site", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("default to Pinto Notes", async () => {
    const { scheme, connect } = await load({ NEXT_PUBLIC_APP_SCHEME: "", NEXT_PUBLIC_APP_LINK_ORIGIN: "" });
    expect(scheme.appURL("history")).toBe("ambernotes://history");
    expect(connect.universalLink("ABC")).toBe("https://ambernotes.app/open/connect?request=abc");
  });

  it("open Pinto Notes Beta when the site is built for it", async () => {
    const { connect, open } = await load({ NEXT_PUBLIC_APP_SCHEME: "ambernotes-beta", NEXT_PUBLIC_APP_LINK_ORIGIN: "https://amber-notes-staging.vercel.app/" });
    expect(connect.appLink("ABC")).toBe("ambernotes-beta://connect?request=abc");
    expect(connect.universalLink("ABC")).toBe("https://amber-notes-staging.vercel.app/open/connect?request=abc");
    expect(open.APP_LINK.test("ambernotes-beta://template/trip-plan")).toBe(true);
    expect(open.APP_LINK.test("ambernotes://template/trip-plan")).toBe(false);
  });

  it("ignore a scheme that isn't one", async () => {
    const { scheme } = await load({ NEXT_PUBLIC_APP_SCHEME: "javascript:alert(1)//" });
    expect(scheme.APP_SCHEME).toBe("ambernotes");
  });
});
