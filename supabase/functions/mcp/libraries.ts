// Libraries an app can load without carrying them: the ones Amber Notes bundles, by name, and any
// npm package's file pinned to a version and a hash, which the app downloads once, checks and
// serves locally (never from the network at run time).
//
// PROVISIONAL: the syntax here is the one proposed to the app's bridge (note-pages-proto) and may
// change; keep it in this one place so the guide, check_app, resolve_package and the evals follow.

/** Bundled with Amber Notes, loaded by name: <script src="amber-lib:chart.js"></script>. */
export const BUNDLED: { name: string; version: string; npm: string; global?: string; module?: boolean; what: string; signature: RegExp }[] = [
  { name: "chart.js", version: "4.4.4", npm: "chart.js@4.4.4/dist/chart.umd.js", global: "Chart", what: "charts: bar, line, doughnut, radar, scatter", signature: /Chart\.js v\d|chartjs\.org/ },
  { name: "d3", version: "7.9.0", npm: "d3@7.9.0/dist/d3.min.js", global: "d3", what: "custom data visualizations, scales, shapes, layouts", signature: /d3js\.org|\bd3-(array|scale|selection) v?\d/ },
  { name: "three", version: "0.169.0", npm: "three@0.169.0/build/three.module.min.js", module: true, what: "3D: scenes, cameras, meshes, lights (an ES module: import * as THREE from \"three\")", signature: /three\.js\b|REVISION\s*=\s*["']1\d\d["']/ },
  { name: "tone", version: "15.0.4", npm: "tone@15.0.4/build/Tone.js", global: "Tone", what: "music and sound: synths, samplers, sequencers, transport", signature: /Tone\.js|ToneAudioNode/ },
  { name: "dayjs", version: "1.11.13", npm: "dayjs@1.11.13/dayjs.min.js", global: "dayjs", what: "dates: parse, format, add, diff", signature: /dayjs.*\$isDayjsObject|"\$isDayjsObject"/ },
  { name: "marked", version: "14.1.3", npm: "marked@14.1.3/marked.min.js", global: "marked", what: "markdown to HTML (escape or sanitize what you show)", signature: /marked v\d|\bmarked\.js\b/ },
];

/** How the guide teaches it. */
export const LIBRARY_GUIDE = `Libraries load by name, never pasted into the app:
- Bundled with Amber Notes (no network, instant): ${BUNDLED.map((b) => `${b.name} ${b.version} (${b.what}${b.global ? `; global ${b.global}` : ""})`).join("; ")}.
  Classic: <script src="amber-lib:chart.js"></script>. ES module: <script type="importmap">{"imports": {"three": "amber-lib:three"}}</script> then <script type="module">import * as THREE from "three"; …</script>.
- Anything else on npm, pinned and hashed: call resolve_package { name, version?, file? } and paste the tag it returns, like <script src="amber-lib:npm/qrcode@1.5.4/build/qrcode.js" integrity="sha256-…"></script>. Amber Notes downloads that exact file once, checks the hash and serves it locally; a reference without an exact version and integrity is refused. Prefer a bundled library when one does the job; keep npm packages small and few.
- Never paste a library's code into the app (it bloats the app and can't be updated or checked); check_app flags inlined copies.`;

/** Library problems in an app's HTML, worded as fixes. */
export function libraryReport(html: string): string[] {
  const out: string[] = [];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2] }));
  for (const b of BUNDLED) {
    if (scripts.some((s) => b.signature.test(s.body) && s.body.length > 5000)) out.push(`The app has a pasted copy of ${b.name}. Load the bundled one instead: ${b.module ? `an importmap "${b.name}": "amber-lib:${b.name}"` : `<script src="amber-lib:${b.name}"></script>`}.`);
  }
  for (const s of scripts) {
    if (s.body.length > 60_000 && !BUNDLED.some((b) => b.signature.test(s.body))) out.push(`One inline script is ${Math.round(s.body.length / 1024)} KB, which looks like a pasted library. Load it with resolve_package (npm, pinned and hashed) or a bundled library instead.`);
  }
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["'](amber-lib:[^"']+)["']([^>]*)/gi)].map((m) => ({ ref: m[1], rest: m[2], tag: m[0] }));
  const imports = [...html.matchAll(/["'](amber-lib:[^"']+)["']/g)].map((m) => m[1]);
  for (const r of new Set([...refs.map((x) => x.ref), ...imports])) {
    const npm = r.match(/^amber-lib:npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)(\/.*)?$/);
    if (r.startsWith("amber-lib:npm/")) {
      if (!npm) { out.push(`${r} isn't a pinned npm reference: it's amber-lib:npm/<name>@<exact version>/<file>; get it from resolve_package.`); continue; }
      if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(npm[2])) out.push(`${r}: pin an exact version (not ${npm[2]}); get it from resolve_package.`);
      const tag = refs.find((x) => x.ref === r);
      const esc = r.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const integrity = (tag ? /integrity\s*=\s*["']sha(256|384|512)-[A-Za-z0-9+/=]+["']/i.test(tag.tag) : false) || new RegExp(`"${esc}"\\s*:\\s*"sha(256|384|512)-`).test(html);
      if (!integrity) out.push(`${r} has no integrity hash: add the integrity="sha256-…" that resolve_package returns, or the app refuses to load it.`);
      continue;
    }
    const name = r.slice("amber-lib:".length);
    if (!BUNDLED.some((b) => b.name === name)) out.push(`${r} isn't a bundled library (bundled: ${BUNDLED.map((b) => b.name).join(", ")}). Use resolve_package for anything else.`);
  }
  if (/<script[^>]*src=["']amber-lib:three["']/i.test(html)) out.push("three is an ES module: load it with an importmap and <script type=\"module\">, not a classic <script src>.");
  return out;
}

/** An npm package's file, pinned to an exact version, with its SRI hash, from jsDelivr's metadata. */
export async function resolvePackage(name: string, version?: string, file?: string): Promise<{ name: string; version: string; file: string; src: string; integrity: string; tag: string; bytes: number; note: string }> {
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) throw new Error(`"${name}" isn't an npm package name.`);
  const bundled = BUNDLED.find((b) => b.name === name);
  if (bundled) throw new Error(`${name} is bundled with Amber Notes: use <script src="amber-lib:${name}"></script>${bundled.module ? " (as an ES module through an importmap)" : ""} instead.`);
  const get = async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "amber-notes-mcp" } });
    if (!res.ok) { await res.body?.cancel(); throw new Error(res.status === 404 ? `No npm package ${name}${version ? `@${version}` : ""}.` : `The package registry answered ${res.status}; try again.`); }
    return await res.json();
  };
  const v = (await get(`https://data.jsdelivr.com/v1/packages/npm/${name}/resolved${version ? `?specifier=${encodeURIComponent(version)}` : ""}`)).version as string | null;
  if (!v) throw new Error(`No version of ${name} matches ${version ?? "latest"}.`);
  const meta = await get(`https://data.jsdelivr.com/v1/packages/npm/${name}@${v}?structure=flat`) as { default?: string; files: { name: string; hash: string; size: number }[] };
  const want = file ? (file.startsWith("/") ? file : `/${file}`) : meta.default;
  // The package's own file (its hash is in the registry's listing); a generated .min.js the
  // package doesn't ship falls back to the file it's made from.
  const f = meta.files.find((x) => x.name === want) ?? meta.files.find((x) => want && x.name === want.replace(/\.min\.js$/, ".js"));
  if (!f) {
    const js = meta.files.filter((x) => /\.(m?js)$/.test(x.name) && !/test|\.d\.ts/.test(x.name)).sort((a, b) => a.size - b.size).slice(0, 12).map((x) => x.name);
    throw new Error(`${name}@${v} has no file ${want ?? "(no default)"}. Some of its files: ${js.join(", ")}. Pass file: a browser build (UMD, or an ES module without bare imports).`);
  }
  if (f.size > 2_000_000) throw new Error(`${name}@${v}${f.name} is ${(f.size / 1e6).toFixed(1)} MB; pick a smaller build, or a bundled library.`);
  const src = `amber-lib:npm/${name}@${v}${f.name}`;
  const integrity = `sha256-${f.hash}`;
  const module = /\.mjs$|\/esm\/|\.module\./.test(f.name);
  return { name, version: v, file: f.name, src, integrity, bytes: f.size, note: "Use it only if this file runs in a browser on its own (a UMD or ES module build without bare imports or require); otherwise pick another file or package.",
    tag: module ? `<script type="importmap">{"imports": {"${name}": "${src}"}, "integrity": {"${src}": "${integrity}"}}</script>` : `<script src="${src}" integrity="${integrity}"></script>` };
}
