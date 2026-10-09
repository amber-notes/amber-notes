import type { Metadata } from "next";
import PlaceCard from "../PlaceCard";

// "Bring your Apple Notes over" in the onboarding emails (https://ambernotes.app/open/import). On a
// Mac the app opens Import from Apple Notes; on an iPhone it says to do it on the Mac.
export const dynamic = "force-static";
export const metadata: Metadata = { title: "Import your Apple Notes · Pinto Notes", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PlaceCard
      href="ambernotes://import"
      title="Bring your Apple Notes over"
      lede="On a Mac, Pinto Notes opens Import from Apple Notes. Your notes come over with their folders, and Apple Notes stays as it is."
      steps={[
        <>Open Pinto Notes on your Mac.</>,
        <>Choose <b>File</b>, then <b>Import from Apple Notes</b>.</>,
        <>Bring all of them, or pick some. Keep Apple Notes folders stays ticked.</>,
        <>On your iPhone they show up a second later.</>,
      ]}
      links={[{ href: "/blog/move-from-apple-notes", label: "Moving from Apple Notes, step by step" }]}
    />
  );
}
