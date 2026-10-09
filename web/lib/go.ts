/// Where pintonotes.com/go may send someone: the places the onboarding emails link to
/// (CLICK_HOSTS in supabase/functions/lifecycle/logic.ts). Anything else gets the home page.
/// ambernotes.app is here for the links under /open/, which stay on the old address for the apps
/// people have installed (lib/site-move.ts).
const HOSTS = ["pintonotes.com", "ambernotes.app", "chatgpt.com", "claude.ai", "apps.apple.com"];

export function goTarget(to: string | null): string | null {
  if (!to) return null;
  try {
    const u = new URL(to);
    return u.protocol === "https:" && HOSTS.includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}
