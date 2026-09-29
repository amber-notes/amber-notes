import type { Metadata } from "next";
import Help from "../help/page";

// The App Store's support link points here; it's the same page as /help.
export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Help · Amber Notes",
  description: "Answers to common questions about Amber Notes, and how to reach me.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/help" },
};

export default Help;
