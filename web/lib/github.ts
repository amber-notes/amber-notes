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

export async function repoStats(): Promise<{ stars: number } | null> {
  const r = await get<{ stargazers_count: number }>("");
  return r ? { stars: r.stargazers_count } : null;
}

export type Commit = { title: string; url: string; date: string };

/// A few recent changes on main, for the "Built in the open" section.
export async function recentCommits(n = 3): Promise<Commit[]> {
  const list = await get<{ html_url: string; commit: { message: string; author: { date: string } } }[]>(`/commits?per_page=${n}`);
  return (list ?? []).map((c) => ({
    title: c.commit.message.split("\n")[0].replace(/\s*\(#\d+\)$/, ""),
    url: c.html_url,
    date: c.commit.author.date,
  }));
}
