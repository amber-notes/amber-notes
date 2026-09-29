// Reads a shared note through the public RPC and the share-files function.
import type { SharedFile } from "./render";

export type SharedNote = {
  title: string;
  body: string;
  updated_at: string;
  include_subnotes: boolean;
  is_sub: boolean;
  root_title: string;
  subnotes: { id: string; title: string }[];
};

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Edits show on the page within a minute. */
export const REVALIDATE = 60;

const SLUG = /^[A-Za-z0-9_-]{24,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validSlug = (s: string) => SLUG.test(s);
export const validSub = (s: string) => UUID.test(s);

export async function sharedNote(slug: string, sub?: string): Promise<SharedNote | null> {
  if (!validSlug(slug) || (sub !== undefined && !validSub(sub)) || !URL_ || !KEY) return null;
  const res = await fetch(`${URL_}/rest/v1/rpc/shared_note`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ p_slug: slug, p_sub: sub ?? null }),
    next: { revalidate: REVALIDATE, tags: [`share:${slug}`] },
  });
  if (!res.ok) return null;
  return (await res.json()) as SharedNote | null;
}

export async function sharedFiles(slug: string, sub?: string): Promise<Record<string, SharedFile>> {
  if (!URL_) return {};
  const q = new URLSearchParams({ slug, ...(sub ? { sub } : {}) });
  const res = await fetch(`${URL_}/functions/v1/share-files?${q}`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
    next: { revalidate: REVALIDATE, tags: [`share:${slug}`] },
  });
  if (!res.ok) return {};
  const { files } = (await res.json()) as { files: Record<string, { path: string; name: string; type: string; size: number }> };
  return Object.fromEntries(Object.entries(files).map(([id, f]) => [id, { url: URL_ + f.path, name: f.name, type: f.type, size: f.size }]));
}
