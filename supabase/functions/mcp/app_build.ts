// The build step for a note's app, done in this process: esbuild (WebAssembly) for each module,
// Tailwind v4 for each stylesheet that imports it. The hosted edge runtime can't start esbuild's
// WebAssembly within its limits, so there the render service runs this (POST /build in
// scripts/page-render/server.ts) and app_project.ts calls it; tests and a local server without
// RENDER_URL run it here.

export type CompileItem = { path: string; source: string };
export type Compiled = Record<string, { code: string } | { error: string }>;

// deno-lint-ignore no-explicit-any
let esbuild: Promise<any> | null = null;
function start() {
  esbuild ??= import("npm:esbuild-wasm@0.24.0").then(async (m) => { await m.initialize({ worker: false }); return m; });
  return esbuild;
}

/** The agreed transform: esbuild, JSX automatic (React's runtime, which the app maps to
 *  preact/compat, or Preact's for older projects), ESM, es2020, imports as written. */
export async function compileHere(items: CompileItem[], jsxImportSource: "react" | "preact"): Promise<Compiled> {
  const es = await start();
  const out: Compiled = {};
  for (const { path, source } of items) {
    const loader = path.endsWith(".tsx") ? "tsx" : path.endsWith(".ts") ? "ts" : /\.m?js$/.test(path) ? "js" : "jsx";
    try {
      const r = await es.transform(source, { loader, jsx: "automatic", jsxImportSource, format: "esm", target: "es2020", sourcemap: false, sourcefile: path });
      out[path] = { code: r.code };
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const errs = (e as any).errors as { text: string; location?: { line: number; column: number; lineText: string } }[] | undefined;
      out[path] = { error: errs?.length ? errs.slice(0, 5).map((x) => `${path}:${x.location?.line ?? "?"}:${(x.location?.column ?? 0) + 1}: ${x.text}${x.location?.lineText ? `\n    ${x.location.lineText.trim()}` : ""}`).join("\n") : String(e) };
    }
  }
  return out;
}

/** Tailwind v4 from the classes in the project's sources (no scanner: every token is a candidate,
 *  and Tailwind keeps the ones that are classes). Throws with the reason a stylesheet can't build. */
export async function tailwindHere(css: string, sources: string): Promise<string> {
  const [{ compile: twCompile }, { STYLESHEETS }] = await Promise.all([import("npm:tailwindcss@4.1.14"), import("./tailwind.gen.ts")]);
  const c = await twCompile(css, {
    base: "/",
    loadStylesheet: (id: string) => {
      if (STYLESHEETS[id] !== undefined) return Promise.resolve({ base: "/", content: STYLESHEETS[id], path: id });
      throw new Error(`@import "${id}": only "tailwindcss" and "tw-animate-css" can be imported in CSS here.`);
    },
    loadModule: () => { throw new Error("Tailwind plugins (@plugin) aren't available here."); },
  });
  return c.build([...new Set(sources.split(/[^A-Za-z0-9_\-:\[\]\/.#%()!@&*=,'+]+/).filter((x) => x && x.length < 200))]);
}
