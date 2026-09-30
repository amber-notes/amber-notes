// End-to-end encryption: the formats every side shares (the apps in Pane/Model/E2EE.swift, the web
// approval page in web/lib/e2ee.ts, and the MCP server here). See docs/Technical/e2ee-design.md.
//
// One data key per account (256 random bits), made on the user's first device. Everything the
// account writes is sealed with it in the notes-password box format:
//
//   amb2.<key id>.<base64 nonce(12) ‖ ciphertext ‖ tag(16)>      AES-256-GCM
//   AAD = "amb2.<key id>|<context>"
//
// The key id is the first 16 hex digits of SHA-256(data key). The context binds a box to what it
// is: "body:<note id>", "head:<note id>", "folder:<id>", "file-meta:<id>", and for the key itself
// "wrap:<purpose>:<user id>". A file's bytes are one box: "AMB2F" ‖ key id ‖ nonce ‖ ciphertext ‖ tag,
// with the context "file:<attachment id>".
//
// The data key is kept by the server only wrapped (sealed): under the encryption password (PBKDF2),
// under the recovery key, and under each AI connection's tokens (HKDF of the token). Only a hash of
// a token is stored, so the server can open a wrap only while a request carries the token itself.

export const PREFIX = "amb2";
const enc = new TextEncoder();
export type Bytes = Uint8Array<ArrayBuffer>;
const dec = new TextDecoder("utf-8", { fatal: true });

export type WrapPurpose = "password" | "recovery" | "code" | "access" | "refresh" | "pane" | "file";

export const bodyContext = (id: string) => `body:${id.toLowerCase()}`;
export const headContext = (id: string) => `head:${id.toLowerCase()}`;
export const folderContext = (id: string) => `folder:${id.toLowerCase()}`;
export const fileMetaContext = (id: string) => `file-meta:${id.toLowerCase()}`;
export const fileContext = (id: string) => `file:${id.toLowerCase()}`;
export const wrapContext = (purpose: WrapPurpose, userId: string) => `wrap:${purpose}:${userId.toLowerCase()}`;

/** What a note shows in lists, sealed next to its body. */
export type Head = { title: string; preview: string };

export const BOX = /^amb2\.([0-9a-f]{16})\.([A-Za-z0-9+/]+={0,2})$/;

export function toBase64(bytes: Bytes): string {
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

export const hex = (bytes: Bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

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

// MARK: Wrapping the data key

/** The key a token (or code, or file link) opens its wrap with: HKDF-SHA256 of the token itself. */
export async function tokenKey(secret: string, purpose: WrapPurpose): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("amber-notes/e2ee"), info: enc.encode(`wrap ${purpose}`) },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The key the encryption password gives: PBKDF2-HMAC-SHA256, as for the notes password. */
export async function passwordKey(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(saltB64), iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** The recovery key as typed: letters and digits only, upper case. */
export const normalizeRecoveryKey = (typed: string) => typed.toUpperCase().replace(/[^0-9A-Z]/g, "");

export async function recoveryKey(typed: string, userId: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc.encode(normalizeRecoveryKey(typed)), "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("amber-notes/e2ee"), info: enc.encode(`recovery ${userId.toLowerCase()}`) },
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

export function isSealedFile(bytes: Bytes): boolean {
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

  static async from(raw: Bytes, userId: string): Promise<Vault> {
    const v = new Vault(await keyIdOf(raw), await aesKey(raw), userId);
    return v;
  }

  sealText(text: string, context: string) { return seal(text, this.key, this.keyId, context); }
  openText(sealed: string, context: string) { return open(sealed, this.key, context); }

  sealBody(id: string, body: string) { return seal(body, this.key, this.keyId, bodyContext(id)); }
  openBody(id: string, sealed: string) { return open(sealed, this.key, bodyContext(id)); }
  sealHead(id: string, head: Head) { return seal(JSON.stringify(head), this.key, this.keyId, headContext(id)); }
  async openHead(id: string, sealed: string): Promise<Head> {
    const h = JSON.parse(await open(sealed, this.key, headContext(id)));
    return { title: String(h?.title ?? "New Note"), preview: String(h?.preview ?? "") };
  }
  sealFolder(id: string, name: string) { return seal(name, this.key, this.keyId, folderContext(id)); }
  openFolder(id: string, sealed: string) { return open(sealed, this.key, folderContext(id)); }
  async openFileMeta(id: string, sealed: string): Promise<{ name: string; type: string }> {
    const m = JSON.parse(await open(sealed, this.key, fileMetaContext(id)));
    return { name: String(m?.name ?? "file"), type: String(m?.type ?? "public.data") };
  }
  openFile(id: string, bytes: Bytes) { return openFile(bytes, this.key, id); }
}
