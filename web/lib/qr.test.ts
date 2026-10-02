import { describe, expect, it } from "vitest";
import { qrModules, qrPath, QUIET } from "./qr";
import { decodeQRPath } from "./qr.test-helpers";

const LINK = "https://ambernotes.app/open/connect?request=5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c#s=q4Xb7Tz2LmNp8RsVw1Yc3A&k=Jx3kQ9vR2mT7wY5zA1bC4dE6fG8hI0jK2lM4nO6pQ8r";

describe("the connect page's QR code", () => {
  it("reads back as the exact link with an independent decoder", () => {
    const modules = qrModules(LINK);
    expect(decodeQRPath(modules.length + 2 * QUIET, qrPath(modules))).toBe(LINK);
  });

  it("fits a connect link in a version 8 code (49 modules) at error correction M", () => {
    expect(qrModules(LINK).length).toBe(49);
  });

  it("draws every dark module once, inside the quiet zone", () => {
    const modules = qrModules(LINK);
    const dark = modules.flat().filter(Boolean).length;
    let drawn = 0;
    for (const m of qrPath(modules).matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(QUIET);
      expect(Number(m[2])).toBeGreaterThanOrEqual(QUIET);
      drawn += Number(m[3]);
    }
    expect(drawn).toBe(dark);
  });
});
