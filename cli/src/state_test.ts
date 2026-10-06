import { assertEquals, assertRejects } from "@std/assert";
import { emptyState, hashOf, loadState, saveState, stateFile } from "./state.ts";

Deno.test("the state file round-trips, is replaced whole, and belongs to one server", async () => {
  const dir = await Deno.makeTempDir();
  assertEquals(await loadState(dir, "https://a"), emptyState("https://a"));
  const s = emptyState("https://a");
  s.notes["n1"] = { path: "Work/Acme.md", remotePath: "Work/Acme.md", version: "3", hash: await hashOf("Acme\n") };
  await saveState(dir, s);
  assertEquals(await loadState(dir, "https://a"), s);
  assertEquals([...Deno.readDirSync(`${dir}/.amber`)].map((e) => e.name), ["state.json"]);
  await assertRejects(() => loadState(dir, "https://b"), Error, "syncs with https://a");
  await Deno.writeTextFile(stateFile(dir), JSON.stringify({ format: 9 }));
  await assertRejects(() => loadState(dir, "https://a"), Error, "isn't a state file");
});

Deno.test("hashes are sha-256 hex", async () => {
  assertEquals(await hashOf(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
