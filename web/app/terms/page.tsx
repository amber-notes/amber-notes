import type { Metadata } from "next";
import { DocPage, readDoc } from "@/lib/DocPage";

// Copied from docs/terms-of-use.md at build time (scripts/deploy-web.sh refreshes the copy).
const doc = readDoc("terms-of-use.md");

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: `${doc.title} · Amber Notes`,
  description: "The rules for using Amber Notes and sharing notes.",
  robots: { index: true, follow: true },
};

export default function Terms() {
  return <DocPage {...doc} />;
}
