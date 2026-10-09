import type { Metadata } from "next";
import PlaceCard from "../PlaceCard";

// "See your note's history" in the onboarding emails (https://ambernotes.app/open/history). In the
// app it opens the version history of the note an AI changed last; here, how to get there.
export const dynamic = "force-static";
export const metadata: Metadata = { title: "Version history · Pinto Notes", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <PlaceCard
      href="ambernotes://history"
      title="See a note's history"
      lede="Pinto Notes opens the version history of the note your AI changed last. On another device, here's how to get there."
      steps={[
        <>Open the note in Pinto Notes on your iPhone or Mac.</>,
        <>Choose <b>More</b> (•••), then <b>Show Version History</b>. On a Mac it's also under File.</>,
        <>Pick a version to see it, and <b>Restore This Version</b> to bring it back. Versions an AI made are kept for 90 days.</>,
      ]}
    />
  );
}
