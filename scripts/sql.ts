// Runs SQL against the linked Supabase project: deno run -A scripts/sql.ts "select 1"
import postgres from "npm:postgres@3.4.5";
const env = Object.fromEntries((await Deno.readTextFile(".env")).split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const ref = (await Deno.readTextFile("supabase/.temp/project-ref")).trim();
const pooler = (await Deno.readTextFile("supabase/.temp/pooler-url").catch(() => "")).trim();
const url = pooler
  ? pooler.replace(/^(postgresql:\/\/[^:@]+)(:[^@]*)?@/, `$1:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@`)
  : `postgresql://postgres:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`;
const sql = postgres(url, { prepare: false, max: 1 });
try {
  const rows = await sql.unsafe(Deno.args[0]);
  console.log(JSON.stringify(rows, null, 1));
} finally {
  await sql.end();
}
