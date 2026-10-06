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
