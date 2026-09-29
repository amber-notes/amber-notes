// Weekly adoption numbers from our own database (no analytics service involved).
//   deno run -A scripts/adoption.ts            # production (needs .env SUPABASE_DB_PASSWORD)
//   deno run -A scripts/adoption.ts --local    # the local Supabase stack
//   deno run -A scripts/adoption.ts --weeks 12
//
// MVR: first AI edit within 24 h of sign-up.
// MVA: 10+ AI edits on 3+ different days in the first 14 days, and 2+ devices.
import postgres from "npm:postgres@3.4.5";

const args = Deno.args;
const weeks = Number(args[args.indexOf("--weeks") + 1]) || 8;
const local = args.includes("--local");

async function databaseURL(): Promise<string> {
  if (local) {
    const out = new TextDecoder().decode((await new Deno.Command("supabase", { args: ["status", "-o", "env"], stderr: "null" }).output()).stdout);
    const url = out.split("\n").find((l) => l.startsWith("DB_URL="))?.slice(7).replace(/^"|"$/g, "");
    if (!url || !url.includes("127.0.0.1")) throw new Error("No local stack. Run supabase start.");
    return url;
  }
  const env = Object.fromEntries((await Deno.readTextFile(".env")).split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const ref = (await Deno.readTextFile("supabase/.temp/project-ref")).trim();
  const pooler = (await Deno.readTextFile("supabase/.temp/pooler-url").catch(() => "")).trim();
  return pooler
    ? pooler.replace(/^(postgresql:\/\/[^:@]+)(:[^@]*)?@/, `$1:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@`)
    : `postgresql://postgres:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`;
}

const sql = postgres(await databaseURL(), { prepare: false, max: 1 });
try {
  const rows = await sql`select * from public.pane_adoption(${weeks})`;
  const pct = (v: unknown) => (v == null ? "–" : `${v}%`);
  const hours = (v: unknown) => (v == null ? "–" : `${v} h`);
  console.log(`Adoption by sign-up week (${local ? "local" : "production"}), last ${weeks} weeks\n`);
  console.log("Week        New   MVR          MVA          Median to first AI edit");
  for (const r of rows) {
    console.log(
      `${new Date(r.week as string).toISOString().slice(0, 10)}  ${String(r.new_accounts).padStart(4)}  ` +
        `${String(r.mvr).padStart(3)} ${pct(r.mvr_pct).padStart(7)}  ${String(r.mva).padStart(3)} ${pct(r.mva_pct).padStart(7)}  ${hours(r.median_hours_to_first_ai)}`,
    );
  }
  if (rows.length === 0) console.log("(no sign-ups in this window)");
} finally {
  await sql.end();
}
