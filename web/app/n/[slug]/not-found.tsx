import { EmptyState, Shell, Stage, TopBar, ui } from "@/lib/ui";

export default function NotFound() {
  return (
    <Shell>
      <TopBar />
      <Stage>
        <EmptyState title="This note isn’t shared" actions={<a className={ui.secondary} href="/">See what Pinto Notes is</a>}>
          The link may have been stopped, or the note moved to Recently Deleted. Ask whoever sent it for a new link.
        </EmptyState>
      </Stage>
    </Shell>
  );
}
