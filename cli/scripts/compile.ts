// Single binaries for Linux (x64, arm64) and macOS (Apple silicon), in cli/dist/.
//   deno task compile
const targets = [
  ["x86_64-unknown-linux-gnu", "amber-linux-x64"],
  ["aarch64-unknown-linux-gnu", "amber-linux-arm64"],
  ["aarch64-apple-darwin", "amber-macos-arm64"],
];
const root = new URL("..", import.meta.url).pathname;
for (const [target, name] of targets) {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["compile", "--no-lock", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--target", target, "--output", `dist/${name}`, "main.ts"],
    cwd: root, stdout: "inherit", stderr: "inherit",
  }).output();
  if (!out.success) Deno.exit(out.code);
}
