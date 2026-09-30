// Who reported a shared page, as the database keeps it: an HMAC of the visitor's network address
// under a secret salt and the month. It lets one person count once, can't be turned back into an
// address, and hashes from different months can't be linked. The address itself is never stored.
import { createHmac, randomUUID } from "node:crypto";

// Without REPORT_SALT, a random key for this server instance: never one anyone could guess.
const fallback = randomUUID();

export function reporterHash(address: string, salt: string, now = new Date()): string {
  const month = now.toISOString().slice(0, 7);
  return createHmac("sha256", salt || fallback).update(`${month}|${address || "unknown"}`).digest("hex");
}
