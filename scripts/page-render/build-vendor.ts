// ES modules for the React stack (React on preact/compat, shadcn/ui's dependencies, lucide), for the
// renderer until the app ships its own (Pane/Resources/AppLibraries): each bundled once from npm,
// with react, react-dom and preact left as bare names so the import map gives every module the same
// single copy.
//   deno run -A scripts/page-render/build-vendor.ts
const PREACT = "10.24.3";
const out = new URL("./vendor/", import.meta.url);
const tmp = await Deno.makeTempDir({ prefix: "amber-vendor-" });
const EXTERNAL = ["preact", "preact/hooks", "preact/jsx-runtime", "react", "react-dom", "react/jsx-runtime", "react-dom/client"];
// name in the import map → the entry module's source
const ENTRIES: Record<string, string> = {
  react: `export * from "npm:preact@${PREACT}/compat"; export { default } from "npm:preact@${PREACT}/compat";`,
  clsx: `export * from "npm:clsx@2.1.1"; export { default } from "npm:clsx@2.1.1";`,
  "tailwind-merge": `export * from "npm:tailwind-merge@3.3.1";`,
  "class-variance-authority": `export * from "npm:class-variance-authority@0.7.1";`,
  "lucide-react": `export * from "npm:lucide-react@0.544.0";`,
  "@radix-ui/react-slot": `export * from "npm:@radix-ui/react-slot@1.2.3";`,
};
// Written by hand: thin layers over "react" (compat) and preact, so there's one compat.
const DIRECT: Record<string, string> = {
  "react-dom": `export * from "react"; export { default } from "react";\n`,
  "react-dom/client": `import { render, hydrate, unmountComponentAtNode } from "react";\nexport function createRoot(container) { return { render(children) { render(children, container); }, unmount() { unmountComponentAtNode(container); } }; }\nexport function hydrateRoot(container, children) { hydrate(children, container); return createRoot(container); }\n`,
  "react/jsx-runtime": `import "react";\nexport { jsx, jsxs, jsxDEV, Fragment } from "preact/jsx-runtime";\n`,
};
const file = (name: string) => name.replace(/[@/]/g, (c) => (c === "/" ? "__" : "")) + ".js";
await Deno.mkdir(out, { recursive: true });
// npm packages import "react" etc.; map those to the bare names left external.
await Deno.writeTextFile(`${tmp}/deno.json`, JSON.stringify({ imports: { react: "react", "react-dom": "react-dom", "react/jsx-runtime": "react/jsx-runtime" } }));
for (const [name, src] of Object.entries(ENTRIES)) {
  await Deno.writeTextFile(`${tmp}/entry.ts`, src);
  const p = await new Deno.Command("deno", { args: ["bundle", "--quiet", "--platform", "browser", "--format", "esm", "--minify", ...EXTERNAL.flatMap((e) => ["--external", e]), "-o", new URL(file(name), out).pathname, `${tmp}/entry.ts`], cwd: tmp, stderr: "piped" }).output();
  if (!p.success) throw new Error(`${name}: ${new TextDecoder().decode(p.stderr).slice(0, 800)}`);
}
for (const [name, src] of Object.entries(DIRECT)) await Deno.writeTextFile(new URL(file(name), out), src);
const names = [...Object.keys(ENTRIES), ...Object.keys(DIRECT)];
await Deno.writeTextFile(new URL("vendor.json", out), JSON.stringify(Object.fromEntries(names.map((n) => [n, file(n)])), null, 1) + "\n");
await Deno.remove(tmp, { recursive: true });
for (const n of names) console.log(n.padEnd(26), (await Deno.stat(new URL(file(n), out))).size);
