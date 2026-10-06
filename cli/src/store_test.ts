import { assert, assertEquals } from "@std/assert";

const dir = await Deno.makeTempDir();
Deno.env.set("XDG_CONFIG_HOME", dir);
Deno.env.set("AMBER_KEYCHAIN_SERVICE", `amber-cli-unit-${crypto.randomUUID().slice(0, 8)}`);
const store = await import("./store.ts");
const CREDS = { access_token: "amb_at_x", refresh_token: "amb_rt_y", expires_at: 1, client_id: "c" };

Deno.test("credentials on Linux (and with AMBER_NO_KEYCHAIN): a file only you can read", async () => {
  Deno.env.set("AMBER_NO_KEYCHAIN", "1");
  try {
    await store.saveCredentials("https://a", CREDS);
    await store.saveCredentials("https://b", { access_token: "pane_z" });
    assertEquals(await store.loadCredentials("https://a"), CREDS);
    assertEquals((await Deno.stat(`${dir}/amber/credentials.json`)).mode! & 0o777, 0o600);
    assertEquals((await Deno.stat(`${dir}/amber`)).mode! & 0o777, 0o700);
    await store.deleteCredentials("https://a");
    assertEquals(await store.loadCredentials("https://a"), null);
    assertEquals(await store.loadCredentials("https://b"), { access_token: "pane_z" });
  } finally {
    Deno.env.delete("AMBER_NO_KEYCHAIN");
  }
});

Deno.test({ name: "credentials on macOS: the Keychain, nothing on disk", ignore: Deno.build.os !== "darwin", fn: async () => {
  await store.saveCredentials("https://k", CREDS);
  try {
    assertEquals(await store.loadCredentials("https://k"), CREDS);
    await store.saveCredentials("https://k", { ...CREDS, access_token: "amb_at_2" });
    assertEquals((await store.loadCredentials("https://k"))?.access_token, "amb_at_2");
    const onDisk = await Array.fromAsync(Deno.readDir(`${dir}/amber`)).catch(() => []);
    for (const f of onDisk) assert(!(await Deno.readTextFile(`${dir}/amber/${f.name}`).catch(() => "")).includes("amb_at_2"));
  } finally {
    await store.deleteCredentials("https://k");
  }
  assertEquals(await store.loadCredentials("https://k"), null);
} });

Deno.test("the refresh lock lets one holder in at a time", async () => {
  const order: string[] = [];
  const holder = (n: number) => store.withLock(async () => { order.push(`in ${n}`); await new Promise((r) => setTimeout(r, 30)); order.push(`out ${n}`); });
  // Separate processes are what matter; flock is per open file, so two opens in one process exercise it too.
  await Promise.all([holder(1), holder(2)]);
  assertEquals(order.length, 4);
  assert(order[1].startsWith("out") && order[2].startsWith("in"), order.join(", "));
});
