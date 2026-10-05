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
  assertStringIncludes(r, "/src/App.jsx doesn't exist");
  assertStringIncludes(r, `"lodash"`);
  assertStringIncludes(r, "https://esm.sh/x");
  assertStringIncludes(r, "cdn.example");
  assert(!r.includes("preact\""));
  assertStringIncludes(projectProblems({ ...p, files: { "/index.html": `<script type="importmap">{}</script>` } }).join(), "import map");
  assertStringIncludes(projectProblems({ ...p, files: { "/a.js": "" } }).join(), "/index.html");
});
