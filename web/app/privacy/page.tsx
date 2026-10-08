import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import { LegalPage, readLegal } from "@/lib/LegalPage";

// Copied from docs/privacy-policy.md at build time (scripts/deploy-web.sh refreshes the copy).
const doc = readLegal("privacy-policy.md");

export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy · Pinto Notes",
  description: "What Pinto Notes stores, why, where, for how long, and your rights. No ads, no tracking in the apps.",
  path: "/privacy",
});

export default function Privacy() {
  return <LegalPage doc={doc} other={{ href: "/terms", label: "Terms of Service" }} />;
}
