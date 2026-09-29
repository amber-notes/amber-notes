import type { Metadata } from "next";

// Any address the site doesn't have. Shared notes that stopped being shared have their own page (n/[slug]/not-found).
export const metadata: Metadata = { title: "Page not found · Amber Notes" };

export default function NotFound() {
  return (
    <div className="shell">
      <main className="page empty">
        <img src="/mark-256.png" alt="" width={56} height={56} />
        <h1 className="title">This page doesn’t exist</h1>
        <p className="lede">The address may be mistyped, or the page has moved.</p>
        <p className="lede"><a href="/">Go to the home page</a> · <a href="/help">Get help</a></p>
      </main>
    </div>
  );
}
