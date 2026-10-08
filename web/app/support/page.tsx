import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site";
import Help from "../help/page";

// The App Store's support link points here; it's the same page as /help.
export const dynamic = "force-static";
export const metadata: Metadata = pageMetadata({
  title: "Help and FAQ · Pinto Notes",
  description: "How to import your Apple Notes, connect ChatGPT, Claude, Claude Code or Codex, sync your iPhone and Mac, share a note, and get help.",
  path: "/help",
});

export default Help;
