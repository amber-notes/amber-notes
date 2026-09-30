// End-to-end encryption: the formats every side shares (the apps in Pane/Model/E2EE.swift and the
// MCP server here). See docs/Technical/e2ee-design.md. e2ee-vectors.json pins every format; the
// Swift and Deno tests both check against it.
//
// One data key (DK) per account, 256 random bits, made on the account's first device and kept in
// iCloud Keychain. Everything the account syncs is sealed with it in the locked-note box format:
//
//   amb2.<key id>.<base64 nonce(12) ‖ ciphertext ‖ tag(16)>      AES-256-GCM
//   AAD = "amb2.<key id>|<context>"
//
// The key id is the first 16 hex digits of SHA-256(DK). The context binds a box to what it is:
// "body:<note id>", "head:<note id>", "folder:<id>", "file-meta:<id>", and for a wrap of DK itself
// "wrap:<purpose>:<user id>". A file's bytes are one box: "AMB2F" ‖ key id ‖ nonce ‖ ciphertext ‖
// tag, with the context "file:<attachment id>".
//
// The server holds no key material, only:
//   account_keys.verifier        HMAC-SHA256 under HKDF(DK, "verifier") of "amber-notes verifier|<user>"
//   account_keys.recovery_wrap   DK sealed under HKDF(recovery key)
//   oauth_requests.code_wrap     DK sealed under HKDF(authorization code), for 60 seconds
//   oauth_tokens.dk_wrap         DK sealed under HKDF(access or refresh token)
//   mcp_tokens.dk_wrap           DK sealed under HKDF(pane_ token)
// and only hashes of those codes and tokens, so a wrap opens only while a request carries one.

export const PREFIX = "amb2";
const enc = new TextEncoder();
export type Bytes = Uint8Array<ArrayBuffer>;
const dec = new TextDecoder("utf-8", { fatal: true });
const SALT = enc.encode("amber-notes/e2ee");

export type WrapPurpose = "recovery" | "code" | "access" | "refresh" | "pane";

export const bodyContext = (id: string) => `body:${id.toLowerCase()}`;
export const headContext = (id: string) => `head:${id.toLowerCase()}`;
export const folderContext = (id: string) => `folder:${id.toLowerCase()}`;
export const fileMetaContext = (id: string) => `file-meta:${id.toLowerCase()}`;
export const fileContext = (id: string) => `file:${id.toLowerCase()}`;
export const wrapContext = (purpose: WrapPurpose, userId: string) => `wrap:${purpose}:${userId.toLowerCase()}`;

/** What a note shows in lists, sealed next to its body. A locked note's head is its title only. */
export type Head = { title: string; preview?: string };
/** A file's name, type and size, sealed together. */
export type FileMeta = { name: string; type: string; size?: number };

export const BOX = /^amb2\.([0-9a-f]{16})\.([A-Za-z0-9+/]+={0,2})$/;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export class OpenError extends Error {}

/** The data key's id: the first 16 hex digits of SHA-256 of the key. */
export async function keyIdOf(raw: Bytes): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))).slice(0, 16);
}

export function newDataKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function aesKey(raw: Bytes): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const aad = (keyId: string, context: string) => enc.encode(`${PREFIX}.${keyId}|${context}`);

/** Seals text (or bytes) as an amb2 box. `nonce` is for test vectors only. */
export async function seal(plain: string | Bytes, key: CryptoKey, keyId: string, context: string, nonce?: Bytes): Promise<string> {
  const iv = nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const data = typeof plain === "string" ? enc.encode(plain) : plain;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(keyId, context) }, key, data));
  const combined = new Uint8Array(12 + ct.length);
  combined.set(iv);
  combined.set(ct, 12);
  return `${PREFIX}.${keyId}.${toBase64(combined)}`;
}

/** The key id a box names, or null when it isn't one. */
export function boxKeyId(sealed: string): string | null {
  return BOX.exec(sealed)?.[1] ?? null;
}

export async function openBytes(sealed: string, key: CryptoKey, context: string): Promise<Bytes> {
  const m = BOX.exec(sealed);
  if (!m) throw new OpenError("not a sealed box");
  const combined = fromBase64(m[2]);
  if (combined.length < 28) throw new OpenError("sealed box too short");
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: combined.subarray(0, 12), additionalData: aad(m[1], context) }, key, combined.subarray(12)));
  } catch {
    throw new OpenError("wrong key or context");
  }
}

export async function open(sealed: string, key: CryptoKey, context: string): Promise<string> {
  const bytes = await openBytes(sealed, key, context);
  try {
    return dec.decode(bytes);
  } catch {
    throw new OpenError("not text");
  }
}

// MARK: The verifier: shows a key is this account's without the server holding it

/** hex(HMAC-SHA256(HKDF(DK, info "verifier"), "amber-notes verifier|<user id>")). */
export async function verifierOf(raw: Bytes, userId: string): Promise<string> {
  const ikm = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const mac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("verifier") },
    ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", mac, enc.encode(`amber-notes verifier|${userId.toLowerCase()}`))));
}

// MARK: Wrapping the data key

/** The key a token or code opens its wrap with: HKDF-SHA256 of the token itself. */
export async function tokenKey(secret: string, purpose: WrapPurpose): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`wrap ${purpose}`) },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The data key sealed with `kek`. The box names the data key's id, so a stale wrap shows. */
export async function wrap(dataKey: Bytes, kek: CryptoKey, purpose: WrapPurpose, userId: string, nonce?: Bytes): Promise<string> {
  return await seal(toBase64(dataKey), kek, await keyIdOf(dataKey), wrapContext(purpose, userId), nonce);
}

export async function unwrap(wrapped: string, kek: CryptoKey, purpose: WrapPurpose, userId: string): Promise<Bytes> {
  const raw = fromBase64(await open(wrapped, kek, wrapContext(purpose, userId)));
  if (raw.length !== 32 || (await keyIdOf(raw)) !== boxKeyId(wrapped)) throw new OpenError("not a data key");
  return raw;
}

// MARK: The recovery key
//
// 128 random bits, written as 28 characters of Crockford base32 (0-9 and A-Z without I, L, O, U)
// in seven groups of four: the 128 bits, then the first 12 bits of SHA-256 of them as a check, so
// a typo is caught before the server is asked anything. Reading it back is forgiving: case,
// spaces and dashes don't matter, and O reads as 0, I and L as 1.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export async function recoveryKeyText(bytes: Uint8Array): Promise<string> {
  if (bytes.length !== 16) throw new Error("a recovery key is 16 bytes");
  const check = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  bits = (bits << 12n) | (BigInt(check[0]) << 4n) | BigInt(check[1] >> 4);
  let out = "";
  for (let i = 27; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return out.match(/.{4}/g)!.join("-");
}

/** The canonical form of a typed recovery key: its 28 characters, or null when it can't be one. */
export function canonicalRecoveryKey(typed: string): string | null {
  const s = typed.toUpperCase().replace(/[\s\-‐-―_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{28}$/.test(s) ? s : null;
}

/** The 16 key bytes a typed recovery key stands for, or null (wrong length, letter or check). */
export async function parseRecoveryKey(typed: string): Promise<Bytes | null> {
  const s = canonicalRecoveryKey(typed);
  if (!s) return null;
  let bits = 0n;
  for (const c of s) bits = (bits << 5n) | BigInt(CROCKFORD.indexOf(c));
  const check = Number(bits & 0xfffn);
  bits >>= 12n;
  const out = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { out[i] = Number(bits & 0xffn); bits >>= 8n; }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", out));
  return ((digest[0] << 4) | (digest[1] >> 4)) === check ? out : null;
}

/** The key the recovery wrap is sealed with: HKDF-SHA256 of the 16 recovery key bytes. */
export async function recoveryKEK(bytes: Bytes, userId: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`recovery ${userId.toLowerCase()}`) },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// MARK: Files

const FILE_MAGIC = enc.encode("AMB2F");

/** A file's bytes, sealed: "AMB2F" ‖ key id (16 ASCII) ‖ nonce ‖ ciphertext ‖ tag. */
export async function sealFile(bytes: Bytes, key: CryptoKey, keyId: string, id: string, nonce?: Bytes): Promise<Bytes> {
  const iv = nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(keyId, fileContext(id)) }, key, bytes));
  const out = new Uint8Array(5 + 16 + 12 + ct.length);
  out.set(FILE_MAGIC);
  out.set(enc.encode(keyId), 5);
  out.set(iv, 21);
  out.set(ct, 33);
  return out;
}

export function isSealedFile(bytes: Uint8Array): boolean {
  return bytes.length >= 49 && FILE_MAGIC.every((b, i) => bytes[i] === b);
}

export async function openFile(bytes: Bytes, key: CryptoKey, id: string): Promise<Bytes> {
  if (!isSealedFile(bytes)) throw new OpenError("not a sealed file");
  const keyId = new TextDecoder().decode(bytes.subarray(5, 21));
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(21, 33), additionalData: aad(keyId, fileContext(id)) }, key, bytes.subarray(33)));
  } catch {
    throw new OpenError("wrong key or file");
  }
}

// MARK: The data key in use

/** An opened data key for one request. Nothing keeps it past the request. */
export class Vault {
  private constructor(readonly keyId: string, private readonly key: CryptoKey, readonly userId: string) {}

  /** Imports the key and wipes the raw bytes it was given. */
  static async from(raw: Bytes, userId: string): Promise<Vault> {
    const v = new Vault(await keyIdOf(raw), await aesKey(raw), userId);
    raw.fill(0);
    return v;
  }

  sealBody(id: string, body: string) { return seal(body, this.key, this.keyId, bodyContext(id)); }
  openBody(id: string, sealed: string) { return open(sealed, this.key, bodyContext(id)); }
  sealHead(id: string, head: Head) {
    const h = head.preview === undefined ? { title: head.title } : { title: head.title, preview: head.preview };
    return seal(JSON.stringify(h), this.key, this.keyId, headContext(id));
  }
  async openHead(id: string, sealed: string): Promise<Head> {
    const h = JSON.parse(await open(sealed, this.key, headContext(id)));
    const title = String(h?.title ?? "New Note");
    return typeof h?.preview === "string" ? { title, preview: h.preview } : { title };
  }
  sealFolder(id: string, name: string) { return seal(name, this.key, this.keyId, folderContext(id)); }
  openFolder(id: string, sealed: string) { return open(sealed, this.key, folderContext(id)); }
  sealFileMeta(id: string, meta: FileMeta) { return seal(JSON.stringify(meta), this.key, this.keyId, fileMetaContext(id)); }
  async openFileMeta(id: string, sealed: string): Promise<FileMeta> {
    const m = JSON.parse(await open(sealed, this.key, fileMetaContext(id)));
    return { name: String(m?.name ?? "file"), type: String(m?.type ?? "public.data"), ...(typeof m?.size === "number" ? { size: m.size } : {}) };
  }
  openFile(id: string, bytes: Bytes) { return openFile(bytes, this.key, id); }
}
