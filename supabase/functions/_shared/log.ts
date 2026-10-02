// Logs for the edge functions: one JSON line per event, with an allowlist of fields.
//
// Notes are end-to-end encrypted; while a request runs the server holds some of them in plaintext.
// Nothing of that may reach a log, so a log line carries only known, short, primitive fields (a
// tool's name, a status, a duration, an error's class or code). Anything else is dropped, whatever
// the caller passes. Exceptions are never logged with their message, since a message can quote the
// text it failed on: use errorKind() for their class and code.

// "mode", "ssl" and "attempts" are how the database is reached (_shared/db.ts): "pooled" or "direct",
// whether its address asks for TLS, and how many tries a connection took.
const ALLOWED = new Set(["event", "tool", "status", "ms", "code", "kind", "count", "path_kind", "method", "where", "mode", "ssl", "attempts"]);
const MAX = 64;

export type Fields = Record<string, unknown>;

/** The line log() writes. Exported for its test. */
export function line(event: string, fields: Fields = {}): string {
  const out: Record<string, string | number | boolean> = { event: cut(String(event)) };
  for (const [k, v] of Object.entries(fields)) {
    if (k === "event" || !ALLOWED.has(k)) continue;
    if (typeof v === "string") out[k] = cut(v);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 10) / 10;
    else if (typeof v === "boolean") out[k] = v;
  }
  return JSON.stringify(out);
}

export function log(event: string, fields: Fields = {}): void {
  console.log(line(event, fields));
}

/** An exception's class and, for database errors, its SQLSTATE: never its message. */
export function errorKind(e: unknown): { kind: string; code?: string } {
  const kind = e instanceof Error ? e.constructor?.name || "Error" : typeof e;
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? { kind, code } : { kind };
}

function cut(s: string): string {
  // Only plain characters: no newlines or control characters that could forge another line.
  const clean = s.replace(/[^\x20-\x7e]/g, "?");
  return clean.length > MAX ? clean.slice(0, MAX - 1) + "~" : clean;
}

/** Logs a failure: where it happened and the error's class and code, never its message. */
export function logError(where: string, e: unknown) {
  log("error", { where, ...errorKind(e) });
}

// A message with who and what blanked out, for text that has to show an error (never a log line).
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

