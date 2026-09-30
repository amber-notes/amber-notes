// The crypto of end-to-end encryption for scripts that aren't Deno (scripts/review-account.py):
// one JSON request on stdin, one JSON answer on stdout. Everything goes through
// supabase/functions/_shared/e2ee.ts, the formats the apps and the MCP server share, and note heads
// use the MCP server's own titleOf/previewOf, so what a script writes reads the same everywhere.
//
//   echo '{"op":"new-key","user":"<uuid>"}' | deno run --allow-read scripts/e2ee-tool.ts
//
// Keys travel as base64 of the 32 raw bytes. Nothing is logged; errors are {"error": "<what>"}
// with exit code 1, never with key material.
//
// Ops:
//   new-key       {user}                                           → {dk, key_id, verifier, recovery_key_text, recovery_wrap}
//   open-key      {user, recovery_key_text, recovery_wrap, verifier} → {dk, key_id}
//   head          {body, locked?}                                  → {title, preview?}    (what seal-note seals as the head)
//   seal-note     {dk, user, id, body, locked?}                    → {body_ct, head_ct}   (locked: head is the title only, body_ct null)
//   open-note     {dk, user, id, head_ct, body_ct?}                → {head: {title, preview?}, body?}
//   seal-folder   {dk, user, id, name}                             → {name_ct}
//   open-folder   {dk, user, id, name_ct}                          → {name}
//   connect-code  {dk, user}                                       → {code, code_hash, code_wrap}

import {
  fromBase64, hex, keyIdOf, newDataKey, parseRecoveryKey, recoveryKEK, recoveryKeyText, tokenKey, toBase64, unwrap, Vault,
  verifierOf, wrap, type Bytes,
} from "../supabase/functions/_shared/e2ee.ts";
import { previewOf, titleOf } from "../supabase/functions/mcp/notes.ts";

type Request = Record<string, unknown> & { op?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ToolError extends Error {}

function str(r: Request, k: string): string {
  const v = r[k];
  if (typeof v !== "string" || !v) throw new ToolError(`${k} is required`);
  return v;
}
function id(r: Request, k: string): string {
  const v = str(r, k);
  if (!UUID.test(v)) throw new ToolError(`${k} must be a uuid`);
  return v.toLowerCase();
}
function dataKey(r: Request): Bytes {
  const raw = fromBase64(str(r, "dk"));
  if (raw.length !== 32) throw new ToolError("dk must be 32 bytes, base64");
  return raw;
}
const vault = (r: Request) => Vault.from(dataKey(r), id(r, "user"));

/** What a note shows in lists, by the MCP server's rules. A locked note's head is its title only. */
export const headOf = (body: string, locked = false) => (locked ? { title: titleOf(body) } : { title: titleOf(body), preview: previewOf(body) });

export async function handle(r: Request): Promise<Record<string, unknown>> {
  switch (r.op) {
    case "new-key": {
      const user = id(r, "user");
      const dk = newDataKey();
      const recovery = crypto.getRandomValues(new Uint8Array(16));
      const out = {
        dk: toBase64(dk),
        key_id: await keyIdOf(dk),
        verifier: await verifierOf(dk, user),
        recovery_key_text: await recoveryKeyText(recovery),
        recovery_wrap: await wrap(dk, await recoveryKEK(recovery, user), "recovery", user),
      };
      dk.fill(0);
      recovery.fill(0);
      return out;
    }
    case "open-key": {
      const user = id(r, "user");
      const recovery = await parseRecoveryKey(str(r, "recovery_key_text"));
      if (!recovery) throw new ToolError("the recovery key isn't valid");
      let dk: Bytes;
      try {
        dk = await unwrap(str(r, "recovery_wrap"), await recoveryKEK(recovery, user), "recovery", user);
      } catch {
        throw new ToolError("the recovery key doesn't open this account's key");
      }
      if ((await verifierOf(dk, user)) !== str(r, "verifier")) throw new ToolError("the key doesn't match the account's verifier");
      return { dk: toBase64(dk), key_id: await keyIdOf(dk) };
    }
    case "head":
      return headOf(typeof r.body === "string" ? r.body : "", r.locked === true);
    case "seal-note": {
      const v = await vault(r);
      const note = id(r, "id");
      const body = typeof r.body === "string" ? r.body : "";
      const locked = r.locked === true;
      return {
        body_ct: locked ? null : await v.sealBody(note, body),
        head_ct: await v.sealHead(note, headOf(body, locked)),
      };
    }
    case "open-note": {
      const v = await vault(r);
      const note = id(r, "id");
      const head = await v.openHead(note, str(r, "head_ct"));
      return typeof r.body_ct === "string" && r.body_ct ? { head, body: await v.openBody(note, r.body_ct) } : { head };
    }
    case "seal-folder": {
      const v = await vault(r);
      return { name_ct: await v.sealFolder(id(r, "id"), str(r, "name")) };
    }
    case "open-folder": {
      const v = await vault(r);
      return { name: await v.openFolder(id(r, "id"), str(r, "name_ct")) };
    }
    case "connect-code": {
      // What the app does on Allow: it makes the authorization code, and sends only its hash and
      // the data key wrapped under it.
      const user = id(r, "user");
      const dk = dataKey(r);
      const code = "amb_code_" + hex(crypto.getRandomValues(new Uint8Array(32)));
      const code_hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))));
      const code_wrap = await wrap(dk, await tokenKey(code, "code"), "code", user);
      dk.fill(0);
      return { code, code_hash, code_wrap };
    }
    default:
      throw new ToolError("unknown op");
  }
}

async function main() {
  let r: Request;
  try {
    r = JSON.parse(await new Response(Deno.stdin.readable).text());
  } catch {
    console.log(JSON.stringify({ error: "stdin must be one JSON object" }));
    Deno.exit(1);
  }
  try {
    console.log(JSON.stringify(await handle(r)));
  } catch (e) {
    // Only this tool's own messages; anything else could quote what it failed on.
    console.log(JSON.stringify({ error: e instanceof ToolError ? e.message : "couldn't open it (wrong key or data)" }));
    Deno.exit(1);
  }
}

if (import.meta.main) await main();
