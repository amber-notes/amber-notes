// Every picture an email points at exists in web/public/email, which the site serves at
// https://pintonotes.com/email/. A missing file shows as an empty box in the reader's inbox.
//   deno test -A supabase/functions/lifecycle/assets.test.ts
import { assert } from "jsr:@std/assert@1";
import { KINDS, render } from "./emails.ts";

const dir = new URL("../../../web/public/email/", import.meta.url);
const files = new Set([...Deno.readDirSync(dir)].map((f) => f.name));
const base = { site: "https://pintonotes.com", assets: "https://pintonotes.com/email", unsubscribe: "https://pintonotes.com/unsubscribe?u=x&t=y" };

Deno.test("every picture in every email, in every variant, is in web/public/email", () => {
  const missing: string[] = [];
  for (const kind of KINDS) {
    for (const sortable of [false, true]) for (const connectTried of [false, true]) for (const variant of [0, 1] as const) {
      const { html } = render(kind, { ...base, sortable, connectTried, variant });
      for (const m of html.matchAll(/https:\/\/pintonotes\.com\/email\/([^"?#]+)/g)) {
        if (!files.has(m[1])) missing.push(`${kind}: ${m[1]}`);
      }
    }
  }
  assert(missing.length === 0, `missing from web/public/email: ${[...new Set(missing)].join(", ")}`);
});
