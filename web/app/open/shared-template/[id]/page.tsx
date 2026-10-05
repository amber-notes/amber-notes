import type { Metadata } from "next";
import { sharedTemplate } from "@/lib/collab-relay";
import { EmptyState, Stage, ui } from "@/lib/ui";
import OpenCard from "../../OpenCard";

// The universal link behind a shared template's "Use template" (prototype):
// https://ambernotes.app/open/shared-template/<id> opens Amber Notes, which fetches the template and
// adds a fresh copy. Where the app isn't installed, this page tries the app's scheme.
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
  return (
    <OpenCard
      href={`ambernotes://shared-template/${id}`}
      what="this template"
      lede={<>Amber Notes adds a fresh <b>{shared.template.title}</b> note{shared.template.page ? " with its app" : ""}.</>}
      markdown={shared.template.note}
      back={{ href: `/t/${id}`, label: "Back to the template" }}
    />
  );
}
