// Logs for the edge functions: one JSON line per event, with an allowlist of fields.
//
// Notes are end-to-end encrypted; while a request runs the server holds some of them in plaintext.
// Nothing of that may reach a log, so a log line carries only known, short, primitive fields (a
// tool's name, a status, a duration, an error's class or code). Anything else is dropped, whatever
// the caller passes. Exceptions are never logged with their message, since a message can quote the
// text it failed on: use errorKind() for their class and code.

const ALLOWED = new Set(["event", "tool", "status", "ms", "code", "kind", "count", "path_kind", "method"]);
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
