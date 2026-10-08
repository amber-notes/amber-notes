// The database's own error messages say Pinto Notes (20261008210000_pinto_notes_in_messages.sql),
// on the whole schema in PGlite.
//   cd supabase/functions/mcp && deno test -A rename.pglite.test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { newUser, schemaDB } from "./pglite.ts";

const RENAMED = ["create_account_key", "pane_note_lock", "pane_note_page_touch", "pane_sealed_guard", "pane_storage_check", "share_note"];
type Fn = { name: string; args: string; src: string; definer: boolean; config: string[] | null; acl: string | null };
const functions = `
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosrc as src,
    p.prosecdef as definer, p.proconfig as config, p.proacl::text as acl
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'`;

Deno.test("no function in the database says Amber Notes; the renamed ones say Pinto Notes", async () => {
  const pg = await schemaDB();
  const all = (await pg.query<Fn>(functions)).rows;
  assertEquals(all.filter((f) => f.src.includes("Amber Notes")).map((f) => f.name), [],
    "a newer migration raises the old name: say Pinto Notes there");
  for (const name of RENAMED) {
    assert(all.some((f) => f.name === name && f.src.includes("Pinto Notes")), `${name} names the app`);
  }
});

Deno.test("the rename changes the words and nothing else about a function", async () => {
  const pg = await schemaDB();
  const after = (await pg.query<Fn>(`${functions} and p.proname = any($1) order by 1, 2`, [RENAMED])).rows;
  assertEquals(after.length, RENAMED.length, "one function per name, none added beside the old one");
  // The same schema with the rename taken back: what the functions were before it.
  await pg.exec(`do $$ declare f record; begin
    for f in select pg_get_functiondef(p.oid) as def from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc like '%Pinto Notes%'
    loop execute replace(f.def, 'Pinto Notes', 'Amber Notes'); end loop; end $$;`);
  const before = (await pg.query<Fn>(`${functions} and p.proname = any($1) order by 1, 2`, [RENAMED])).rows;
  assertEquals(after.map((f) => ({ ...f, src: f.src.replaceAll("Pinto Notes", "Amber Notes") })), before);
});

Deno.test("a full account is told Pinto Notes is full, with the storage hint the server reads", async () => {
  const pg = await schemaDB();
  const me = await newUser(pg);
  const e = await assertRejects(() => pg.query(`select public.pane_storage_check($1, $2)`, [me, 3 * 1024 ** 3]), Error,
    "Pinto Notes is full: you use all 2 GB.");
  assertEquals((e as { hint?: string }).hint, "storage");
});
