import type { Metadata } from "next";
import { LegalPage, readLegal } from "@/lib/LegalPage";

// Copied from docs/terms-of-use.md at build time (scripts/deploy-web.sh refreshes the copy).
const doc = readLegal("terms-of-use.md");

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Terms of Service · Amber Notes",
  description: "The rules for using Amber Notes and sharing notes, in plain language.",
  robots: { index: true, follow: true },
};

export default function Terms() {
  return <LegalPage doc={doc} other={{ href: "/privacy", label: "Privacy Policy" }} />;
}
