import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ConnectFlow from "./ConnectFlow";

// The page as the server sends it, before its script runs: the sign-in form must not be able to
// put the password anywhere (security review finding 2).
describe("the consent page before hydration", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectFlow, { requestId: "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c", supabaseURL: "https://ref.supabase.co", anonKey: "anon" }),
  );

  it("has no named inputs, posts, and can't be submitted yet", () => {
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="post"');
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs.length).toBe(2);
    for (const input of inputs) expect(input).not.toMatch(/\sname=/);
    const submit = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(submit).toMatch(/disabled/);
  });
});
