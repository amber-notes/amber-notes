// The Mac download counter. "Download for Mac" links go to /download/mac (MAC_DOWNLOAD_PATH), which
// adds one to today's total in Supabase (count_download, 20261001150000_download_counts.sql) and
// redirects to the DMG. Only a daily total per product is stored: no address, browser, cookie or
// anything else about who downloaded. Sparkle's appcast points at the versioned DMG directly, so
// updates are never counted.
export const MAC_DOWNLOAD_PATH = "/download/mac";
export const MAC_DMG = "/downloads/Amber-Notes.dmg";

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
