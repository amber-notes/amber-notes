// The app-project format, path rules, edits, compile and import checks.
//   cd supabase/functions/mcp && deno test -A app_project.test.ts
import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { brokenImports, cleanPath, compile, editText, numbered, parseStored, projectProblems, resolveFrom, serialize } from "./app_project.ts";

Deno.test("a one-file app stays plain HTML; a project round-trips as JSON", () => {
  const html = "<!doctype html><p>hi</p>";
  assertEquals(parseStored(html).files, { "/index.html": html });
  assertEquals(serialize(parseStored(html)), html);
  const p = { amberApp: 1 as const, files: { "/index.html": "<div id=app></div>", "/src/App.jsx": "export default () => <p/>" }, compiled: { "/src/App.jsx": "x" } };
  assertEquals(parseStored(serialize(p)), p);
  assertEquals(parseStored("{not json").files["/index.html"], "{not json");
});

Deno.test("paths: a leading slash is added; .., spaces and empty parts are refused", () => {
  assertEquals(cleanPath("src/App.jsx"), "/src/App.jsx");
  for (const bad of ["/a/../b", "/a b.js", "/a//b", "/src/", "", "/x?.js"]) assertThrows(() => cleanPath(bad));
  assertEquals(resolveFrom("/src/screens/Home.jsx", "../components/Set.jsx"), "/src/components/Set.jsx");
  assertEquals(resolveFrom("/index.html", "/src/main.jsx"), "/src/main.jsx");
  assertEquals(resolveFrom("/index.html", "src/styles.css"), "/src/styles.css");
});

Deno.test("edits need a unique match, like a coding agent's Edit", () => {
  assertEquals(editText("a b a", "b", "c").text, "a c a");
  assertThrows(() => editText("a b a", "a", "c"), Error, "appears 2 times");
  assertEquals(editText("a b a", "a", "c", true), { text: "c b c", count: 2 });
  assertThrows(() => editText("a", "z", "y"), Error, "wasn't found");
  assertEquals(editText("x $& y", "x", "$&").text, "$& $& y");
  assertEquals(numbered("a\nb\nc", 2, 1), { text: "     2\tb", lines: 3, shown: [2, 2] });
});

Deno.test("compile: JSX to ESM with preact's runtime; syntax errors name the line", async () => {
  const ok = await compile("/src/App.jsx", `import { useState } from "preact/hooks";\nexport default function App() { const [n] = useState(1); return <p class="n">{n}</p>; }`);
  assert("code" in ok);
  assertStringIncludes(ok.code, `from "preact/jsx-runtime"`);
  assertStringIncludes(ok.code, `from "preact/hooks"`);
  const bad = await compile("/src/App.jsx", "export default () => <div>\n");
  assert("error" in bad);
  assertStringIncludes(bad.error, "/src/App.jsx:");
});

Deno.test("imports: missing files, unknown bare names, URLs and an own import map are reported", () => {
  const p = { amberApp: 1 as const, compiled: {}, files: {
    "/index.html": `<link rel="stylesheet" href="/src/styles.css"><script type="module" src="/src/main.jsx"></script><script src="https://cdn.example/x.js"></script>`,
    "/src/main.jsx": `import { render } from "preact";\nimport App from "./App.jsx";\nimport _ from "lodash";\nimport x from "https://esm.sh/x";`,
    "/src/styles.css": "",
  } };
  const r = brokenImports(p).join("\n");
  assertStringIncludes(r, "imports ./App.jsx, but there's no such file");
  assertStringIncludes(r, `"lodash"`);
  assertStringIncludes(r, "https://esm.sh/x");
  assertStringIncludes(r, "cdn.example");
  assert(!r.includes("preact\""));
  assertStringIncludes(projectProblems({ ...p, files: { "/index.html": `<script type="importmap">{}</script>` } }).join(), "import map");
  assertStringIncludes(projectProblems({ ...p, files: { "/a.js": "" } }).join(), "/index.html");
});

Deno.test("a React + Tailwind project links like Vite: @/ alias, no extensions, CSS from the classes used", async () => {
  const { linkProject, isReact } = await import("./app_project.ts");
  const files: Record<string, string> = {
    "/index.html": `<div id="root"></div><script type="module" src="/src/main.tsx"></script>`,
    "/package.json": `{ "dependencies": { "react": "^19" } }`,
    "/src/main.tsx": `import { createRoot } from "react-dom/client";\nimport "./index.css";\nimport App from "@/App";\ncreateRoot(document.getElementById("root")!).render(<App />);`,
    "/src/App.tsx": `import { cn } from "@/lib/utils";\nimport { Button } from "./components/ui/button";\nexport default function App() { return <main className={cn("flex p-4", "md:grid-cols-3")}><Button /></main>; }`,
    "/src/components/ui/button.tsx": `export function Button() { return <button className="rounded-md bg-primary px-3 dark:bg-zinc-900">Go</button>; }`,
    "/src/lib/utils.ts": `export const cn = (...xs: string[]) => xs.join(" ");`,
    "/src/index.css": `@import "tailwindcss";\n@import "tw-animate-css";\n@theme inline { --color-primary: var(--amber-accent); }`,
  };
  const p = { amberApp: 1 as const, files, compiled: {} as Record<string, string> };
  assert(isReact(p));
  const t0 = performance.now();
  for (const f of Object.keys(files).filter((f) => /\.tsx?$/.test(f))) { const r = await compile(f, files[f], "react"); assert("code" in r); p.compiled[f] = r.code; }
  const t1 = performance.now();
  const linked = await linkProject(p);
  const t2 = performance.now();
  console.log(`compile ${Math.round(t1 - t0)} ms (4 files), link + tailwind ${Math.round(t2 - t1)} ms (tailwind ${linked.ms.tailwind} ms)`);
  const c = linked.project.compiled;
  assertStringIncludes(c["/src/main.tsx"], `from "/src/App.tsx"`);
  assertStringIncludes(c["/src/main.tsx"], `l.href = "/src/index.css"`);
  assertStringIncludes(c["/src/main.tsx"], `from "react/jsx-runtime"`);
  assertStringIncludes(c["/src/App.tsx"], `from "/src/lib/utils.ts"`);
  assertStringIncludes(c["/src/App.tsx"], `from "/src/components/ui/button.tsx"`);
  for (const cls of [".flex", ".p-4", ".bg-primary", "md\\:grid-cols-3", "dark\\:bg-zinc-900"]) assertStringIncludes(c["/src/index.css"], cls);
  assertEquals(brokenImports(linked.project), []);
  // Linking again changes nothing.
  assertEquals((await linkProject(linked.project)).project.compiled, c);
});
