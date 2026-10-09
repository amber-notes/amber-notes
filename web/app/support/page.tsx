import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import Help from "../help/page";

// The App Store's support link points here; it's the same page as /help, which says how to reach
// support by email, how to report a shared page, how to delete an account and where the privacy
// policy is (App Review guidelines 1.2 and 1.5 ask for published contact information).
export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Support · Pinto Notes",
  description: "How to reach Pinto Notes support by email, report a shared page, delete your account, and answers to common questions.",
  path: "/help",
});

export default Help;
