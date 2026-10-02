import { EmptyState, Shell, Stage, TopBar, ui } from "@/lib/ui";

// A report link whose address isn't a share link's. The report pages have no site header, so this
// is their own not-found rather than the site's.
export default function NotFound() {
  return (
    <Shell>
      <TopBar />
      <Stage>
        <EmptyState title="This page doesn’t exist" actions={<a className={ui.primary} href="/">Go to the home page</a>}>
          The address may be mistyped, or the page has moved.
        </EmptyState>
      </Stage>
    </Shell>
  );
}
