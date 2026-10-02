import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlatformPreview from "./PlatformPreview";

describe("the preview pill", () => {
  it("is labelled Dev, names each platform for site.css to pick from, and has a Reset button", () => {
    const html = renderToStaticMarkup(<PlatformPreview />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("Dev · viewing as WindowsAndroidLinuxiPhoneMac ·Reset");
    for (const as of ["windows", "android", "linux", "iphone", "mac"]) expect(html, as).toContain(`data-as="${as}"`);
    expect(html).toContain('<button type="button">Reset</button>');
    expect(html.startsWith('<div class="pi-dev">')).toBe(true);
  });
});
