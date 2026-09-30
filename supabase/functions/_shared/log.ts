// What the functions write to their logs when something fails. Function logs are kept by Supabase
// (a day on our plan), so they get the place and the kind of error, never who or what: quoted
// values, emails, ids, addresses and tokens are blanked out of the message first.

const SCRUB: [RegExp, string][] = [
  [/"[^"]*"|'[^']*'/g, "…"],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\bBearer\s+\S+/gi, "Bearer <token>"],
  [/\b(\d{1,3}\.){3}\d{1,3}\b/g, "<address>"],
  [/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}\b/gi, "<address>"],
  [/\b[\w-]{24,}\b/g, "<token>"],
  [/=\([^)]*\)/g, "=(…)"],
];

/** The message of `e` with anything that could say who or what blanked out. */
export function scrub(e: unknown): string {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  let msg = e instanceof Error ? e.message : String(e);
  for (const [re, to] of SCRUB) msg = msg.replace(re, to);
  msg = msg.slice(0, 200);
  return code ? `${code} ${msg}` : msg;
}

/** Logs a failure: where it happened and a scrubbed message. */
export function logError(where: string, e: unknown) {
  console.error(where, scrub(e));
}
