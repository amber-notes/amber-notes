// App Store Connect automation for Amber Notes' TestFlight.
//
//   deno run -A scripts/asc.ts status                 app, builds, groups, public link
//   deno run -A scripts/asc.ts wait <build>           wait until iOS and Mac builds <build> are processed
//   deno run -A scripts/asc.ts setup <build>          beta info, groups, the build in both groups,
//                                                     beta review submission, public link
//
// Reads .secrets/asc.env (ASC_KEY_ID, ASC_ISSUER_ID, optional ASC_CONTACT_PHONE) and the .p8 key.
// Beta App Review needs a contact phone number; without ASC_CONTACT_PHONE the review
// submission is skipped (everything else still runs) and the script says so.

const APP_BUNDLE = "dev.emilwagman.pane";
const API = "https://api.appstoreconnect.apple.com/v1";
// The privacy policy page (the share site writes its address to .secrets/privacy-url.txt).
const PRIVACY_URL = Deno.env.get("ASC_PRIVACY_URL") ||
  (await Deno.readTextFile(".secrets/privacy-url.txt").then((t) => t.trim()).catch(() => "")) ||
  "https://ambernotes.app/privacy";

const env: Record<string, string> = {};
for (const line of (await Deno.readTextFile(".secrets/asc.env")).split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const keyId = env.ASC_KEY_ID, issuer = env.ASC_ISSUER_ID;
if (!keyId || !issuer) throw new Error(".secrets/asc.env needs ASC_KEY_ID and ASC_ISSUER_ID");
const keyPath = [...Deno.readDirSync(".secrets")].map((e) => e.name).find((n) => n === `AuthKey_${keyId}.p8`) ??
  [...Deno.readDirSync(".secrets")].map((e) => e.name).find((n) => n.endsWith(".p8"));
if (!keyPath) throw new Error("no .p8 key in .secrets/");
const pem = await Deno.readTextFile(`.secrets/${keyPath}`);

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

// deno-lint-ignore no-explicit-any
type J = any;
async function call(method: string, path: string, body?: J): Promise<J> {
  const res = await fetch(path.startsWith("http") ? path : API + path, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}
const get = (p: string) => call("GET", p);

async function app() {
  const r = await get(`/apps?filter[bundleId]=${APP_BUNDLE}`);
  const a = r.data.find((x: J) => x.attributes.bundleId === APP_BUNDLE);
  if (!a) throw new Error(`No app with bundle id ${APP_BUNDLE} in App Store Connect yet (create it in the web UI first).`);
  return a;
}

async function builds(appId: string, version?: string) {
  const q = version ? `&filter[version]=${version}` : "";
  const r = await get(`/builds?filter[app]=${appId}${q}&include=preReleaseVersion&limit=50&sort=-uploadedDate`);
  const pre = new Map((r.included ?? []).map((i: J) => [i.id, i.attributes.platform]));
  return r.data.map((b: J) => ({
    id: b.id, version: b.attributes.version, state: b.attributes.processingState,
    platform: pre.get(b.relationships?.preReleaseVersion?.data?.id) ?? "?", expired: b.attributes.expired,
    usesNonExemptEncryption: b.attributes.usesNonExemptEncryption,
  }));
}

async function groups(appId: string) {
  const r = await get(`/apps/${appId}/betaGroups?limit=50`);
  return r.data as J[];
}

async function ensureGroup(appId: string, name: string, internal: boolean) {
  const found = (await groups(appId)).find((g) => g.attributes.name === name);
  if (found) return found;
  const attributes: J = internal
    ? { name, isInternalGroup: true, hasAccessToAllBuilds: true }
    : { name, publicLinkEnabled: true, publicLinkLimitEnabled: false, feedbackEnabled: true };
  const r = await call("POST", "/betaGroups", { data: { type: "betaGroups", attributes, relationships: { app: { data: { type: "apps", id: appId } } } } });
  return r.data;
}

const DESCRIPTION = `Amber Notes is a fast, simple notes app for iPhone and Mac that syncs through the cloud.
Notes are markdown underneath: checklists, tables, images and files, sub-notes and folders.
You can also connect ChatGPT, Claude, Claude Code or Codex so your AI can read and write your notes (only if you choose to).`;
const WHAT_TO_TEST = `Sign in with Apple, then use it as your notes app for a few days:
- Write notes with checklists, tables, images and files; try sub-notes and folders.
- Check that notes sync between your iPhone and Mac.
- Try search, pinning, and moving or deleting several notes at once.
Send feedback with a screenshot from TestFlight (take a screenshot in the app and share it).`;

async function setup(build: string) {
  const a = await app();
  const appId = a.id;
  console.log(`App ${a.attributes.name} (${appId})`);

  // Beta App Information: description, feedback email, privacy policy.
  const locs = (await get(`/apps/${appId}/betaAppLocalizations`)).data as J[];
  const locAttrs: J = { description: DESCRIPTION, feedbackEmail: "hello@ambernotes.app" };
  if (PRIVACY_URL) locAttrs.privacyPolicyUrl = PRIVACY_URL;
  const en = locs.find((l) => l.attributes.locale === "en-US");
  if (en) await call("PATCH", `/betaAppLocalizations/${en.id}`, { data: { type: "betaAppLocalizations", id: en.id, attributes: locAttrs } });
  else await call("POST", "/betaAppLocalizations", { data: { type: "betaAppLocalizations", attributes: { locale: "en-US", ...locAttrs }, relationships: { app: { data: { type: "apps", id: appId } } } } });
  console.log(`✓ Beta app information${PRIVACY_URL ? "" : " (no privacy policy URL yet)"}`);

  // Beta App Review contact.
  const phone = env.ASC_CONTACT_PHONE ?? "";
  const detail = (await get(`/apps/${appId}/betaAppReviewDetail`)).data;
  const reviewAttrs: J = { contactFirstName: "Emil", contactLastName: "Wagman", contactEmail: "hello@ambernotes.app", demoAccountRequired: false,
    notes: "Sign in with Apple creates an account; no demo account is needed. The Mac app's Apple Notes import asks Notes for the notes you pick and never changes them." };
  if (phone) reviewAttrs.contactPhone = phone;
  await call("PATCH", `/betaAppReviewDetails/${detail.id}`, { data: { type: "betaAppReviewDetails", id: detail.id, attributes: reviewAttrs } });
  console.log(`✓ Beta review contact${phone ? "" : " (no phone number yet)"}`);

  // The build(s): What to Test, then both groups.
  const bs = (await builds(appId, build)).filter((b: J) => b.state === "VALID");
  if (!bs.length) throw new Error(`Build ${build} isn't processed yet (run: wait ${build}).`);
  for (const b of bs) {
    const bl = (await get(`/builds/${b.id}/betaBuildLocalizations`)).data as J[];
    const e = bl.find((l) => l.attributes.locale === "en-US");
    if (e) await call("PATCH", `/betaBuildLocalizations/${e.id}`, { data: { type: "betaBuildLocalizations", id: e.id, attributes: { whatsNew: WHAT_TO_TEST } } });
    else await call("POST", "/betaBuildLocalizations", { data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", whatsNew: WHAT_TO_TEST }, relationships: { build: { data: { type: "builds", id: b.id } } } } });
    if (b.usesNonExemptEncryption === null) {
      await call("PATCH", `/builds/${b.id}`, { data: { type: "builds", id: b.id, attributes: { usesNonExemptEncryption: false } } });
    }
  }
  console.log(`✓ What to Test on ${bs.map((b: J) => b.platform).join(" + ")} build ${build}`);

  const team = await ensureGroup(appId, "Team", true);
  const colleagues = await ensureGroup(appId, "Colleagues", false);
  await call("POST", `/betaGroups/${colleagues.id}/relationships/builds`, { data: bs.map((b: J) => ({ type: "builds", id: b.id })) });
  console.log(`✓ Groups: Team (internal, every build) and Colleagues (public link) have build ${build}`);

  // The account holder in the internal group, so builds reach them without review.
  try {
    const users = (await get(`/users?limit=50`)).data as J[];
    const holder = users.find((u) => (u.attributes.roles ?? []).includes("ACCOUNT_HOLDER")) ?? users[0];
    if (holder) {
      const email = holder.attributes.username;
      const existing = (await get(`/betaTesters?filter[email]=${encodeURIComponent(email)}&filter[apps]=${appId}`)).data as J[];
      if (!existing.length) {
        await call("POST", "/betaTesters", { data: { type: "betaTesters", attributes: { email, firstName: holder.attributes.firstName, lastName: holder.attributes.lastName }, relationships: { betaGroups: { data: [{ type: "betaGroups", id: team.id }] } } } });
      }
      console.log(`✓ ${email} is in the internal Team group`);
    }
  } catch (e) { console.log(`! Couldn't add you to the internal group: ${(e as Error).message.slice(0, 200)}`); }

  // Beta App Review for external testing (the first build of a version needs it).
  if (!phone) {
    console.log("! Beta App Review NOT submitted: add ASC_CONTACT_PHONE=+46… to .secrets/asc.env and run setup again.");
  } else if (!PRIVACY_URL) {
    console.log("! Beta App Review NOT submitted: set ASC_PRIVACY_URL to the privacy policy page and run setup again.");
  } else {
    for (const b of bs) {
      try {
        await call("POST", "/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: b.id } } } } });
        console.log(`✓ ${b.platform} build ${build} submitted for Beta App Review`);
      } catch (e) {
        const m = (e as Error).message;
        console.log(m.includes("409") ? `• ${b.platform} build ${build}: already submitted or not needed` : `! ${b.platform} review submission failed: ${m.slice(0, 300)}`);
      }
    }
  }

  const g = (await get(`/betaGroups/${colleagues.id}`)).data;
  console.log(`\nPublic link: ${g.attributes.publicLink ?? "(appears once Beta App Review approves the first build)"}`);
}

async function status() {
  const a = await app();
  console.log(`App ${a.attributes.name} (${a.id})`);
  for (const b of (await builds(a.id)).slice(0, 10)) console.log(`  build ${b.version} ${b.platform} ${b.state}${b.expired ? " expired" : ""}`);
  for (const g of await groups(a.id)) {
    console.log(`  group ${g.attributes.name}${g.attributes.isInternalGroup ? " (internal)" : ""}${g.attributes.publicLink ? " " + g.attributes.publicLink : ""}`);
  }
  const subs = await get(`/betaAppReviewSubmissions?filter[build]=${(await builds(a.id)).map((b: J) => b.id).slice(0, 10).join(",")}`).catch(() => ({ data: [] }));
  for (const s of subs.data ?? []) console.log(`  review ${s.attributes.betaReviewState}`);
}

async function wait(build: string) {
  const a = await app();
  for (let i = 0; i < 90; i++) {
    const bs = await builds(a.id, build);
    const states = bs.map((b: J) => `${b.platform}:${b.state}`).join(" ");
    if (bs.length && bs.every((b: J) => b.state !== "PROCESSING")) { console.log(`Build ${build}: ${states}`); return; }
    if (i % 5 === 0) console.log(`Build ${build}: ${states || "not visible yet"}`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw new Error(`Build ${build} still processing after 45 minutes`);
}

const [cmd, arg] = Deno.args;
if (cmd === "status") await status();
else if (cmd === "wait" && arg) await wait(arg);
else if (cmd === "setup" && arg) await setup(arg);
else console.log("usage: deno run -A scripts/asc.ts status | wait <build> | setup <build>");
