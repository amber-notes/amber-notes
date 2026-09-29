/// Public facts about the GitHub repository, fetched server-side (no token) and cached for an hour.
/// Anything that fails returns null and the page simply leaves that detail out.

export const REPO = "emilwagman/amber-notes";
export const GITHUB_URL = `https://github.com/${REPO}`;

const opts = { next: { revalidate: 3600 }, headers: { Accept: "application/vnd.github+json", "User-Agent": "amber-notes-site" } };

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, opts);
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
