import { describe, expect, it } from "vitest";
import { FAQ } from "../app/help/questions";
import { app, faqPage, maker, website } from "./structured-data";

// The rules schema.org and Google's rich result docs set for these types, checked on what the pages emit.
describe("structured data", () => {
  it("describes the app as a free productivity app for iOS and macOS", () => {
    const a = app("1.0");
    expect(a["@type"]).toBe("SoftwareApplication");
    expect(a.name).toBe("Amber Notes");
    expect(a.applicationCategory).toBe("ProductivityApplication");
    expect(a.operatingSystem).toBe("iOS, macOS");
    expect(a.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(a.softwareVersion).toBe("1.0");
    expect(String(a.downloadUrl)).toMatch(/^https:\/\/ambernotes\.app\//);
    // No invented ratings or reviews.
    expect(a).not.toHaveProperty("aggregateRating");
    expect(a).not.toHaveProperty("review");
    expect(app(null)).not.toHaveProperty("softwareVersion");
  });

  it("names the maker, and the app and site point at them", () => {
    expect(maker).toMatchObject({ "@type": "Person", name: "Emil Wagman", sameAs: ["https://x.com/EmilWagman", "https://github.com/emilwagman"] });
    expect(app("1.0").author).toEqual({ "@id": maker["@id"] });
    expect(website.publisher).toEqual({ "@id": maker["@id"] });
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
