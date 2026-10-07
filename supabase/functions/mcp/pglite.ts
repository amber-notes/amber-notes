// For tests only (nothing the server imports): the whole database, every migration in order, on an
// in-process Postgres (PGlite), with Supabase's own schemas stubbed. Needs no Docker or local stack.
// `sqlFor` gives the MCP tools a stand-in for postgres.js, so they run against it unchanged.
import { PGlite, type Transaction } from "npm:@electric-sql/pglite@0.2.17";
import { pg_trgm } from "npm:@electric-sql/pglite@0.2.17/contrib/pg_trgm";
import type { Sql } from "npm:postgres@3.4.5";

const stubs = `
  create role anon; create role authenticated; create role service_role;
  create role supabase_auth_admin; create role supabase_storage_admin;
  create schema auth; create schema extensions; create schema storage;
  grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema extensions grant execute on functions to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz default now(), recovery_sent_at timestamptz, encrypted_password text);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz default now(), refreshed_at timestamp, user_agent text, ip inet);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
    provider text not null, provider_id text not null, identity_data jsonb not null default '{}', email text, created_at timestamptz default now(),
    unique (provider_id, provider));
  create table auth.mfa_amr_claims (id uuid primary key default gen_random_uuid(), session_id uuid not null references auth.sessions (id) on delete cascade,
    authentication_method text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (session_id, authentication_method));
  create function auth.uid() returns uuid language sql stable as
    $$ select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
  grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create publication supabase_realtime;
  create function extensions.gen_random_bytes(n int) returns bytea language sql as
    $$ select substring(decode(md5(random()::text) || md5(random()::text), 'hex') from 1 for n) $$;
  create function extensions.digest(t text, alg text) returns bytea language sql as $$ select sha256(convert_to(t, 'UTF8')) $$;
  create function extensions.digest(t bytea, alg text) returns bytea language sql as $$ select sha256(t) $$;
`;

/** A fresh database with every migration applied. */
export async function schemaDB(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(stubs);
  const dir = new URL("../../migrations/", import.meta.url);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) {
    try {
      await pg.exec(await Deno.readTextFile(new URL(f, dir)));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  return pg;
}

export async function newUser(pg: PGlite): Promise<string> {
  const id = crypto.randomUUID();
  await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@pane.local`]);
  return id;
}

/** Runs `sql` as the signed-in user, like the app through PostgREST. */
export async function asUser<T = Record<string, unknown>>(pg: PGlite, user: string, sql: string, params: unknown[] = [], settings: Record<string, string> = {}) {
  return await pg.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: "authenticated" })]);
    for (const [k, v] of Object.entries(settings)) await tx.query(`select set_config($1, $2, true)`, [k, v]);
    await tx.exec(`set local role authenticated`);
    return (await tx.query<T>(sql, params)).rows;
  });
}

type Runner = Pick<Transaction, "query">;

class Query {
  constructor(readonly strings: readonly string[], readonly values: unknown[], private readonly db: Runner) {}

  /** The text with $n placeholders; nested queries become part of it. */
  build(params: unknown[] = []): string {
    let text = this.strings[0];
    this.values.forEach((v, i) => {
      if (v instanceof Query) {
        text += v.build(params);
      } else {
        params.push(v);
        text += `$${params.length}`;
      }
      text += this.strings[i + 1];
    });
    return text;
  }

  run() {
    const params: unknown[] = [];
    const text = this.build(params);
    return this.db.query<Record<string, unknown>>(text, params).then((r) => r.rows);
  }

  then<A, B>(ok?: (rows: any) => A, fail?: (e: unknown) => B) {
    return this.run().then(ok, fail);
  }

  catch<B>(fail: (e: unknown) => B) {
    return this.run().catch(fail);
  }
}

function tagged(db: Runner) {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => new Query(strings, values, db);
  return Object.assign(fn, { unsafe: (text: string) => db.query(text).then((r) => r.rows) });
}

/** Enough of postgres.js for functions/mcp/tools.ts: tagged queries, fragments and `begin`. */
export function sqlFor(pg: PGlite): Sql {
  const sql = Object.assign(tagged(pg), {
    begin: <T>(body: (tx: unknown) => Promise<T>) => pg.transaction((tx) => body(tagged(tx))),
  });
  return sql as unknown as Sql;
}
