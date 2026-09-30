// Empties the `files` and `shared` Storage buckets, once, after the end-to-end encryption
// migration (supabase/migrations/20261001090000_e2ee.sql). The migration wipes the rows; Storage
// objects can't be deleted from SQL, so this does it through the Storage API.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-env --allow-net scripts/e2ee-wipe-storage.ts [--dry-run]
//
// It runs only against the Amber Notes project (rodegaeruhyybqilrnpn) or a local stack, and prints
// counts only: no object names, no paths.

const PROJECT_REF = "rodegaeruhyybqilrnpn";
const BUCKETS = ["files", "shared"];
const PAGE = 1000;
const BATCH = 500;

/** The project a URL names, or "local"; null for anything this script won't touch. */
export function target(url: string): "local" | typeof PROJECT_REF | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && (u.protocol === "http:" || u.protocol === "https:")) return "local";
  if (u.protocol === "https:" && u.hostname === `${PROJECT_REF}.supabase.co`) return PROJECT_REF;
  return null;
}

type Entry = { name: string; id: string | null };

async function list(api: string, key: string, bucket: string, prefix: string): Promise<Entry[]> {
  const out: Entry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${api}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`listing ${bucket} failed (${res.status})`);
    const page = await res.json() as Entry[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Every object's path in a bucket, walking folders (entries without an id). */
async function allObjects(api: string, key: string, bucket: string): Promise<string[]> {
  const paths: string[] = [];
  const folders = [""];
  while (folders.length) {
    const prefix = folders.pop()!;
    for (const e of await list(api, key, bucket, prefix)) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) folders.push(path);
      else paths.push(path);
    }
  }
  return paths;
}

/** Whether the project has the bucket (`shared` may never have been made). */
async function exists(api: string, key: string, bucket: string): Promise<boolean> {
  const res = await fetch(`${api}/storage/v1/bucket/${bucket}`, { headers: { authorization: `Bearer ${key}`, apikey: key } });
  await res.body?.cancel();
  if (res.ok) return true;
  if (res.status === 400 || res.status === 404) return false;
  throw new Error(`checking ${bucket} failed (${res.status})`);
}

async function remove(api: string, key: string, bucket: string, paths: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += BATCH) {
    const res = await fetch(`${api}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths.slice(i, i + BATCH) }),
    });
    if (!res.ok) throw new Error(`deleting from ${bucket} failed (${res.status})`);
    removed += ((await res.json()) as unknown[]).length;
  }
  return removed;
}

async function main() {
  const dryRun = Deno.args.includes("--dry-run");
  const unknown = Deno.args.filter((a) => a !== "--dry-run");
  if (unknown.length) {
    console.error("Usage: deno run --allow-env --allow-net scripts/e2ee-wipe-storage.ts [--dry-run]");
    Deno.exit(2);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const where = target(url);
  if (!where) {
    console.error(`Refusing: SUPABASE_URL must be https://${PROJECT_REF}.supabase.co or a local stack (127.0.0.1 / localhost).`);
    Deno.exit(1);
  }
  if (!key) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY.");
    Deno.exit(1);
  }
  const api = url.replace(/\/+$/, "");
  console.log(`${dryRun ? "Dry run on" : "Emptying buckets on"} ${where === "local" ? "the local stack" : `project ${where}`}.`);
  for (const bucket of BUCKETS) {
    if (!(await exists(api, key, bucket))) {
      console.log(`${bucket}: no such bucket, skipped`);
      continue;
    }
    const paths = await allObjects(api, key, bucket);
    if (dryRun) {
      console.log(`${bucket}: ${paths.length} objects would be deleted`);
      continue;
    }
    const removed = await remove(api, key, bucket, paths);
    const left = (await allObjects(api, key, bucket)).length;
    console.log(`${bucket}: ${removed} of ${paths.length} objects deleted, ${left} left`);
  }
}

if (import.meta.main) await main();
