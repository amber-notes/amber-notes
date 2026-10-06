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
// "body:<note id>", "head:<note id>", "page:<note id>", "page-data:<note id>", "folder:<id>", "file-meta:<id>", and for a wrap of DK itself
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
export const pageContext = (id: string) => `page:${id.toLowerCase()}`;
export const pageDataContext = (id: string) => `page-data:${id.toLowerCase()}`;
export const apiKeyContext = (id: string) => `api-key:${id.toLowerCase()}`;
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

// MARK: Share tags: which notes the account's devices chose to share
//
// A shared page is readable, so a device (or the AI server) publishes a note only for a share the
// account made itself. The share's tag, written when it's made, is an HMAC under a subkey of DK; a
// share row planted or changed by anyone without the key doesn't verify, and nothing is published.

/** hex(HMAC-SHA256(HKDF(DK, info "share"), "share|<note id>|<slug>|<1 or 0>")). */
export async function shareTag(raw: Bytes, noteId: string, slug: string, includeSubnotes: boolean): Promise<string> {
  const ikm = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const mac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("share") },
    ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  const msg = `share|${noteId.toLowerCase()}|${slug}|${includeSubnotes ? 1 : 0}`;
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", mac, enc.encode(msg))));
}

// MARK: Number matching: commit, then reveal, then the same two digits on both screens
//
// Like Bluetooth numeric comparison. The page commits to its key and a secret nonce Np before it
// sees anything from the device: commit = SHA-256(browser key raw ‖ Np). The device then writes its
// own random nonce Nd. Only after that does the page reveal Np, and the device checks the commit.
// Both show SHA-256(browser key raw ‖ Np ‖ Nd ‖ request id), first four bytes as a big-endian
// number, mod 100. Someone swapping the page's key had to commit before Nd existed, so they can't
// grind a key that gives the same number: they match one time in a hundred, and the person types
// the number, so a wrong guess is caught.

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** hex SHA-256(browser key raw ‖ Np). Np is 16 random bytes only the page holds until it reveals them. */
export async function matchCommit(browserPublicRaw: Uint8Array, pageNonce: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", concat(browserPublicRaw, pageNonce))));
}

/** The two digits both screens show, from the page's key, both nonces and the request. */
export async function matchNumber(browserPublicRaw: Uint8Array, pageNonce: Uint8Array, deviceNonce: Uint8Array, requestId: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256",
    concat(browserPublicRaw, pageNonce, deviceNonce, enc.encode(requestId.toLowerCase()))));
  const n = ((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3];
  return String(n % 100).padStart(2, "0");
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

// MARK: Handing an authorization code to the browser that asked
//
// Approving an AI on a device for a browser elsewhere: the page makes a P-256 key pair and sends
// the public half with its ask; the device makes the code, seals it to that key and stores only
// the sealed code. The server never holds the code and its wrap together.
//
//   amb2h.<base64 device ephemeral public key (65, uncompressed) ‖ nonce (12) ‖ ciphertext ‖ tag>
//   key = HKDF-SHA256(ECDH shared secret, salt "amber-notes/e2ee", info "handoff <request id>")
//   AAD = "amb2h|<request id>"

export const HANDOFF = /^amb2h\.([A-Za-z0-9+/]+={0,2})$/;

async function handoffKey(priv: CryptoKey, pub: CryptoKey, requestId: string): Promise<CryptoKey> {
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`handoff ${requestId.toLowerCase()}`) },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** A key pair for the page's ask. Its public half goes to the server as raw uncompressed bytes. */
export async function newHandoffKeys(): Promise<{ privateKey: CryptoKey; publicRaw: Bytes }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)) };
}

/** What a device hands the page: the code and the redirect it goes to, sealed together so nobody
 *  on the way can send the page elsewhere. */
export type HandoffPayload = { code: string; redirect: string };
export const handoffPayload = (p: HandoffPayload) => JSON.stringify({ code: p.code, redirect: p.redirect });
export function readHandoffPayload(text: string): HandoffPayload {
  const p = JSON.parse(text);
  if (typeof p?.code !== "string" || typeof p?.redirect !== "string") throw new OpenError("not a handoff payload");
  return { code: p.code, redirect: p.redirect };
}

/** Seals `code` (a handoffPayload) to the page's public key. `ephemeral` and `nonce` are for test vectors only. */
export async function sealHandoff(code: string, browserPublicRaw: Bytes, requestId: string, ephemeral?: CryptoKeyPair, nonce?: Bytes): Promise<string> {
  const pub = await crypto.subtle.importKey("raw", browserPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = ephemeral ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const key = await handoffKey(eph.privateKey, pub, requestId);
  const iv = nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`amb2h|${requestId.toLowerCase()}`) }, key, enc.encode(code)));
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const out = new Uint8Array(65 + 12 + ct.length);
  out.set(ephRaw);
  out.set(iv, 65);
  out.set(ct, 77);
  return `amb2h.${toBase64(out)}`;
}

export async function openHandoff(sealed: string, browserPrivate: CryptoKey, requestId: string): Promise<string> {
  const m = HANDOFF.exec(sealed);
  if (!m) throw new OpenError("not a handoff");
  const b = fromBase64(m[1]);
  if (b.length < 65 + 12 + 16) throw new OpenError("handoff too short");
  try {
    const pub = await crypto.subtle.importKey("raw", b.subarray(0, 65), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const key = await handoffKey(browserPrivate, pub, requestId);
    return dec.decode(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b.subarray(65, 77), additionalData: enc.encode(`amb2h|${requestId.toLowerCase()}`) }, key, b.subarray(77)));
  } catch {
    throw new OpenError("wrong key or request");
  }
}

// MARK: Adding a device: the whole key, from a device that has it to one that doesn't
//
// A signed-in device without the key shows a QR code and a typed code. A device with the key reads
// one of them inside Amber Notes and seals the key to the new device (docs/Evidence/
// add-device-threat-model.md). Both carry a pairing secret the server never sees:
//
//   QR text      "amber-notes add-device v1 <22 base64url>"   16 random bytes; not a link, so only
//                the scanner in the app acts on it
//   typed code   12 Crockford characters in three groups of four: 60 random bits
//
//   prk     the QR's 16 bytes, or for the typed code PBKDF2-HMAC-SHA256(code canonical,
//           salt "amber-notes/add-device|<user id>", 600 000 rounds, 32 bytes)
//   answer  hex HKDF-SHA256(prk, salt "amber-notes/e2ee", info "add-device answer <user id>"):
//           what the approving device shows the server, which holds only the SHA-256 of its bytes
//   bind    HKDF-SHA256(prk, same salt, info "add-device bind <user id>"): never sent
//   tag     hex HMAC-SHA256(bind, "amber-notes add-device|<request id>|<platform>|" ‖ new device's
//           public key, raw 65): the approving device checks it before sealing, so a key swapped
//           on the way shows
//   name    the new device's name, which the server never reads:
//           amb2n.<base64 nonce (12) ‖ ciphertext ‖ tag>, key HKDF-SHA256(bind, same salt, info
//           "add-device name"), AAD "amb2n|<request id>|<platform>"
//
//   amb2d.<base64 approving device's ephemeral public key (65) ‖ nonce (12) ‖ ciphertext ‖ tag>
//   key = HKDF-SHA256(ECDH shared secret ‖ bind, salt "amber-notes/e2ee", info "add-device <request id>")
//   AAD = "amb2d|<request id>|<user id>"
//   plaintext = the key as the Keychain holds it: version (2) ‖ DK (32) ‖ recovery key (16) ‖
//               generation (4)
//
// The bind in the sealing key works both ways: only someone who read the new device's screen can
// seal something it accepts, and nobody who swapped its public key can open what was sealed.

export const ADD_DEVICE_QR = /^amber-notes add-device v1 ([A-Za-z0-9_-]{22})$/;
export const ADD_DEVICE_SEALED = /^amb2d\.([A-Za-z0-9+/]+={0,2})$/;
export const ADD_DEVICE_ROUNDS = 600_000;

const b64url = (b: Uint8Array) => toBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => fromBase64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));

/** What the new device's QR code says. */
export const addDeviceQR = (secret: Uint8Array) => `amber-notes add-device v1 ${b64url(secret)}`;

/** The 16 bytes a scanned code carries, or null when it isn't an add-device code. */
export function readAddDeviceQR(text: string): Bytes | null {
  const m = ADD_DEVICE_QR.exec(text);
  if (!m) return null;
  const b = fromB64url(m[1]);
  return b.length === 16 ? b : null;
}

/** The typed code for 60 bits (the first 60 of 8 bytes): three groups of four. */
export function addDeviceCodeText(bytes: Uint8Array): string {
  if (bytes.length !== 8) throw new Error("an add-device code is made from 8 bytes");
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  bits >>= 4n;
  let out = "";
  for (let i = 11; i >= 0; i--) out += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return out.match(/.{4}/g)!.join("-");
}

/** The canonical form of a typed code: its 12 characters, or null when it can't be one. */
export function canonicalAddDeviceCode(typed: string): string | null {
  const s = typed.toUpperCase().replace(/[\s\-‐-―_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

/** The typed code stretched, so guessing it costs: PBKDF2-HMAC-SHA256, 600 000 rounds. */
export async function addDeviceCodePrk(canonical: string, userId: string): Promise<Bytes> {
  const pw = await crypto.subtle.importKey("raw", enc.encode(canonical), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`amber-notes/add-device|${userId.toLowerCase()}`), iterations: ADD_DEVICE_ROUNDS }, pw, 256));
}

export type AddDevicePairing = { answer: string; bind: Bytes };

/** What a pairing secret (the QR's bytes, or the stretched typed code) gives both devices. */
export async function addDevicePairing(prk: Bytes, userId: string): Promise<AddDevicePairing> {
  const ikm = await crypto.subtle.importKey("raw", prk, "HKDF", false, ["deriveBits"]);
  const derive = async (what: string) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`add-device ${what} ${userId.toLowerCase()}`) }, ikm, 256));
  return { answer: hex(await derive("answer")), bind: await derive("bind") };
}

/** hex SHA-256 of the answer's 32 bytes (not of its hex text): what the server keeps and compares. */
export async function addDeviceAnswerHash(answer: string): Promise<string> {
  const raw = Uint8Array.from(answer.match(/../g) ?? [], (h) => parseInt(h, 16));
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)));
}

export type AddDeviceRequest = { requestId: string; platform: string; publicRaw: Uint8Array };

/** The new device's public key and kind, vouched for by the pairing secret. */
export async function addDeviceTag(bind: Bytes, r: AddDeviceRequest): Promise<string> {
  const key = await crypto.subtle.importKey("raw", bind, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = concat(enc.encode(`amber-notes add-device|${r.requestId.toLowerCase()}|${r.platform}|`), r.publicRaw);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)));
}

export const ADD_DEVICE_NAME = /^amb2n\.([A-Za-z0-9+/]+={0,2})$/;

async function addDeviceNameKey(bind: Bytes): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", bind, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("add-device name") },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const addDeviceNameAAD = (requestId: string, platform: string) => enc.encode(`amb2n|${requestId.toLowerCase()}|${platform}`);

/** The new device's name, readable only with the pairing secret. `nonce` is for test vectors only. */
export async function sealDeviceName(name: string, bind: Bytes, requestId: string, platform: string, nonce?: Bytes): Promise<string> {
  const iv = nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: addDeviceNameAAD(requestId, platform) }, await addDeviceNameKey(bind), enc.encode(name)));
  return `amb2n.${toBase64(concat(iv, ct))}`;
}

export async function openDeviceName(sealed: string, bind: Bytes, requestId: string, platform: string): Promise<string> {
  const m = ADD_DEVICE_NAME.exec(sealed);
  if (!m) throw new OpenError("not a device name");
  const b = fromBase64(m[1]);
  if (b.length < 28) throw new OpenError("device name too short");
  try {
    return dec.decode(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b.subarray(0, 12), additionalData: addDeviceNameAAD(requestId, platform) }, await addDeviceNameKey(bind), b.subarray(12)));
  } catch {
    throw new OpenError("wrong code or request");
  }
}

async function addDeviceKey(priv: CryptoKey, pub: CryptoKey, bind: Bytes, requestId: string): Promise<CryptoKey> {
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const ikm = await crypto.subtle.importKey("raw", concat(shared, bind), "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`add-device ${requestId.toLowerCase()}`) },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const addDeviceAAD = (requestId: string, userId: string) => enc.encode(`amb2d|${requestId.toLowerCase()}|${userId.toLowerCase()}`);

/** The stored key (53 bytes) sealed to the new device. `ephemeral` and `nonce` are for test vectors only. */
export async function sealDeviceKey(stored: Bytes, newDevicePublicRaw: Bytes, bind: Bytes, requestId: string, userId: string,
  ephemeral?: CryptoKeyPair, nonce?: Bytes): Promise<string> {
  const pub = await crypto.subtle.importKey("raw", newDevicePublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = ephemeral ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const key = await addDeviceKey(eph.privateKey, pub, bind, requestId);
  const iv = nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: addDeviceAAD(requestId, userId) }, key, stored));
  return `amb2d.${toBase64(concat(new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey)), iv, ct))}`;
}

export async function openDeviceKey(sealed: string, newDevicePrivate: CryptoKey, bind: Bytes, requestId: string, userId: string): Promise<Bytes> {
  const m = ADD_DEVICE_SEALED.exec(sealed);
  if (!m) throw new OpenError("not a device key");
  const b = fromBase64(m[1]);
  if (b.length < 65 + 12 + 16) throw new OpenError("device key too short");
  try {
    const pub = await crypto.subtle.importKey("raw", b.subarray(0, 65), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const key = await addDeviceKey(newDevicePrivate, pub, bind, requestId);
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b.subarray(65, 77), additionalData: addDeviceAAD(requestId, userId) }, key, b.subarray(77)));
  } catch {
    throw new OpenError("wrong key, code or request");
  }
}

// MARK: The devices that hold the key
//
// Each device with the key lists itself (key_devices) so Privacy & Security can say where the key
// is kept. A row counts only with a tag made with the key, so nobody without the key can add a
// device to the list or take one off it. The device's name is sealed like a folder's name:
//
//   name         an amb2 box, context "device:<device id>"
//   epoch        16 random bytes (hex) the device makes each time it comes to hold the key, and
//                keeps to itself as well
//   device tag   hex HMAC-SHA256(HKDF(DK, info "devices"), "device|<user id>|<device id>|<platform>|<how>|<1 or 0>|<epoch>")
//   removal tag  hex HMAC-SHA256(HKDF(DK, info "devices"), "remove|<user id>|<device id>|<epoch>")
//
// A device obeys a removal only for the epoch it holds now, so a removal tag from before it was
// added again is worth nothing.

export const deviceContext = (id: string) => `device:${id.toLowerCase()}`;

async function devicesKey(raw: Bytes): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("devices") },
    ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
}

export type KeyDevice = { deviceId: string; platform: string; how: string; backedUp: boolean; epoch: string };

export async function keyDeviceTag(raw: Bytes, userId: string, d: KeyDevice): Promise<string> {
  const msg = `device|${userId.toLowerCase()}|${d.deviceId.toLowerCase()}|${d.platform}|${d.how}|${d.backedUp ? 1 : 0}|${d.epoch}`;
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", await devicesKey(raw), enc.encode(msg))));
}

export async function keyDeviceRemovalTag(raw: Bytes, userId: string, deviceId: string, epoch: string): Promise<string> {
  const msg = `remove|${userId.toLowerCase()}|${deviceId.toLowerCase()}|${epoch}`;
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", await devicesKey(raw), enc.encode(msg))));
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
  private constructor(readonly keyId: string, private readonly key: CryptoKey, readonly userId: string, private readonly shareKey: CryptoKey) {}

  /** Imports the key and wipes the raw bytes it was given. */
  static async from(raw: Bytes, userId: string): Promise<Vault> {
    const ikm = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    const shareKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("share") },
      ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
    const v = new Vault(await keyIdOf(raw), await aesKey(raw), userId, shareKey);
    raw.fill(0);
    return v;
  }

  /** Whether a share's tag is the one this account's key makes (see shareTag). */
  async shareTagMatches(noteId: string, slug: string, includeSubnotes: boolean, tag: string | null): Promise<boolean> {
    if (!tag || !/^[0-9a-f]{64}$/.test(tag)) return false;
    const msg = `share|${noteId.toLowerCase()}|${slug}|${includeSubnotes ? 1 : 0}`;
    const mine = hex(new Uint8Array(await crypto.subtle.sign("HMAC", this.shareKey, enc.encode(msg))));
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= mine.charCodeAt(i) ^ tag.charCodeAt(i);
    return diff === 0;
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
  sealPage(id: string, html: string) { return seal(html, this.key, this.keyId, pageContext(id)); }
  openPage(id: string, sealed: string) { return open(sealed, this.key, pageContext(id)); }
  sealPageData(id: string, json: string) { return seal(json, this.key, this.keyId, pageDataContext(id)); }
  openPageData(id: string, sealed: string) { return open(sealed, this.key, pageDataContext(id)); }
  sealAPIKeyMeta(id: string, json: string) { return seal(json, this.key, this.keyId, apiKeyContext(id)); }
  openAPIKeyMeta(id: string, sealed: string) { return open(sealed, this.key, apiKeyContext(id)); }
  sealFolder(id: string, name: string) { return seal(name, this.key, this.keyId, folderContext(id)); }
  openFolder(id: string, sealed: string) { return open(sealed, this.key, folderContext(id)); }
  sealFileMeta(id: string, meta: FileMeta) { return seal(JSON.stringify(meta), this.key, this.keyId, fileMetaContext(id)); }
  async openFileMeta(id: string, sealed: string): Promise<FileMeta> {
    const m = JSON.parse(await open(sealed, this.key, fileMetaContext(id)));
    return { name: String(m?.name ?? "file"), type: String(m?.type ?? "public.data"), ...(typeof m?.size === "number" ? { size: m.size } : {}) };
  }
  openFile(id: string, bytes: Bytes) { return openFile(bytes, this.key, id); }
  sealFileBytes(id: string, bytes: Bytes) { return sealFile(bytes, this.key, this.keyId, id); }
}
