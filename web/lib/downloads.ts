// The Mac download counter. "Download for Mac" links go to /download/mac (MAC_DOWNLOAD_PATH), which
// adds one to today's total in Supabase (count_download, 20261001150000_download_counts.sql) and
// redirects to the DMG. Only a daily total per product is stored: no address, browser, cookie or
// anything else about who downloaded. Sparkle's appcast points at the versioned DMG directly, so
// updates are never counted.
export const MAC_DOWNLOAD_PATH = "/download/mac";
/// The DMG's stable name since 1.2, when the Mac app became Pinto Notes.app. The names from before
/// (Amber-Notes.dmg, Amber-Notes-<version>.dmg) are still answered: see OLD_DMG_NAMES.
export const MAC_DMG_NAME = "Pinto-Notes.dmg";
export const MAC_DMG = `/downloads/${MAC_DMG_NAME}`;

/// Links and appcasts from before the rename ask for the old file names. Once a release has
/// replaced those files, the site answers them with the new ones (fallback rewrites in
/// next.config.ts: they apply only when no file has the old name).
export const OLD_DMG_NAMES = [
  { source: "/downloads/Amber-Notes.dmg", destination: MAC_DMG },
  { source: "/downloads/Amber-Notes-:version(\\d[\\d.]*).dmg", destination: "/downloads/Pinto-Notes-:version.dmg" },
];

export type Product = "mac";

/// Adds one to today's total. Never throws and gives up after `timeoutMs`: a count is never worth
/// a slower or failed download.
export async function countDownload(product: Product, env: { url?: string; key?: string } = supabaseEnv(), timeoutMs = 1500): Promise<boolean> {
  if (!env.url || !env.key) return false;
  try {
    const res = await fetch(`${env.url}/rest/v1/rpc/count_download`, {
      method: "POST",
      headers: { apikey: env.key, authorization: `Bearer ${env.key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_product: product }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function supabaseEnv() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/// The redirect to the file. A relative Location, so it works on every host the site answers on.
export function toFile(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location: path, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}
