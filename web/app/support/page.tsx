import type { Metadata } from "next";
import { DocPage, readDoc } from "@/lib/DocPage";

// Copied from docs/support.md at build time (scripts/deploy-web.sh refreshes the copy).
const doc = readDoc("support.md");

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: `${doc.title} · Amber Notes`,
  description: "Help with Amber Notes, and how to reach us.",
  robots: { index: true, follow: true },
};

export default function Support() {
  return <DocPage {...doc} />;
}
