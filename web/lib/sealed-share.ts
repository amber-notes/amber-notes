// Sealed links (prototype): `https://ambernotes.app/s/<id>#<secret>`. The note's copy is sealed on
// the device under a key derived from the secret, which stays in the fragment: browsers never send
// it, so neither our database nor this site's server can read the copy. The visitor's browser opens
// it. Pane/Collab/ShareLinks.swift seals; this opens (and seals, for tests and vectors).
//
//   amb3r.<base64 nonce(12) ‖ ciphertext ‖ tag(16)>
//   key  HKDF-SHA256(secret, salt "amber-notes/e2ee", info "share <id>")
//   AAD  "amb3r|<id>"
//
// The id is 22 base64url characters (16 random bytes) and the secret another 22, so the whole link
// stays short enough to paste anywhere.

export type SealedCopy = {
  v: 1;
  title: string;
  /** The note's markdown. */
  body: string;
  /** The note's page, if it has one: a self-contained HTML document. */
  page?: string | null;
  /** The page's own stored data, as it was when the copy was made. */
  data?: Record<string, unknown> | null;
  shared_by?: { name: string | null } | null;
  updated_at: string;
};

const enc = new TextEncoder();
const SALT = enc.encode("amber-notes/e2ee");
export const LINK_ID = /^[A-Za-z0-9_-]{22}$/;

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Base64 in chunks: a spread of a megabyte of bytes would overflow the call stack. */
function b64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function toB64url(b: Uint8Array): string {
  return b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function shareKey(secret: Uint8Array<ArrayBuffer>, id: string, use: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`share ${id}`) }, base,
    { name: "AES-GCM", length: 256 }, false, use);
}

export async function sealCopy(copy: SealedCopy, id: string, secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`amb3r|${id}`) },
    await shareKey(secret, id, ["encrypt"]), enc.encode(JSON.stringify(copy))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return `amb3r.${b64(out)}`;
}

/** Opens a copy with the secret from the link's fragment. Throws when the link is wrong or incomplete. */
export async function openCopy(sealed: string, id: string, secretText: string): Promise<SealedCopy> {
  const m = /^amb3r\.([A-Za-z0-9+/]+={0,2})$/.exec(sealed);
  if (!m || !/^[A-Za-z0-9_-]{22}$/.test(secretText)) throw new Error("incomplete link");
  const b = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: enc.encode(`amb3r|${id}`) },
    await shareKey(fromB64url(secretText), id, ["decrypt"]), b.subarray(12));
  const copy = JSON.parse(new TextDecoder().decode(plain)) as SealedCopy;
  if (copy.v !== 1 || typeof copy.title !== "string" || typeof copy.body !== "string") throw new Error("not a note copy");
  return copy;
}
