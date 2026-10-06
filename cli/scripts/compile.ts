// Single binaries for macOS and Linux, Apple silicon / arm64 and Intel / x64, in cli/dist/.
//   deno task compile
const targets = [
  ["x86_64-unknown-linux-gnu", "amber-linux-x64"],
  ["aarch64-unknown-linux-gnu", "amber-linux-arm64"],
  ["aarch64-apple-darwin", "amber-macos-arm64"],
  ["x86_64-apple-darwin", "amber-macos-x64"],
];
const root = new URL("..", import.meta.url).pathname;
for (const [target, name] of targets) {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["compile", "--no-lock", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "--target", target, "--output", `dist/${name}`, "main.ts"],
    cwd: root, stdout: "inherit", stderr: "inherit",
  }).output();
  if (!out.success) Deno.exit(out.code);
}
// SHA256SUMS, which install.sh and the Homebrew formula check against.
const sums: string[] = [];
for (const [, name] of targets) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(`${root}dist/${name}`)));
  sums.push(`${Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("")}  ${name}`);
}
await Deno.writeTextFile(`${root}dist/SHA256SUMS`, sums.join("\n") + "\n");
