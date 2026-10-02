import type { Metadata } from "next";
import { NotFoundView } from "@/lib/NotFoundView";

// Any address the site doesn't have. Shared notes that stopped being shared have their own page (n/[slug]/not-found).
export const metadata: Metadata = { title: "Page not found · Amber Notes" };

export default function NotFound() {
  return <NotFoundView />;
}
