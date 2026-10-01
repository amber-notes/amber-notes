import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("OpenAI's domain challenge", () => {
  it("is the bare token as plain text", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("63ThANIdhp-bJNHKaegib3mD6AXGcWuB4Dvwj-m3eqs");
  });
});
