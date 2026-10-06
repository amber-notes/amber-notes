// Collaboration (prototype): the formats for shared notes, as in Pane/Collab/CollabCrypto.swift.
// See docs/Technical/collaboration-design.md.
//
// Each account has an identity key pair (P-256). The private half is the 32-byte scalar, sealed
// under the account's data key as an amb2 box with context "identity:<user id>".
//
// A shared note has a note key (NK, 32 random bytes) per epoch. Formats:
//
//   amb3k.<b64 eph pub(65) ‖ nonce(12) ‖ ct ‖ tag>   NK sealed from one member to another.
//         key  HKDF-SHA256(ECDH(eph, to) ‖ ECDH(from identity, to), salt "amber-notes/e2ee",
//              info "notekey <note> <epoch> <from> <to>"), AAD "amb3k|<note>|<epoch>|<from>|<to>".
//         The second ECDH proves who sealed it: a server can't hand you a key of its own.
//   amb3u.<epoch>.<b64 nonce ‖ ct ‖ tag>   an Automerge change, AAD "amb3u|<note>|<epoch>|<author>"
//   amb3s.<epoch>.<b64 …>                  a snapshot (Automerge save), AAD "amb3s|<note>|<epoch>|<upto>"
//   amb3p.<epoch>.<b64 …>                  presence JSON, AAD "amb3p|<note>|<epoch>|<user>"
//   amb3h.<epoch>.<b64 …>                  the head JSON {title, preview}, AAD "amb3h|<note>|<epoch>"
//   self wrap: an amb2 box of base64(NK) under the member's data key, context "notekey:<note>:<epoch>"
import { type Bytes, fromBase64, OpenError, toBase64 } from "./e2ee.ts";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const SALT = enc.encode("amber-notes/e2ee");
const lower = (s: string) => s.toLowerCase();

export const identityContext = (user: string) => `identity:${lower(user)}`;
export const noteKeyContext = (note: string, epoch: number) => `notekey:${lower(note)}:${epoch}`;

export type Identity = { privateKey: CryptoKey; publicRaw: Bytes };

/** An identity from its stored scalar and public point. */
export async function importIdentity(d: Bytes, publicRaw: Bytes): Promise<Identity> {
  const b64u = (b: Uint8Array) => toBase64(b).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const jwk = { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(publicRaw.subarray(1, 33)), y: b64u(publicRaw.subarray(33, 65)), ext: false };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { privateKey, publicRaw };
}

export async function newIdentity(): Promise<Identity & { d: Bytes }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const d = fromBase64(jwk.d!.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - jwk.d!.length % 4) % 4));
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicRaw, d };
}

const ecdhPublic = (raw: Bytes) => crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
const ecdh = async (priv: CryptoKey, pub: Bytes) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await ecdhPublic(pub) }, priv, 256));

async function wrapKey(ephShared: Uint8Array, staticShared: Uint8Array, info: string): Promise<CryptoKey> {
  const ikm = new Uint8Array(64);
  ikm.set(ephShared);
  ikm.set(staticShared, 32);
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export type WrapParty = { note: string; epoch: number; from: string; to: string };
const wrapInfo = (p: WrapParty) => `notekey ${lower(p.note)} ${p.epoch} ${lower(p.from)} ${lower(p.to)}`;
const wrapAAD = (p: WrapParty) => enc.encode(`amb3k|${lower(p.note)}|${p.epoch}|${lower(p.from)}|${lower(p.to)}`);

/** NK sealed from `sender` to the member whose identity public key is `toPublic`. */
export async function sealNoteKey(nk: Bytes, sender: Identity, toPublic: Bytes, p: WrapParty): Promise<string> {
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const key = await wrapKey(await ecdh(eph.privateKey, toPublic), await ecdh(sender.privateKey, toPublic), wrapInfo(p));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: wrapAAD(p) }, key, nk));
  const ephRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const out = new Uint8Array(65 + 12 + ct.length);
  out.set(ephRaw);
  out.set(iv, 65);
  out.set(ct, 77);
  return `amb3k.${toBase64(out)}`;
}

/** Opens a wrap made for `me`, checking it was sealed by the member whose public key is `fromPublic`. */
export async function openNoteKey(sealed: string, me: Identity, fromPublic: Bytes, p: WrapParty): Promise<Bytes> {
  const m = /^amb3k\.([A-Za-z0-9+/]+={0,2})$/.exec(sealed);
  if (!m) throw new OpenError("not a note key wrap");
  const b = fromBase64(m[1]);
  if (b.length !== 65 + 12 + 32 + 16) throw new OpenError("note key wrap has the wrong length");
  const key = await wrapKey(await ecdh(me.privateKey, b.subarray(0, 65)), await ecdh(me.privateKey, fromPublic), wrapInfo(p));
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(65, 77), additionalData: wrapAAD(p) }, key, b.subarray(77)));
  } catch {
    throw new OpenError("note key wrap doesn't open");
  }
}

export type Kind = "u" | "s" | "p" | "h";
const BOX3 = /^amb3([usph])\.(\d+)\.([A-Za-z0-9+/]+={0,2})$/;
const aad3 = (kind: Kind, note: string, epoch: number, extra?: string) =>
  enc.encode(`amb3${kind}|${lower(note)}|${epoch}${extra === undefined ? "" : `|${lower(extra)}`}`);

/** A note-key box: an update (`extra` = author id), snapshot (upto), presence (user id) or head. */
export async function seal3(kind: Kind, data: Bytes, nk: Bytes, note: string, epoch: number, extra?: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", nk, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad3(kind, note, epoch, extra) }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return `amb3${kind}.${epoch}.${toBase64(out)}`;
}

export async function open3(kind: Kind, sealed: string, nk: Bytes, note: string, extra?: string): Promise<Bytes> {
  const m = BOX3.exec(sealed);
  if (!m || m[1] !== kind) throw new OpenError("not a note box");
  const epoch = Number(m[2]);
  const b = fromBase64(m[3]);
  const key = await crypto.subtle.importKey("raw", nk, "AES-GCM", false, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12), additionalData: aad3(kind, note, epoch, extra) }, key, b.subarray(12)));
  } catch {
    throw new OpenError("note box doesn't open");
  }
}

export const epochOf = (sealed: string) => Number(BOX3.exec(sealed)?.[2] ?? NaN);
export const text = (b: Bytes) => dec.decode(b);
export const bytes = (s: string) => enc.encode(s) as Bytes;

/** The safety code two people can compare: 12 digits from both public keys, the same on both sides. */
export async function safetyCode(a: Bytes, b: Bytes): Promise<string> {
  const [x, y] = toBase64(a) < toBase64(b) ? [a, b] : [b, a];
  const joined = new Uint8Array(enc.encode("amber-notes safety v1").length + 130);
  joined.set(enc.encode("amber-notes safety v1"));
  joined.set(x, 21);
  joined.set(y, 86);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  const groups = [0, 1, 2].map((i) => (((d[i * 4] << 24) | (d[i * 4 + 1] << 16) | (d[i * 4 + 2] << 8) | d[i * 4 + 3]) >>> 0) % 10000);
  return groups.map((g) => String(g).padStart(4, "0")).join(" ");
}

/** Invite links: the fragment secret gives the value the server checks and the key NK is sealed under. */
export async function linkKeys(secret: Bytes, link: string): Promise<{ answer: string; key: CryptoKey }> {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits", "deriveKey"]);
  const answer = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`invite answer ${lower(link)}`) }, base, 256));
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(`invite key ${lower(link)}`) }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { answer: Array.from(answer, (x) => x.toString(16).padStart(2, "0")).join(""), key };
}
