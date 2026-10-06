// .amber/state.json: what the folder and the account agreed on at the last sync, per note. A note
// whose file hash moved on changed here; one whose version moved on changed in Amber; both is a
// conflict.
export type Entry = {
  /** The file, relative to the folder. */
  path: string;
  /** The note's path in Amber when it was last seen. */
  remotePath: string;
  /** The note's version when it was last seen (the files tools' version; the classic tools' updated time). */
  version: string;
  /** sha-256 of the text both sides had. */
  hash: string;
};

export type State = { format: 1; server: string; synced: string | null; notes: Record<string, Entry> };

export const stateFile = (dir: string) => `${dir}/.amber/state.json`;

export function emptyState(server: string): State {
  return { format: 1, server, synced: null, notes: {} };
}

export async function loadState(dir: string, server: string): Promise<State> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(stateFile(dir));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return emptyState(server);
    throw e;
  }
  const s = JSON.parse(raw) as State;
  if (s.format !== 1 || typeof s.notes !== "object") throw new Error(`${stateFile(dir)} isn't a state file this version reads.`);
  if (s.server !== server) throw new Error(`This folder syncs with ${s.server}, not ${server}. Use another folder, or remove ${dir}/.amber to start over.`);
  return s;
}

/** Written to a temporary file and renamed, so a crash never leaves half a state file. */
export async function saveState(dir: string, s: State): Promise<void> {
  await Deno.mkdir(`${dir}/.amber`, { recursive: true });
  const tmp = `${stateFile(dir)}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(s, null, 2) + "\n");
  await Deno.rename(tmp, stateFile(dir));
}

export async function hashOf(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
