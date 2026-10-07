// Libraries an app can load without carrying them, as the app does it (note-pages-proto,
// Pane/Resources/AppLibraries/libraries.json and page.ts): the bundled ones by name in
// <meta name="amber-libs" content="chart, d3">, loaded before the page's scripts as globals (or
// at runtime with await amber.lib("three")), and any other npm package in the same meta as
// npm:<name>@<x.y.z>[/<file>]#<sha256|sha384|sha512>-<base64>, which the app downloads once from
// cdn.jsdelivr.net, checks against the hash and keeps on the device.

import { NPM_REF } from "./page.ts";

/** Bundled with Amber Notes: name, global, the npm file it's built from (libraries.test.ts keeps this in step with page.ts BUNDLED_LIBS and the app's manifest). */
export const BUNDLED: { name: string; global: string; version: string; npm: string; what: string; signature: RegExp }[] = [
  { name: "chart", global: "Chart", version: "4.4.4", npm: "chart.js@4.4.4/dist/chart.umd.js", what: "charts: line, bar, doughnut, radar", signature: /Chart\.js v\d|chartjs\.org/ },
  { name: "d3", global: "d3", version: "7.9.0", npm: "d3@7.9.0/dist/d3.min.js", what: "data-driven SVG, scales, shapes, geo projections", signature: /d3js\.org/ },
  { name: "three", global: "THREE", version: "0.160.0", npm: "three@0.160.0/build/three.min.js", what: "3D with WebGL", signature: /three\.js\b|REVISION\s*=\s*["']1\d\d["']/ },
  { name: "tone", global: "Tone", version: "14.8.49", npm: "tone@14.8.49/build/Tone.js", what: "sound and music (start audio after a tap)", signature: /Tone\.js|ToneAudioNode/ },
  { name: "dayjs", global: "dayjs", version: "1.11.13", npm: "dayjs@1.11.13/dayjs.min.js", what: "dates", signature: /\$isDayjsObject/ },
  { name: "marked", global: "marked", version: "12.0.2", npm: "marked@12.0.2/marked.min.js", what: "markdown to HTML (clean the result with purify)", signature: /marked v\d|\bmarked\.js\b/ },
  { name: "purify", global: "DOMPurify", version: "3.1.6", npm: "dompurify@3.1.6/dist/purify.min.js", what: "cleans HTML", signature: /DOMPurify \d|cure53/ },
  { name: "anime", global: "anime", version: "3.2.2", npm: "animejs@3.2.2/lib/anime.min.js", what: "animation", signature: /anime\.js v\d|animejs\.com/ },
  { name: "confetti", global: "confetti", version: "1.9.3", npm: "canvas-confetti@1.9.3/dist/confetti.browser.js", what: "confetti", signature: /canvas-confetti|confettiCannon/ },
  { name: "topojson", global: "topojson", version: "3.1.0", npm: "topojson-client@3.1.0/dist/topojson-client.min.js", what: "TopoJSON to GeoJSON (maps with d3)", signature: /topojson-client|https:\/\/github\.com\/topojson/ },
  { name: "world", global: "worldAtlas110m", version: "2.0.2", npm: "world-atlas@2.0.2/countries-110m.json", what: "country shapes, 1:110m TopoJSON", signature: /"objects":\s*\{\s*"countries"/ },
  { name: "preact", global: "preact", version: "10.24.3", npm: "preact@10.24.3/dist/preact.umd.js", what: "components and state for real multi-screen apps (with htm, no build step)", signature: /preactjs|__H:|\.__k\b/ },
  { name: "preact-hooks", global: "preactHooks", version: "10.24.3", npm: "preact@10.24.3/hooks/dist/hooks.umd.js", what: "useState, useEffect, useMemo and the other hooks", signature: /preactHooks/ },
  { name: "htm", global: "htm", version: "3.1.1", npm: "htm@3.1.1/dist/htm.umd.js", what: "JSX-like templates in plain JavaScript: html`<${App} />`", signature: /htm\.umd|\bhtm=function/ },
  { name: "router", global: "amberRouter", version: "1.0.0", npm: "local:Pane/Resources/AppLibraries/router.js", what: "screens for a Preact app, kept in memory: <Router>, route(), back(), useRoute()", signature: /amberRouter\s*=/ },
];

/** npm:<name>@<x.y.z>[/<file>]#<sha256|sha384|sha512>-<base64>: the app's own rule (page.ts). */
export { NPM_REF };

/** The items of <meta name="amber-libs">. */
export function declaredLibs(html: string): string[] {
  const tag = html.match(/<meta[^>]*name=["']amber-libs["'][^>]*>/i)?.[0];
  const content = tag?.match(/content=(['"])([\s\S]*?)\1/)?.[2];
  return content ? content.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/** How the guide teaches it. */
export const LIBRARY_GUIDE = `Libraries load by name, never pasted into the app:
- Bundled with Amber Notes (on the device, instant): ${BUNDLED.map((b) => `${b.name} (${b.what}; global ${b.global})`).join(", ")}.
  Declare them: <meta name="amber-libs" content="chart, dayjs">; they load before your scripts. Or load one when needed: const THREE = await amber.lib("three").
- Any other npm package: call resolve_package { name, version?, file? } and add the entry it returns to the same meta, like <meta name="amber-libs" content="chart, npm:qrcode-generator@1.4.4/qrcode.js#sha384-…">. Amber Notes downloads that exact file once, checks the hash and keeps it on the device; an entry without an exact version and a hash is refused. Pick a UMD or global build (it defines a global), not an ES module with imports. Prefer a bundled library when one does the job.
- Never paste a library's code into the app: it bloats the app and can't be checked or updated. check_app flags pasted copies.`;

/** Library problems in an app's HTML, worded as fixes. */
export function libraryReport(html: string): string[] {
  const out: string[] = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2] }));
  for (const b of BUNDLED) {
    if (scripts.some((s) => b.signature.test(s.body) && s.body.length > 5000)) out.push(`The app has a pasted copy of ${b.name}. Declare the bundled one instead: <meta name="amber-libs" content="${b.name}"> (global ${b.global}).`);
  }
  for (const s of scripts) {
    if (s.body.length > 60_000 && !BUNDLED.some((b) => b.signature.test(s.body))) out.push(`One inline script is ${Math.round(s.body.length / 1024)} KB, which looks like a pasted library. Load it with resolve_package (npm, pinned and hashed, in amber-libs) or a bundled library instead.`);
  }
  for (const item of declaredLibs(html)) {
    if (item.startsWith("npm:")) {
      if (!NPM_REF.test(item)) out.push(`"${item}" needs an exact version and a hash: npm:name@1.2.3/file.js#sha384-…; get it from resolve_package.`);
    } else if (!BUNDLED.some((b) => b.name === item)) {
      out.push(`No bundled library "${item}". Bundled: ${BUNDLED.map((b) => b.name).join(", ")}; anything else through resolve_package.`);
    }
  }
  if (/<script[^>]*src=["']amber-lib:/i.test(html)) out.push("Don't point <script src> at amber-lib: yourself: declare libraries in <meta name=\"amber-libs\"> (or await amber.lib(name)).");
  const used = (g: string) => new RegExp(`\\b${g.replace(/[.$]/g, "\\$&")}\\b\\s*[.(]`).test(scripts.map((s) => s.body).join("\n"));
  const declared = declaredLibs(html);
  for (const b of BUNDLED) {
    if (used(b.global) && !declared.includes(b.name) && !new RegExp(`amber\\.lib\\(\\s*["']${b.name}["']`).test(html) && !scripts.some((s) => b.signature.test(s.body))) {
      out.push(`The app uses ${b.global} but doesn't declare it: add "${b.name}" to <meta name="amber-libs">.`);
    }
  }
  return [...new Set(out)];
}

/** An npm package's file at an exact version with its SRI hash (from jsDelivr's registry metadata), as an amber-libs entry. */
export async function resolvePackage(name: string, version?: string, file?: string): Promise<{ name: string; version: string; file: string; entry: string; meta: string; bytes: number; note: string }> {
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) throw new Error(`"${name}" isn't an npm package name.`);
  const bundled = BUNDLED.find((b) => b.name === name || b.npm.startsWith(`${name}@`));
  if (bundled) throw new Error(`${name} is bundled with Amber Notes as "${bundled.name}" (global ${bundled.global}): <meta name="amber-libs" content="${bundled.name}">.`);
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "amber-notes-mcp" } });
    if (!res.ok) { await res.body?.cancel(); throw new Error(res.status === 404 ? `No npm package ${name}${version ? `@${version}` : ""}.` : `The package registry answered ${res.status}; try again.`); }
    return await res.json();
  };
  const v = (await get(`https://data.jsdelivr.com/v1/packages/npm/${name}/resolved${version ? `?specifier=${encodeURIComponent(version)}` : ""}`)).version as string | null;
  if (!v) throw new Error(`No version of ${name} matches ${version ?? "latest"}.`);
  const meta = await get(`https://data.jsdelivr.com/v1/packages/npm/${name}@${v}?structure=flat`) as { default?: string; files: { name: string; hash: string; size: number }[] };
  const want = file ? (file.startsWith("/") ? file : `/${file}`) : meta.default;
  // The package's own file (its hash is in the registry listing); a generated .min.js the package
  // doesn't ship falls back to the file it's made from.
  const f = meta.files.find((x) => x.name === want) ?? meta.files.find((x) => want && x.name === want.replace(/\.min\.js$/, ".js"));
  if (!f) {
    const js = meta.files.filter((x) => /\.(m?js)$/.test(x.name) && !/test|\.d\.ts/.test(x.name)).sort((a, b) => a.size - b.size).slice(0, 12).map((x) => x.name);
    throw new Error(`${name}@${v} has no file ${want ?? "(no default)"}. Some of its files: ${js.join(", ")}. Pass file: a UMD or global build.`);
  }
  if (f.size > 2_000_000) throw new Error(`${name}@${v}${f.name} is ${(f.size / 1e6).toFixed(1)} MB; pick a smaller build, or a bundled library.`);
  const entry = `npm:${name}@${v}${f.name}#sha256-${f.hash}`;
  return { name, version: v, file: f.name, entry, meta: `<meta name="amber-libs" content="${entry}">`, bytes: f.size,
    note: "Add the entry to <meta name=\"amber-libs\"> (with any bundled names, comma-separated). Use it only if this file is a UMD or global build that runs on its own in a browser; otherwise pass another file or pick another package." };
}
