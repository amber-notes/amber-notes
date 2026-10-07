// Screenshots of signing in, in light and dark: a real `amber login` whose browser is headless Chrome
// (muted, no window), showing the consent page (the local stand-in) and the page amber shows when
// the browser comes back. Writes PNGs to --out.
//
//   deno run -A e2e/screens.ts --out <dir>
import { parseArgs } from "@std/cli/parse-args";
import puppeteer from "npm:puppeteer-core@23.11.1";

const { out } = parseArgs(Deno.args, { string: ["out"] });
if (!out) throw new Error("--out <dir>");
await Deno.mkdir(out, { recursive: true });
const cli = new URL("..", import.meta.url).pathname;
const arch = Deno.build.arch === "aarch64" ? "arm64" : "x64";
const bin = `${cli}dist/amber-macos-${arch}`;
const work = await Deno.makeTempDir({ prefix: "amber-screens-" });

const l = Deno.listen({ port: 0, hostname: "127.0.0.1" });
const port = (l.addr as Deno.NetAddr).port;
l.close();
const origin = `http://127.0.0.1:${port}`;
const srv = new Deno.Command(Deno.execPath(), { args: ["run", "-A", `${cli}e2e/local_server.ts`, "--port", String(port)], stdout: "null", stderr: "null" }).spawn();
for (let i = 0; i < 240; i++) {
  try { if ((await fetch(`${origin}/__ready`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 250));
}
// The "browser" amber opens just hands the address to this script.
await Deno.writeTextFile(`${work}/browser.sh`, `#!/bin/sh\nprintf '%s' "$1" > "${work}/url"\n`, { mode: 0o755 });

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--mute-audio", "--no-first-run", "--no-default-browser-check"] });
try {
  for (const scheme of ["light", "dark"] as const) {
    await Deno.remove(`${work}/url`).catch(() => {});
    const login = new Deno.Command(bin, { args: ["login"], env: { HOME: Deno.env.get("HOME")!, PATH: Deno.env.get("PATH")!, XDG_CONFIG_HOME: `${work}/config`, AMBER_SERVER: `${origin}/mcp`, AMBER_KEYCHAIN_SERVICE: "amber-cli-screens", AMBER_BROWSER: `${work}/browser.sh` }, clearEnv: true, stdout: "piped", stderr: "piped" }).spawn();
    let url = "";
    for (let i = 0; i < 100 && !url; i++) { url = await Deno.readTextFile(`${work}/url`).catch(() => ""); await new Promise((r) => setTimeout(r, 100)); }
    const page = await browser.newPage();
    await page.setViewport({ width: 520, height: 720, deviceScaleFactor: 2 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.screenshot({ path: `${out}/consent-${scheme}.png` });
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#allow")]);
    await page.screenshot({ path: `${out}/signed-in-${scheme}.png` });
    await page.close();
    const o = await login.output();
    console.log(`${scheme}: amber login exited ${o.code}`);
  }
} finally {
  await browser.close();
  await new Deno.Command(bin, { args: ["logout"], env: { HOME: Deno.env.get("HOME")!, PATH: Deno.env.get("PATH")!, XDG_CONFIG_HOME: `${work}/config`, AMBER_SERVER: `${origin}/mcp`, AMBER_KEYCHAIN_SERVICE: "amber-cli-screens" }, clearEnv: true, stdout: "null", stderr: "null" }).output();
  srv.kill("SIGTERM");
  await srv.status;
  await new Deno.Command("/usr/bin/security", { args: ["delete-generic-password", "-s", "amber-cli-screens"], stdout: "null", stderr: "null" }).output().catch(() => {});
  await Deno.remove(work, { recursive: true });
}
