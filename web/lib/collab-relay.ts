// Sealed links and shared templates (prototype): where the site reads them. In the product these are
// the public RPCs `sealed_link` and `shared_template` on Supabase (20261007163100); the prototype
// reads the local relay (scripts/collab-relay.ts), which runs the same functions.
export const RELAY = process.env.COLLAB_RELAY_URL ?? "http://127.0.0.1:56480";
/** The separate origin note pages run on: never this site. ambernotes-usercontent.app in the product. */
export const USERCONTENT = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN ?? "http://127.0.0.1:56481";

export async function sealedLink(id: string): Promise<{ ct: string; updated_at: string; editable?: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const res = await fetch(`${RELAY}/public/sealed-link/${id}`, { cache: "no-store" }).catch(() => null);
  return res?.ok ? await res.json() : null;
}

export type SharedTemplate = {
  v: 1;
  title: string;
  description?: string;
  /** The note's text skeleton, with headings and empty tables. */
  note: string;
  page?: string | null;
  widget?: unknown;
  /** The tables the page reads: their columns. */
  layout?: { table: number; columns: string[] }[];
  /** Keys the page asks for, by name and host; never their values. */
  needs?: { keys?: { name: string; host?: string }[]; hosts?: string[] };
};

export async function sharedTemplate(id: string): Promise<{ maker: string | null; template: SharedTemplate; updated_at: string } | null> {
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return null;
  const res = await fetch(`${RELAY}/public/template/${id}`, { cache: "no-store" }).catch(() => null);
  return res?.ok ? await res.json() : null;
}
