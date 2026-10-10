import type { Metadata } from "next";
import { CLAUDE_DIRECTORY_URL } from "@/lib/facts";
import PlaceCard from "../PlaceCard";
import { appURL } from "@/lib/app-scheme";

// "Connect in a few minutes" in the onboarding emails (https://ambernotes.app/open/connect-ai). In
// the app it opens Settings at Connect an AI; here, the same steps by hand.
export const dynamic = "force-static";
export const metadata: Metadata = { title: "Connect your AI · Pinto Notes", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PlaceCard
      href={appURL("connect-ai")}
      title="Connect your AI"
      lede="Pinto Notes opens Settings at Connect an AI. On another device, here's how it goes."
      steps={[
        <>In Pinto Notes on your iPhone or Mac, open Settings and choose <b>Connect an AI</b>.</>,
        <>Pick ChatGPT or Claude. The app shows each step. ChatGPT needs Plus or higher, on chatgpt.com.</>,
        <>Approve it on your iPhone or Mac by typing the number the page shows. You can choose Read Only.</>,
      ]}
      links={[
        { href: "/blog/connect-chatgpt-to-your-notes", label: "The full guide, with pictures" },
        { href: CLAUDE_DIRECTORY_URL, label: "Add it from Claude's directory" },
      ]}
    />
  );
}
