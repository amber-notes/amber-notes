// Bundles the libraries a note app can import into one file of ES modules for the app:
// Pane/Resources/AppLibraries/stack.json = { version, modules: { "<file>": "<js>" }, map: { "<bare name>": "<file>" } }.
// React is preact/compat: "react", "react-dom", "react-dom/client" and "react/jsx-runtime" all
// resolve to it, so React libraries (Radix, recharts, sonner, ...) run on one small Preact.
// Shared code goes into chunks, so every library sees the same Preact and the same Radix internals.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const entries = {
  "preact": "preact", "preact/hooks": "preact/hooks", "preact/compat": "preact/compat",
  "preact/compat/client": "preact/compat/client", "preact/jsx-runtime": "preact/jsx-runtime",
  "preact/compat/jsx-runtime": "preact/compat/jsx-runtime",
  "radix-ui": "radix-ui", "class-variance-authority": "class-variance-authority", "clsx": "clsx",
  "tailwind-merge": "tailwind-merge", "lucide-react": "lucide-react", "recharts": "recharts",
  "date-fns": "date-fns", "zod": "zod", "framer-motion": "framer-motion", "motion": "motion",
  "sonner": "sonner", "react-day-picker": "react-day-picker",
  // React's names: preact/compat, with React 19's ref-as-prop (shims/).
  "react": "./shims/react.js", "react-dom/client": "./shims/react-dom-client.js", "react/jsx-runtime": "./shims/react-jsx-runtime.js",
};
// Radix's own packages (@radix-ui/react-slot, @radix-ui/react-dialog, ...) by name too, for shadcn
// sources that import them directly. They are the same modules radix-ui re-exports.
const radixRequire = createRequire(realpathSync("node_modules/radix-ui/package.json"));
for (const name of Object.keys(JSON.parse(readFileSync("node_modules/radix-ui/package.json", "utf8")).dependencies)) {
  if (!name.startsWith("@radix-ui/react-")) continue;
  let dir = dirname(radixRequire.resolve(name));
  while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
  const pkgFile = join(dir, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgFile, "utf8"));
  const entry = pkgJson.module ?? pkgJson.exports?.["."]?.import?.default ?? pkgJson.main;
  entries[name] = join(dirname(pkgFile), entry);
}
const file = (name) => name.replace(/[@/]/g, "_") + ".js";

rmSync("dist", { recursive: true, force: true });
const result = await esbuild.build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([n, s]) => [file(n).slice(0, -3), s])),
  bundle: true, splitting: true, format: "esm", target: "es2020", minify: true, outdir: "dist",
  chunkNames: "chunk-[hash]", write: false, metafile: true, legalComments: "none",
  alias: {
    "react": "./shims/react.js", "react-dom": "./shims/react.js", "react-dom/client": "./shims/react-dom-client.js",
    "react/jsx-runtime": "./shims/react-jsx-runtime.js", "react/jsx-dev-runtime": "./shims/react-jsx-runtime.js",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const modules = {};
for (const f of result.outputFiles) modules[f.path.split("/dist/").pop()] = f.text;
const map = Object.fromEntries(Object.keys(entries).map((n) => [n, file(n)]));
// React's names, all preact/compat.
Object.assign(map, { "react-dom": map["react"], "react/jsx-dev-runtime": map["react/jsx-runtime"] });
const versions = Object.fromEntries(Object.keys(pkg.dependencies).map((n) => [n, JSON.parse(readFileSync(`node_modules/${n}/package.json`, "utf8")).version]));
const licenses = Object.fromEntries(Object.keys(pkg.dependencies).map((n) => [n, JSON.parse(readFileSync(`node_modules/${n}/package.json`, "utf8")).license]));
const out = JSON.stringify({ version: 1, versions, licenses, map, modules });
writeFileSync("../Pane/Resources/AppLibraries/stack.json", out);
const total = Object.values(modules).reduce((a, s) => a + Buffer.byteLength(s), 0);
const sha = createHash("sha384").update(out).digest("base64");
console.log(`${Object.keys(modules).length} files, ${(total / 1024).toFixed(0)} KB, sha384-${sha.slice(0, 16)}…`);
const sizes = Object.entries(modules).map(([k, v]) => [k, Buffer.byteLength(v)]).sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [k, v] of sizes) console.log(`  ${k} ${(v / 1024).toFixed(0)} KB`);
