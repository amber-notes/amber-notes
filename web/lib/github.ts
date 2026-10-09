/// Public facts about the GitHub repository, fetched server-side (no token) and cached for an hour.
/// Anything that fails returns null and the page simply leaves that detail out.

export const REPO = "pinto-notes/pinto-notes";
export const GITHUB_URL = `https://github.com/${REPO}`;

const headers = { Accept: "application/vnd.github+json", "User-Agent": "amber-notes-site" };

async function get<T>(path: string, revalidate = 3600): Promise<T | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { next: { revalidate }, headers });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export type RepoStats = { stars: number; description: string | null; license: string | null; pushedAt: string | null };

export async function repoStats(): Promise<RepoStats | null> {
  const r = await get<{ stargazers_count: number; description: string | null; license: { spdx_id: string } | null; pushed_at: string }>("");
  return r ? { stars: r.stargazers_count, description: r.description, license: r.license?.spdx_id ?? null, pushedAt: r.pushed_at } : null;
}

/// The star count alone, fresher than repoStats(): app/stars.json serves it to the header after load.
export async function starCount(revalidate: number): Promise<number | null> {
  const r = await get<{ stargazers_count?: unknown }>("", revalidate);
  const n = r?.stargazers_count;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/// Share of the code by language, largest first; small ones are folded into "Other".
export async function languages(): Promise<{ name: string; percent: number }[]> {
  const r = await get<Record<string, number>>("/languages");
  if (!r) return [];
  const total = Object.values(r).reduce((a, b) => a + b, 0) || 1;
  const all = Object.entries(r).map(([name, bytes]) => ({ name, percent: (bytes / total) * 100 })).sort((a, b) => b.percent - a.percent);
  const main = all.filter((l) => l.percent >= 3).slice(0, 3);
  const other = 100 - main.reduce((a, l) => a + l.percent, 0);
  return other >= 0.5 ? [...main, { name: "Other", percent: other }] : main;
}

export async function latestRelease(): Promise<string | null> {
  const r = await get<{ tag_name: string }>("/releases/latest");
  return r?.tag_name ?? null;
}
