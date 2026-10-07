import type { Metadata } from "next";
import { sharedTemplate } from "@/lib/collab-relay";
import { EmptyState, Stage, ui } from "@/lib/ui";
import { redirect } from "next/navigation";

// The universal link behind a shared template's "Use template" (prototype):
// https://ambernotes.app/open/shared-template/<id> opens Amber Notes, which fetches the template and
// adds a fresh copy. A browser that lands here goes back to the template's page (/t/<id>), as
// /open/template and /open/copy do since the open-card pages went (#212).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Open Amber Notes", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const shared = await sharedTemplate(id);
  if (!shared) {
    return (
      <Stage inSite>
        <EmptyState title="This template isn't shared anymore" actions={<a className={ui.primary} href="/templates">Browse templates</a>}>
          Its maker stopped sharing it.
        </EmptyState>
      </Stage>
    );
  }
  redirect(`/t/${id}`);
}
