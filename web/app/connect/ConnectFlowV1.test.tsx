import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pageNumber } from "@/lib/connect-flow";
import { fromBase64 } from "@/lib/e2ee";
import ConnectFlow, { APPLE_INSTEAD, MatchNumber } from "./ConnectFlowV1";

const v = JSON.parse(readFileSync(new URL("../../../supabase/functions/_shared/e2ee-vectors.json", import.meta.url), "utf8"));

describe("the number on the connect page", () => {
  it("shows the vector's number for its page key, both nonces and the request, large and in words", async () => {
    const np = Uint8Array.from(Buffer.from(v.handoff.page_nonce, "hex"));
    const number = await pageNumber(fromBase64(v.handoff.browser_public), np, v.handoff.device_nonce, v.handoff.request_id);
    const html = renderToStaticMarkup(<MatchNumber number={number} />);
    expect(number).toBe(v.handoff.match_number);
    expect(html).toContain(`>${v.handoff.match_number}</span>`);
    expect(html).toContain(`Type ${v.handoff.match_number} on your iPhone or Mac`);
  });
});

describe("signing in on the connect page", () => {
  it("offers Sign in with Apple and email, plus opening the app on this computer", () => {
    const html = renderToStaticMarkup(
      <ConnectFlow requestId="00000000-0000-4000-8000-000000000000" supabaseURL="https://ref.supabase.co" anonKey="anon" label={null} recover={false} />,
    );
    expect(html).toContain("Sign in with Apple");
    expect(html).not.toContain(APPLE_INSTEAD.replace(/'/g, "&#x27;"));
    expect(html).toContain("/open/connect?request=00000000-0000-4000-8000-000000000000");
  });
});
