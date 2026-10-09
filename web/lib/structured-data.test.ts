import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAQ } from "../app/help/questions";
import { app, article, breadcrumbs, faqPage, incredible, maker, organization, website } from "./structured-data";

// The rules schema.org and Google's rich result docs set for these types, checked on what the pages emit.
describe("structured data", () => {
  it("describes the app as a free productivity app for iOS and macOS", () => {
    const a = app("1.0");
    expect(a["@type"]).toBe("SoftwareApplication");
    expect(a.name).toBe("Pinto Notes");
    expect(a.applicationCategory).toBe("ProductivityApplication");
    expect(a.operatingSystem).toBe("iOS, macOS");
    expect(a.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(a.softwareVersion).toBe("1.0");
    expect(String(a.downloadUrl)).toMatch(/^https:\/\/pintonotes\.com\//);
    // No invented ratings or reviews.
    expect(a).not.toHaveProperty("aggregateRating");
    expect(a).not.toHaveProperty("review");
    expect(app(null)).not.toHaveProperty("softwareVersion");
  });

  it("names the maker, and the app and site point at them", () => {
    expect(maker).toMatchObject({ "@type": "Person", name: "Emil Wagman", url: "https://emilwagman.com", sameAs: ["https://emilwagman.com", "https://x.com/EmilWagman", "https://www.linkedin.com/in/emil-wagman-52a907287/", "https://github.com/emilwagman"] });
    expect(app("1.0").author).toEqual({ "@id": maker["@id"] });
    expect(organization.founder).toEqual({ "@id": maker["@id"] });
    expect(website.publisher).toEqual({ "@id": organization["@id"] });
    expect(app("1.0").publisher).toEqual({ "@id": organization["@id"] });
  });

  it("names the site Pinto Notes for Google, with the domain only as a fallback", () => {
    expect(website.name).toBe("Pinto Notes");
    expect(website.alternateName).toEqual(["Pinto Notes app", "Amber Notes", "ambernotes.app"]);
  });

  it("serves a favicon whose first frame is 48px, the size Google needs for its results", () => {
    const ico = readFileSync(new URL("../app/favicon.ico", import.meta.url));
    const frames = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
    expect(frames).toEqual([48, 32, 16]);
  });

  it("ties the name to the GitHub repository, so it isn't mixed up with other apps called Pinto Notes", () => {
    expect(organization).toMatchObject({ "@type": "Organization", name: "Pinto Notes", url: "https://pintonotes.com" });
    expect(organization.sameAs).toContain("https://github.com/amber-notes/amber-notes");
    expect(app("1.0").sameAs).toContain("https://github.com/amber-notes/amber-notes");
  });

  it("describes a post as an Article with its dates, an author and a publisher", () => {
    const a = article({ title: "T", description: "D", path: "/blog/x", date: "2026-09-29", updated: "2026-09-30", image: "/blog/x.webp" });
    expect(a).toMatchObject({
      "@type": "Article", headline: "T", url: "https://pintonotes.com/blog/x", datePublished: "2026-09-29", dateModified: "2026-09-30",
      image: "https://pintonotes.com/blog/x.webp", author: { "@id": maker["@id"] }, publisher: { "@id": organization["@id"] },
    });
  });

  it("says the maker works at Incredible", () => {
    expect(incredible).toMatchObject({ "@type": "Organization", name: "Incredible", url: "https://incredible.one" });
    expect(maker.worksFor).toEqual({ "@id": incredible["@id"] });
  });

  it("numbers breadcrumbs from 1, with full URLs", () => {
    const b = breadcrumbs([{ name: "Blog", path: "/blog" }, { name: "Guides", path: "/blog#guides" }]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Blog", item: "https://pintonotes.com/blog" },
      { "@type": "ListItem", position: 2, name: "Guides", item: "https://pintonotes.com/blog#guides" },
    ]);
  });

  it("turns every Help question into a FAQPage question with its answer", () => {
    const f = faqPage(FAQ, "/help");
    const qs = f.mainEntity as { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }[];
    expect(f["@type"]).toBe("FAQPage");
    expect(qs).toHaveLength(FAQ.length);
    for (const [i, q] of qs.entries()) {
      expect(q["@type"]).toBe("Question");
      expect(q.name).toBe(FAQ[i].q);
      expect(q.acceptedAnswer["@type"]).toBe("Answer");
      expect(q.acceptedAnswer.text).toBe(FAQ[i].a.join("\n\n"));
    }
  });
});
