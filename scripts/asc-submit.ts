// Prepares an App Store submission through the App Store Connect API, step by step.
//
//   deno run -A scripts/asc-submit.ts <step> [args] [--apply] [--package <dir>] [--video <file>]
//
// Every step is a dry run unless --apply is given, and can be run again safely.
//
//   state                      versions, review submissions, app info, screenshots, review details, builds
//   backup                     saves the current listing texts to <package>/ASC-PREVIOUS-TEXTS.json (once)
//   unsubmit <platform>        cancels the open review submission of a platform and waits until it is editable
//   version <platform> <v>     version number, copyright, manual release
//   appinfo                    name (with fallback), subtitle, categories; checks content rights and age rating
//   texts <platform>           description, keywords, promotional text, URLs (What's New when the field exists)
//   screenshots <platform>     replaces the iPhone or Mac screenshot sets with the package's files;
//                              with --ipad <dir> (in the package, or absolute) the iPad set too
//   review <platform>          App Review contact, demo account, notes (recovery key filled in), video attachment
//   build <platform> <build>   selects a build for the version
//   submit <platform> <build>  selects the build, adds the version to a review submission and SUBMITS it.
//                              Needs --apply and --submit-for-review, and for ios --ipad <dir>.
//
// <platform> is ios or mac. Run from a checkout that has .secrets/asc.env, the .p8 key and
// .secrets/appreview.txt (lines "Email:", "Password:", "Recovery key:"). The demo account values
// go to Apple only: nothing this script prints or logs contains them.
// The package (METADATA.md, REVIEW-NOTES.md, screenshots/) is --package or $ASC_PACKAGE.

const APP_ID = "6817253103";
const API = "https://api.appstoreconnect.apple.com";
const NAME_FALLBACK = "Pinto Notes: AI Notes & Lists";
const EDITABLE = ["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"];

const argv = [...Deno.args];
function flag(name: string) { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; }
function option(name: string) { const i = argv.indexOf(name); if (i < 0) return undefined; return argv.splice(i, 2)[1]; }
const APPLY = flag("--apply");
const SUBMIT_OK = flag("--submit-for-review");
const PKG = option("--package") ?? Deno.env.get("ASC_PACKAGE") ?? "";
const VIDEO = option("--video") ?? Deno.env.get("ASC_REVIEW_VIDEO") ?? "";
const IPAD = option("--ipad") ?? Deno.env.get("ASC_IPAD_SHOTS") ?? "";
const [step, arg1, arg2] = argv;

const env: Record<string, string> = {};
for (const line of (await Deno.readTextFile(".secrets/asc.env")).split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const keyId = env.ASC_KEY_ID, issuer = env.ASC_ISSUER_ID;
if (!keyId || !issuer) throw new Error(".secrets/asc.env needs ASC_KEY_ID and ASC_ISSUER_ID");
const pem = await Deno.readTextFile(`.secrets/AuthKey_${keyId}.p8`);

// ES256 JWT, valid 15 minutes.
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
let jwt = "", jwtAt = 0;
async function token() {
  const now = Math.floor(Date.now() / 1000);
  if (jwt && now - jwtAt < 600) return jwt;
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ iss: issuer, iat: now, exp: now + 900, aud: "appstoreconnect-v1" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  jwt = `${head}.${body}.${b64url(sig)}`;
  jwtAt = now;
  return jwt;
}

// Everything printed or logged passes through redact(), so a registered secret never leaves the process
// except inside a request body to Apple.
const secrets = new Set<string>([keyId, issuer]);
function redact(s: string) {
  let out = s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]");
  for (const x of secrets) out = out.split(x).join("[redacted]");
  return out;
}
function say(s: string) { console.log(redact(s)); }
const changes: string[] = [];
/** A change: printed, and written to the package's ASC-LOG.md when applied. */
function change(s: string) { say(`${APPLY ? "✓" : "would:"} ${s}`); if (APPLY) changes.push(redact(s)); }
async function flushLog() {
  if (!changes.length || !PKG) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  await Deno.writeTextFile(`${PKG}/ASC-LOG.md`, `\n### ${stamp}: ${step}${arg1 ? " " + arg1 : ""}\n\n${changes.map((c) => `- ${c}`).join("\n")}\n`, { append: true });
}

// deno-lint-ignore no-explicit-any
type J = any;
async function call(method: string, path: string, body?: J): Promise<J> {
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let brief = text.slice(0, 900);
    try { brief = (JSON.parse(text).errors ?? []).map((e: J) => `${e.code}: ${e.detail}`).join(" | "); } catch { /* not JSON */ }
    throw new Error(redact(`${method} ${path.split("?")[0]} → ${res.status}: ${brief}`));
  }
  return text ? JSON.parse(text) : {};
}
const get = (p: string) => call("GET", p);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const brief = (s: string | null | undefined) => s == null ? "empty" : `${s.length} chars`;

function platformOf(p: string | undefined) {
  if (p === "ios") return "IOS";
  if (p === "mac") return "MAC_OS";
  throw new Error("platform must be ios or mac");
}
function needPackage() { if (!PKG) throw new Error("pass --package <dir> or set ASC_PACKAGE"); return PKG; }

async function versions() { return (await get(`/v1/apps/${APP_ID}/appStoreVersions?limit=20&include=build`)).data as J[]; }
/** The version being worked on for a platform: the newest one that is not live. */
async function versionOf(platform: string) {
  const v = (await versions()).filter((x) => x.attributes.platform === platform && x.attributes.appStoreState !== "READY_FOR_SALE")
    .sort((x, y) => y.attributes.createdDate.localeCompare(x.attributes.createdDate))[0];
  if (!v) throw new Error(`no ${platform} version in preparation`);
  return v;
}
function mustBeEditable(v: J) {
  if (!EDITABLE.includes(v.attributes.appStoreState)) throw new Error(`${v.attributes.platform} ${v.attributes.versionString} is ${v.attributes.appStoreState}, not editable`);
}
async function localization(versionId: string) {
  const l = ((await get(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`)).data as J[]).find((x) => x.attributes.locale === "en-US");
  if (!l) throw new Error("the version has no en-US localization");
  return l;
}
async function buildOf(platform: string, number: string) {
  const r = await get(`/v1/builds?filter[app]=${APP_ID}&filter[version]=${number}&include=preReleaseVersion&limit=10`);
  const pre = new Map((r.included ?? []).map((i: J) => [i.id, i.attributes]));
  const b = (r.data as J[]).find((x) => (pre.get(x.relationships?.preReleaseVersion?.data?.id) as J)?.platform === platform);
  if (!b) throw new Error(`no ${platform} build ${number}`);
  const marketing = (pre.get(b.relationships.preReleaseVersion.data.id) as J).version;
  if (b.attributes.processingState !== "VALID" || b.attributes.expired) throw new Error(`build ${number} is ${b.attributes.processingState}${b.attributes.expired ? ", expired" : ""}`);
  return { id: b.id as string, marketing: marketing as string, usesNonExemptEncryption: b.attributes.usesNonExemptEncryption };
}

// ── The package ──────────────────────────────────────────────────────────────────────────────────

/** The part of METADATA.md for a platform, and the first fenced block after a bold label in it. */
type Listing = { description: string; keywords: string; promotionalText: string; supportUrl: string; marketingUrl: string; whatsNew: string };
async function metadata(platform: string): Promise<Listing> {
  const text = await Deno.readTextFile(`${needPackage()}/METADATA.md`);
  const start = text.indexOf(platform === "IOS" ? "\n## iPhone and iPad" : "\n## Mac, version");
  const end = text.indexOf("\n## ", start + 4);
  if (start < 0) throw new Error("METADATA.md has no section for " + platform);
  const part = text.slice(start, end < 0 ? undefined : end);
  const block = (label: string) => {
    const m = part.match(new RegExp(`\\*\\*${label}:?\\*\\*[^\\n]*\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
    if (!m) throw new Error(`METADATA.md has no ${label} block for ${platform}`);
    return m[1];
  };
  const line = (label: string) => {
    const m = part.match(new RegExp(`\\*\\*${label}:\\*\\* (\\S+)`));
    if (!m) throw new Error(`METADATA.md has no ${label} for ${platform}`);
    return m[1];
  };
  const whatsNew: string = part.includes("**What's New**") ? block("What's New") : (await metadata("IOS")).whatsNew;
  return { description: block("Description"), keywords: block("Keywords"), promotionalText: block("Promotional text"),
    supportUrl: line("Support URL"), marketingUrl: line("Marketing URL"), whatsNew };
}
async function appInfoValues() {
  const text = await Deno.readTextFile(`${needPackage()}/METADATA.md`);
  const row = (label: string) => {
    const m = text.match(new RegExp(`\\| ${label} \\| ([^|]+) \\|`));
    if (!m) throw new Error(`METADATA.md has no ${label} row`);
    return m[1].trim();
  };
  return { name: row("Name"), subtitle: row("Subtitle"), primary: row("Primary category").toUpperCase(), secondary: row("Secondary category").toUpperCase(),
    copyright: row("Copyright"), contactEmail: row("Email") };
}
async function reviewNotes(platform: string) {
  const text = await Deno.readTextFile(`${needPackage()}/REVIEW-NOTES.md`);
  const start = text.indexOf(platform === "IOS" ? "\n## 1. iPhone" : "\n## 3. Mac");
  const m = start < 0 ? null : text.slice(start).match(/```\n([\s\S]*?)\n```/);
  if (!m) throw new Error("REVIEW-NOTES.md has no notes block for " + platform);
  return m[1];
}
/** The demo account. Read here, sent to Apple, never printed. */
async function demoAccount() {
  const text = await Deno.readTextFile(".secrets/appreview.txt");
  const value = (label: string) => {
    const m = text.match(new RegExp(`^${label}:[ \\t]*(.+?)[ \\t]*$`, "m"));
    if (!m) throw new Error(`.secrets/appreview.txt has no "${label}:" line`);
    secrets.add(m[1]);
    return m[1];
  };
  return { email: value("Email"), password: value("Password"), recoveryKey: value("Recovery key") };
}

// ── Steps ────────────────────────────────────────────────────────────────────────────────────────

async function state() {
  const app = (await get(`/v1/apps/${APP_ID}`)).data;
  say(`App "${app.attributes.name}" ${app.attributes.bundleId}, content rights ${app.attributes.contentRightsDeclaration}`);
  for (const v of await versions()) {
    const a = v.attributes;
    say(`\n${a.platform} ${a.versionString}: ${a.appStoreState}, release ${a.releaseType}, copyright "${a.copyright}", build ${v.relationships?.build?.data?.id ?? "none"}`);
    for (const l of (await get(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data as J[]) {
      const la = l.attributes;
      say(`  ${la.locale}: description ${brief(la.description)}, keywords ${brief(la.keywords)}, promotional ${brief(la.promotionalText)}, what's new ${brief(la.whatsNew)}, ${la.supportUrl}, ${la.marketingUrl}`);
      const sets = await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots&limit=50`);
      const inc = new Map((sets.included ?? []).map((i: J) => [i.id, i]));
      for (const s of sets.data as J[]) {
        const shots = (s.relationships?.appScreenshots?.data ?? []).map((d: J) => inc.get(d.id)) as J[];
        say(`    ${s.attributes.screenshotDisplayType}: ` + shots.map((x) => `${x?.attributes.fileName} ${x?.attributes.imageAsset?.width}x${x?.attributes.imageAsset?.height} ${x?.attributes.assetDeliveryState?.state}`).join(", "));
      }
    }
    const rd = await get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail?include=appStoreReviewAttachments`).catch(() => null);
    if (!rd?.data) { say("  review detail: none"); continue; }
    const ra = rd.data.attributes;
    say("  review detail: " + Object.entries(ra).map(([k, x]) => `${k} ${x == null || x === "" ? "empty" : typeof x === "boolean" ? x : `set (${String(x).length})`}`).join(", "));
    say(`    notes contain "[RECOVERY KEY]": ${String(ra.notes ?? "").includes("[RECOVERY KEY]")}; mention "Amber Notes 1.1.2" or old text: ${!String(ra.notes ?? "").startsWith("Pinto Notes 1.2")}`);
    for (const at of rd.included ?? []) say(`    attachment ${at.attributes.fileName}, ${at.attributes.fileSize} bytes, ${at.attributes.assetDeliveryState?.state}`);
  }
  say("\nReview submissions");
  for (const s of (await get(`/v1/reviewSubmissions?filter[app]=${APP_ID}&limit=50`)).data as J[]) {
    const items = (await get(`/v1/reviewSubmissions/${s.id}/items`)).data as J[];
    say(`  ${s.attributes.platform} ${s.attributes.state}, submitted ${s.attributes.submittedDate ?? "never"}, ${items.length} item(s) ${items.map((i) => i.attributes.state).join(" ")}`);
  }
  const infos = await get(`/v1/apps/${APP_ID}/appInfos?include=appInfoLocalizations,primaryCategory,secondaryCategory`);
  say("\nApp info");
  for (const i of infos.data as J[]) say(`  ${i.attributes.state ?? i.attributes.appStoreState}, age rating ${i.attributes.appStoreAgeRating}, categories ${i.relationships?.primaryCategory?.data?.id} / ${i.relationships?.secondaryCategory?.data?.id ?? "none"}`);
  for (const l of (infos.included ?? []).filter((x: J) => x.type === "appInfoLocalizations")) say(`  ${l.attributes.locale}: "${l.attributes.name}", "${l.attributes.subtitle}", privacy ${l.attributes.privacyPolicyUrl}`);
  say("\nBuilds");
  const bs = await get(`/v1/builds?filter[app]=${APP_ID}&include=preReleaseVersion&limit=10&sort=-uploadedDate`);
  const pre = new Map((bs.included ?? []).map((i: J) => [i.id, i.attributes]));
  for (const b of bs.data as J[]) { const p = pre.get(b.relationships?.preReleaseVersion?.data?.id) as J; say(`  ${b.attributes.version} ${p?.platform} ${p?.version} ${b.attributes.processingState}${b.attributes.expired ? " expired" : ""}, uses non-exempt encryption: ${b.attributes.usesNonExemptEncryption}`); }
}

/** The listing texts as they are now, so they can be put back. The review notes are left out: they hold the recovery key. */
async function backup() {
  const path = `${needPackage()}/ASC-PREVIOUS-TEXTS.json`;
  if (await Deno.stat(path).then(() => true).catch(() => false)) { say(`${path} exists, kept as it is`); return; }
  const out: J = { savedAt: new Date().toISOString(), note: "Listing texts before the 1.2 changes. Review notes and the demo account are not saved here.", versions: [] };
  const infos = await get(`/v1/apps/${APP_ID}/appInfos?include=appInfoLocalizations`);
  out.appInfo = { categories: (infos.data as J[]).map((i) => ({ primary: i.relationships?.primaryCategory?.data?.id ?? null, secondary: i.relationships?.secondaryCategory?.data?.id ?? null })),
    localizations: (infos.included ?? []).map((l: J) => l.attributes) };
  for (const v of await versions()) {
    const locs = (await get(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).data as J[];
    const rd = await get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`).catch(() => null);
    const sets = [];
    for (const l of locs) for (const s of (await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots&limit=50`).then((r) => r.data.map((d: J) => ({ d, inc: r.included ?? [] })))) as J[]) {
      sets.push({ type: s.d.attributes.screenshotDisplayType, files: (s.d.relationships?.appScreenshots?.data ?? []).map((x: J) => s.inc.find((i: J) => i.id === x.id)?.attributes.fileName) });
    }
    out.versions.push({ platform: v.attributes.platform, versionString: v.attributes.versionString, state: v.attributes.appStoreState, copyright: v.attributes.copyright,
      releaseType: v.attributes.releaseType, build: v.relationships?.build?.data?.id ?? null, localizations: locs.map((l) => l.attributes), screenshotSets: sets,
      reviewContactEmail: rd?.data?.attributes?.contactEmail ?? null, reviewNotesLength: (rd?.data?.attributes?.notes ?? "").length });
  }
  if (!APPLY) { say(`would: save the current texts to ${path}`); return; }
  await Deno.writeTextFile(path, JSON.stringify(out, null, 2) + "\n");
  change(`Saved the texts as they were to ASC-PREVIOUS-TEXTS.json`);
}

async function unsubmit(platform: string) {
  const open = ((await get(`/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=${platform}&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,CANCELING&limit=10`)).data as J[]);
  const v = await versionOf(platform);
  if (!open.length) { say(`No open ${platform} review submission. ${v.attributes.versionString} is ${v.attributes.appStoreState}.`); return; }
  for (const s of open) {
    if (s.attributes.state === "CANCELING") { say(`submission is already CANCELING`); continue; }
    if (APPLY) await call("PATCH", `/v1/reviewSubmissions/${s.id}`, { data: { type: "reviewSubmissions", id: s.id, attributes: { canceled: true } } });
    change(`Canceled the ${platform} review submission of ${s.attributes.submittedDate} (was ${s.attributes.state}); ${v.attributes.versionString} leaves the review queue`);
  }
  if (!APPLY) return;
  for (let i = 0; i < 60; i++) {
    const now = await versionOf(platform);
    if (EDITABLE.includes(now.attributes.appStoreState)) { change(`${platform} ${now.attributes.versionString} is now ${now.attributes.appStoreState} (editable)`); return; }
    if (i % 3 === 0) say(`  waiting: ${now.attributes.appStoreState}`);
    await sleep(20_000);
  }
  throw new Error("still not editable after 20 minutes");
}

async function setVersion(platform: string, want: string) {
  const v = await versionOf(platform);
  mustBeEditable(v);
  const { copyright } = await appInfoValues();
  const attrs: J = {};
  if (v.attributes.versionString !== want) attrs.versionString = want;
  if (v.attributes.copyright !== copyright) attrs.copyright = copyright;
  if (v.attributes.releaseType !== "MANUAL") attrs.releaseType = "MANUAL";
  if (!Object.keys(attrs).length) { say(`${platform}: version ${want}, copyright and manual release already set`); return; }
  if (APPLY) await call("PATCH", `/v1/appStoreVersions/${v.id}`, { data: { type: "appStoreVersions", id: v.id, attributes: attrs } });
  change(`${platform} version: ${Object.entries(attrs).map(([k, x]) => `${k} "${v.attributes[k]}" → "${x}"`).join(", ")}`);
}

async function appInfo() {
  const want = await appInfoValues();
  const infos = await get(`/v1/apps/${APP_ID}/appInfos?include=appInfoLocalizations,primaryCategory,secondaryCategory`);
  const info = (infos.data as J[]).find((i) => EDITABLE.includes(i.attributes.state ?? i.attributes.appStoreState));
  if (!info) throw new Error(`no editable app info (states: ${(infos.data as J[]).map((i) => i.attributes.state).join(", ")})`);
  const loc = ((await get(`/v1/appInfos/${info.id}/appInfoLocalizations`)).data as J[]).find((l) => l.attributes.locale === "en-US");
  if (!loc) throw new Error("app info has no en-US localization");
  if (loc.attributes.subtitle !== want.subtitle) {
    if (APPLY) await call("PATCH", `/v1/appInfoLocalizations/${loc.id}`, { data: { type: "appInfoLocalizations", id: loc.id, attributes: { subtitle: want.subtitle } } });
    change(`Subtitle "${loc.attributes.subtitle}" → "${want.subtitle}"`);
  } else say("Subtitle already set");
  if (loc.attributes.name !== want.name && loc.attributes.name !== NAME_FALLBACK) {
    let used = want.name;
    if (APPLY) {
      try { await call("PATCH", `/v1/appInfoLocalizations/${loc.id}`, { data: { type: "appInfoLocalizations", id: loc.id, attributes: { name: want.name } } }); }
      catch (e) {
        say(`! Name "${want.name}" refused: ${(e as Error).message}`);
        used = NAME_FALLBACK;
        await call("PATCH", `/v1/appInfoLocalizations/${loc.id}`, { data: { type: "appInfoLocalizations", id: loc.id, attributes: { name: NAME_FALLBACK } } });
      }
    }
    change(`Name "${loc.attributes.name}" → "${used}"${used === want.name ? "" : " (the fallback; the first choice was refused)"}`);
  } else say(`Name already "${loc.attributes.name}"`);
  const rel: J = {};
  if (info.relationships?.primaryCategory?.data?.id !== want.primary) rel.primaryCategory = { data: { type: "appCategories", id: want.primary } };
  if (info.relationships?.secondaryCategory?.data?.id !== want.secondary) rel.secondaryCategory = { data: { type: "appCategories", id: want.secondary } };
  if (Object.keys(rel).length) {
    if (APPLY) await call("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: rel } });
    change(`Categories: ${Object.entries(rel).map(([k, x]) => `${k} ${info.relationships?.[k]?.data?.id ?? "none"} → ${(x as J).data.id}`).join(", ")}`);
  } else say("Categories already set");
  // Read-only checks: these already hold the package's answers, and are reported when they do not.
  const app = (await get(`/v1/apps/${APP_ID}`)).data;
  say(`Content rights: ${app.attributes.contentRightsDeclaration} ${app.attributes.contentRightsDeclaration === "DOES_NOT_USE_THIRD_PARTY_CONTENT" ? "(as the package says)" : "(! DIFFERS from the package)"}`);
  const age = (await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).data.attributes;
  const odd = Object.entries(age).filter(([k, x]) => !(x === null || x === false || x === "NONE" || (k === "userGeneratedContent" && x === true)));
  say(`Age rating ${info.attributes.appStoreAgeRating}: ${odd.length ? "! DIFFERS from the package: " + odd.map(([k, x]) => `${k}=${x}`).join(", ") : "answers as the package says (user-generated content yes, everything else no or none)"}`);
  say(`Privacy policy URL (not touched): ${loc.attributes.privacyPolicyUrl}`);
}

async function texts(platform: string) {
  const v = await versionOf(platform);
  mustBeEditable(v);
  const want = await metadata(platform);
  const loc = await localization(v.id);
  const attrs: J = {};
  for (const k of ["description", "keywords", "promotionalText", "supportUrl", "marketingUrl"] as const) if (loc.attributes[k] !== want[k]) attrs[k] = want[k];
  // A first version has no What's New; Apple refuses the field until one version has been released.
  const released = (await versions()).some((x) => x.attributes.platform === platform && x.attributes.appStoreState === "READY_FOR_SALE");
  if (released && loc.attributes.whatsNew !== want.whatsNew) attrs.whatsNew = want.whatsNew;
  if (!released) say(`${platform}: no What's New field (no released version yet)`);
  const limits: Record<string, number> = { description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000 };
  for (const [k, x] of Object.entries(attrs)) if (limits[k] && (x as string).length > limits[k]) throw new Error(`${k} is ${(x as string).length} characters, limit ${limits[k]}`);
  if (!Object.keys(attrs).length) { say(`${platform}: texts and URLs already set`); return; }
  if (APPLY) await call("PATCH", `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: "appStoreVersionLocalizations", id: loc.id, attributes: attrs } });
  for (const [k, x] of Object.entries(attrs)) change(`${platform} ${k}: ${k.endsWith("Url") ? `${loc.attributes[k]} → ${x}` : `${brief(loc.attributes[k])} → ${brief(x as string)}`}`);
}

async function md5(path: string) {
  return new TextDecoder().decode((await new Deno.Command("md5", { args: ["-q", path] }).output()).stdout).trim();
}
async function upload(ops: J[], bytes: Uint8Array, name: string) {
  for (const op of ops) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h: J) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.slice(op.offset, op.offset + op.length) });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`upload of ${name} → ${res.status}`);
  }
}
async function delivered(path: string, name: string) {
  for (let i = 0; i < 90; i++) {
    const st = (await get(path)).data.attributes.assetDeliveryState;
    if (st?.state === "COMPLETE") return;
    if (st?.state === "FAILED") throw new Error(`${name}: processing failed: ${JSON.stringify(st.errors ?? [])}`);
    await sleep(4000);
  }
  throw new Error(`${name}: still processing after 6 minutes`);
}

// Which folders of the package fill which screenshot sets, and which old sets are emptied.
const SHOTS: Record<string, { sets: [string, string][]; remove: string[] }> = {
  IOS: { sets: [["APP_IPHONE_67", "screenshots/iphone-captioned/6.9-inch-1320x2868"], ["APP_IPHONE_61", "screenshots/iphone-captioned/6.3-inch-1206x2622"]], remove: ["APP_IPHONE_65"] },
  MAC_OS: { sets: [["APP_DESKTOP", "screenshots/mac/1440x900-captioned"]], remove: [] },
};
if (IPAD) SHOTS.IOS.sets.push(["APP_IPAD_PRO_3GEN_129", IPAD]);
const shotFolder = (dir: string) => dir.startsWith("/") ? dir : `${needPackage()}/${dir}`;
async function shotFiles(dir: string) {
  const files = [...Deno.readDirSync(shotFolder(dir))].map((e) => e.name).filter((n) => /^\d+-.*\.png$/.test(n)).sort(); // numbered frames only, not contact sheets
  if (!files.length) throw new Error(`no screenshots in ${shotFolder(dir)}`);
  return { files, sums: await Promise.all(files.map((n) => md5(`${shotFolder(dir)}/${n}`))) };
}
async function screenshots(platform: string) {
  const v = await versionOf(platform);
  mustBeEditable(v);
  const loc = await localization(v.id);
  const read = async () => {
    const r = await get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`);
    const inc = new Map((r.included ?? []).map((i: J) => [i.id, i]));
    return (r.data as J[]).map((s) => ({ id: s.id as string, type: s.attributes.screenshotDisplayType as string, shots: (s.relationships?.appScreenshots?.data ?? []).map((d: J) => inc.get(d.id)) as J[] }));
  };
  let sets = await read();
  for (const [type, dir] of SHOTS[platform].sets) {
    const folder = shotFolder(dir);
    const { files, sums } = await shotFiles(dir);
    let set = sets.find((s) => s.type === type);
    const same = set && set.shots.length === files.length && set.shots.every((x, i) => x.attributes.fileName === files[i] && x.attributes.sourceFileChecksum === sums[i] && x.attributes.assetDeliveryState?.state === "COMPLETE");
    if (same) { say(`${platform} ${type}: already the ${files.length} files of ${dir}, in order`); continue; }
    if (!APPLY) { change(`${platform} ${type}: delete ${set?.shots.length ?? 0} old (${set?.shots.map((x) => x.attributes.fileName).join(", ") ?? "no set yet"}), upload ${files.join(", ")}`); continue; }
    if (!set) {
      const made = (await call("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: type },
        relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } })).data;
      set = { id: made.id, type, shots: [] };
    }
    const old = set.shots.map((x) => x.attributes.fileName);
    for (const x of set.shots) await call("DELETE", `/v1/appScreenshots/${x.id}`);
    const ids: string[] = [];
    for (const [i, name] of files.entries()) {
      const bytes = await Deno.readFile(`${folder}/${name}`);
      const shot = (await call("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: name, fileSize: bytes.length },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } })).data;
      await upload(shot.attributes.uploadOperations, bytes, name);
      await call("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: sums[i] } } });
      ids.push(shot.id);
    }
    for (const [i, id] of ids.entries()) await delivered(`/v1/appScreenshots/${id}`, files[i]);
    await call("PATCH", `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: "appScreenshots", id })) });
    const after = (await read()).find((s) => s.id === set!.id)!;
    const got = after.shots.map((x) => `${x.attributes.fileName} ${x.attributes.imageAsset?.width}x${x.attributes.imageAsset?.height}`);
    if (after.shots.length !== files.length || after.shots.some((x, i) => x.attributes.fileName !== files[i])) throw new Error(`${type}: read back ${got.join(", ")}, expected ${files.join(", ")}`);
    change(`${platform} ${type}: deleted ${old.length} old (${old.join(", ") || "none"}); uploaded and verified in order: ${got.join(", ")}`);
  }
  sets = await read();
  for (const type of SHOTS[platform].remove) {
    const set = sets.find((s) => s.type === type);
    if (!set) { say(`${platform} ${type}: no such set (already removed)`); continue; }
    if (APPLY) await call("DELETE", `/v1/appScreenshotSets/${set.id}`);
    change(`${platform} ${type}: removed the old set and its ${set.shots.length} screenshots (${set.shots.map((x) => x.attributes.fileName).join(", ")})`);
  }
  for (const s of sets.filter((x) => !SHOTS[platform].sets.some(([t]) => t === x.type) && !SHOTS[platform].remove.includes(x.type))) {
    say(`${platform} ${s.type}: left as it is (${s.shots.map((x) => x.attributes.fileName).join(", ")})`);
  }
}

async function review(platform: string) {
  const v = await versionOf(platform);
  mustBeEditable(v);
  const demo = await demoAccount();
  const template = await reviewNotes(platform);
  if (!template.includes("[RECOVERY KEY]")) throw new Error("the notes text has no [RECOVERY KEY] placeholder");
  const notes = template.split("[RECOVERY KEY]").join(demo.recoveryKey);
  if (notes.length >= 4000) throw new Error(`the notes are ${notes.length} characters with the key, limit 4,000`);
  if (/\[[A-Z ]+\]/.test(notes)) throw new Error("the notes still contain a [PLACEHOLDER]");
  const { contactEmail } = await appInfoValues();
  const want: J = { contactFirstName: "Emil", contactLastName: "Wagman", contactEmail, demoAccountRequired: true, demoAccountName: demo.email, demoAccountPassword: demo.password, notes };
  let rd = (await get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail?include=appStoreReviewAttachments`).catch(() => ({ data: null })));
  const had = rd.data?.attributes ?? {};
  const differs = Object.keys(want).filter((k) => had[k] !== want[k]);
  if (!differs.length) say(`${platform}: App Review contact, demo account and notes already set`);
  else {
    if (APPLY) {
      if (rd.data) await call("PATCH", `/v1/appStoreReviewDetails/${rd.data.id}`, { data: { type: "appStoreReviewDetails", id: rd.data.id, attributes: want } });
      else await call("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: want, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
    }
    const safe = (k: string) => k === "contactEmail" ? `${had[k]} → ${want[k]}` : k === "demoAccountRequired" ? `${had[k]} → true` : `${brief(had[k])} → ${brief(String(want[k]))}`;
    change(`${platform} App Review detail: ${differs.map((k) => `${k} ${safe(k)}`).join("; ")} (contact phone untouched)`);
  }
  if (APPLY) {
    rd = await get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail?include=appStoreReviewAttachments`);
    const a = rd.data.attributes;
    say(`  read back: user name ${a.demoAccountName === demo.email ? "matches the file" : "! DIFFERS"} (${(a.demoAccountName ?? "").length}), password ${a.demoAccountPassword === demo.password ? "matches the file" : "! DIFFERS"} (${(a.demoAccountPassword ?? "").length}), sign-in required ${a.demoAccountRequired}, notes ${(a.notes ?? "").length} characters, contain "[RECOVERY KEY]": ${(a.notes ?? "").includes("[RECOVERY KEY]")}, contain the key: ${(a.notes ?? "").includes(demo.recoveryKey)}, contact ${a.contactFirstName} ${a.contactLastName} ${a.contactEmail}, phone ${a.contactPhone ? "set" : "empty"}`);
    if (a.notes !== notes || a.demoAccountName !== demo.email || a.demoAccountPassword !== demo.password) throw new Error("the review detail read back differs from what was sent");
  } else say(`  the notes would be ${notes.length} characters with the key filled in`);

  // The screen recording, attached once (same name and size counts as the same file).
  if (!VIDEO) { say("  no --video given: attachment not checked"); return; }
  const name = VIDEO.split("/").pop()!;
  const size = (await Deno.stat(VIDEO)).size;
  const attached = (rd.included ?? []).filter((x: J) => x.type === "appStoreReviewAttachments") as J[];
  if (attached.some((x) => x.attributes.fileName === name && x.attributes.fileSize === size && x.attributes.assetDeliveryState?.state === "COMPLETE")) { say(`  attachment ${name} already there`); return; }
  if (!APPLY) { change(`${platform} App Review attachment: upload ${name} (${size} bytes); now attached: ${attached.map((x) => x.attributes.fileName).join(", ") || "nothing"}`); return; }
  if (!rd.data) throw new Error("no review detail to attach to");
  for (const x of attached.filter((x) => x.attributes.fileName === name)) await call("DELETE", `/v1/appStoreReviewAttachments/${x.id}`);
  const bytes = await Deno.readFile(VIDEO);
  const att = (await call("POST", "/v1/appStoreReviewAttachments", { data: { type: "appStoreReviewAttachments", attributes: { fileName: name, fileSize: size },
    relationships: { appStoreReviewDetail: { data: { type: "appStoreReviewDetails", id: rd.data.id } } } } })).data;
  await upload(att.attributes.uploadOperations, bytes, name);
  await call("PATCH", `/v1/appStoreReviewAttachments/${att.id}`, { data: { type: "appStoreReviewAttachments", id: att.id, attributes: { uploaded: true, sourceFileChecksum: await md5(VIDEO) } } });
  await delivered(`/v1/appStoreReviewAttachments/${att.id}`, name);
  change(`${platform} App Review attachment: uploaded ${name} (${size} bytes), processing complete`);
}

async function selectBuild(platform: string, number: string) {
  const v = await versionOf(platform);
  mustBeEditable(v);
  const b = await buildOf(platform, number);
  if (b.marketing !== v.attributes.versionString) throw new Error(`build ${number} is version ${b.marketing}, the store version is ${v.attributes.versionString}`);
  // Export compliance: the build's Info.plist answers it (ITSAppUsesNonExemptEncryption). Only an unanswered build is set.
  if (b.usesNonExemptEncryption === null) {
    if (APPLY) await call("PATCH", `/v1/builds/${b.id}`, { data: { type: "builds", id: b.id, attributes: { usesNonExemptEncryption: false } } });
    change(`${platform} build ${number}: export compliance answered (uses non-exempt encryption: no)`);
  } else say(`${platform} build ${number}: export compliance already answered by the build (uses non-exempt encryption: ${b.usesNonExemptEncryption})`);
  if (v.relationships?.build?.data?.id === b.id) { say(`${platform}: build ${number} already selected`); return v; }
  if (APPLY) await call("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: b.id } });
  change(`${platform} ${v.attributes.versionString}: build ${v.relationships?.build?.data?.id ? "replaced by" : "set to"} ${number}`);
  return v;
}

/** The last step: selects the build, checks the page, and submits the version for review. */
async function submit(platform: string, number: string) {
  const v = await selectBuild(platform, number);
  // The page must be complete before anything is submitted.
  const problems: string[] = [];
  const loc = await localization(v.id);
  const want = await metadata(platform);
  if (loc.attributes.description !== want.description) problems.push("the description is not the package's (run: texts)");
  const sets = (await get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`)).data as J[];
  if (platform === "IOS" && !IPAD) problems.push("pass --ipad <dir>, so the iPad screenshots are checked against the new set");
  const setsFull = await get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`);
  for (const [type, dir] of SHOTS[platform].sets) {
    const { files, sums } = await shotFiles(dir);
    const ids = (sets.find((s) => s.attributes.screenshotDisplayType === type)?.relationships?.appScreenshots?.data ?? []).map((d: J) => d.id) as string[];
    const live = ids.map((id) => (setsFull.included ?? []).find((i: J) => i.id === id)?.attributes);
    if (live.length !== files.length || live.some((x, i) => x?.fileName !== files[i] || x?.sourceFileChecksum !== sums[i] || x?.assetDeliveryState?.state !== "COMPLETE")) problems.push(`the ${type} screenshots are not the files of ${dir} (run: screenshots)`);
  }
  for (const type of SHOTS[platform].remove) if (sets.some((s) => s.attributes.screenshotDisplayType === type)) problems.push(`the old ${type} set is still there (run: screenshots)`);
  const rd = await get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail?include=appStoreReviewAttachments`).catch(() => ({ data: null }));
  const notes: string = rd.data?.attributes?.notes ?? "";
  if (!notes.startsWith("Pinto Notes 1.2") || /\[[A-Z ]+\]/.test(notes)) problems.push("the review notes are old or hold a placeholder (run: review)");
  if (!rd.data?.attributes?.demoAccountRequired || !rd.data?.attributes?.demoAccountName) problems.push("no demo account (run: review)");
  if (!(rd.included ?? []).some((x: J) => x.attributes.assetDeliveryState?.state === "COMPLETE")) problems.push("no review attachment (run: review --video …)");
  if (v.attributes.releaseType !== "MANUAL") problems.push("release is not manual (run: version)");
  const name = ((await get(`/v1/apps/${APP_ID}/appInfos?include=appInfoLocalizations`)).included ?? []).map((l: J) => l.attributes.name).join(" / ");
  if (!name.includes("Pinto Notes")) problems.push(`the app name is "${name}" (run: appinfo)`);
  if (problems.length) throw new Error("not ready to submit:\n  - " + problems.join("\n  - "));
  say(`Ready: ${platform} ${v.attributes.versionString}, build ${number}, "${name}", manual release.`);
  if (!APPLY || !SUBMIT_OK) { say(`would: add ${platform} ${v.attributes.versionString} to a review submission and submit it to App Review. To do it: add --apply --submit-for-review`); return; }
  const open = (await get(`/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=${platform}&filter[state]=READY_FOR_REVIEW&limit=5`)).data as J[];
  const sub = open[0] ?? (await call("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform }, relationships: { app: { data: { type: "apps", id: APP_ID } } } } })).data;
  const items = (await get(`/v1/reviewSubmissions/${sub.id}/items?include=appStoreVersion`)).data as J[];
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === v.id)) {
    await call("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } });
  }
  await call("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } });
  const now = (await get(`/v1/reviewSubmissions/${sub.id}`)).data.attributes.state;
  change(`SUBMITTED ${platform} ${v.attributes.versionString} build ${number} for review (submission state ${now})`);
}

try {
  if (step === "state") await state();
  else if (step === "backup") await backup();
  else if (step === "unsubmit") await unsubmit(platformOf(arg1));
  else if (step === "version" && arg2) await setVersion(platformOf(arg1), arg2);
  else if (step === "appinfo") await appInfo();
  else if (step === "texts") await texts(platformOf(arg1));
  else if (step === "screenshots") await screenshots(platformOf(arg1));
  else if (step === "review") await review(platformOf(arg1));
  else if (step === "build" && arg2) await selectBuild(platformOf(arg1), arg2);
  else if (step === "submit" && arg2) await submit(platformOf(arg1), arg2);
  else say("usage: asc-submit.ts state | backup | unsubmit <ios|mac> | version <ios|mac> <v> | appinfo | texts <ios|mac> | screenshots <ios|mac> | review <ios|mac> | build <ios|mac> <build> | submit <ios|mac> <build>   [--apply] [--package <dir>] [--video <file>]");
  if (!APPLY && step && step !== "state") say("(dry run: nothing was changed; add --apply)");
} catch (e) {
  say(`✗ ${step}: ${(e as Error).message}`);
  await flushLog();
  Deno.exit(1);
}
await flushLog();
