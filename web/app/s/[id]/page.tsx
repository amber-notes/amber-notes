import type { Metadata } from "next";
import { sealedLink } from "@/lib/collab-relay";
import { EmptyState, Stage } from "@/lib/ui";
import SealedNote from "./SealedNote";

// A sealed link (prototype): https://ambernotes.app/s/<id>#<secret>. This server has only the sealed
// copy; the browser opens it with the secret from the fragment. Read on every visit, so Stop Sharing
// and a new link take this one down at once.
export const dynamic = "force-dynamic";
// The title isn't known here (it's sealed), so link previews say only this much.
export const metadata: Metadata = { title: "A shared note · Pinto Notes", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const copy = await sealedLink(id);
  if (!copy) return <Gone />;
  return <SealedNote id={id} ct={copy.ct} editable={copy.editable === true} />;
}

function Gone() {
  return (
    <Stage>
      <EmptyState title="This note isn't shared anymore">
        Its owner stopped sharing it or made a new link. Ask them for the new one.
      </EmptyState>
    </Stage>
  );
}
