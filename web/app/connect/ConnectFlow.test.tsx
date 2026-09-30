import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pageNumber } from "@/lib/connect-flow";
import { fromBase64 } from "@/lib/e2ee";
import { MatchNumber } from "./ConnectFlow";

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
