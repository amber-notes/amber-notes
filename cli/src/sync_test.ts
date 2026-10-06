// The sync against an account in memory (fake_remote.ts): both directions, moves, deletes, and
// conflicts, where nothing may be lost.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { FakeRemote } from "./fake_remote.ts";
import { type Mode, scan, syncOnce } from "./sync.ts";

const SERVER = "https://test";
const NOW = () => new Date(2026, 9, 6, 12);
const files = async (dir: string) => Object.fromEntries([...(await scan(dir))].map(([p, l]) => [p, l.text]).sort());
const pass = (dir: string, remote: FakeRemote, mode: Mode = "sync", force = false) => syncOnce({ dir, server: SERVER, remote, mode, now: NOW, force });

async function setup() {
  const dir = await Deno.makeTempDir();
  const remote = new FakeRemote();
  const g = remote.add("", "Groceries\n\n- [ ] Milk\n\nSee [[Recipes]].\n");
  const a = remote.add("Work", "# Acme\n\nKickoff Monday.\n");
  return { dir, remote, g, a };
}

Deno.test("pull mirrors every note as Folder/Title.md, [[links]] as written", async () => {
  const { dir, remote } = await setup();
  const r = await pass(dir, remote, "pull");
  assertEquals(r.down.sort(), ["Groceries.md", "Work/Acme.md"]);
  assertEquals(await files(dir), { "Groceries.md": "Groceries\n\n- [ ] Milk\n\nSee [[Recipes]].\n", "Work/Acme.md": "# Acme\n\nKickoff Monday.\n" });
  assertEquals((await pass(dir, remote, "pull")).down, []);
});

Deno.test("pull never changes the account", async () => {
  const { dir, remote, g } = await setup();
  await pass(dir, remote, "pull");
  await Deno.writeTextFile(`${dir}/Groceries.md`, "Groceries\n\n- [x] Milk\n");
  await Deno.writeTextFile(`${dir}/New.md`, "New\n");
  await Deno.remove(`${dir}/Work/Acme.md`);
  remote.calls = [];
  const r = await pass(dir, remote, "pull");
  assert(remote.calls.every((c) => c === "list" || c.startsWith("read")), remote.calls.join());
  assertEquals(remote.notes.get(g)!.text, "Groceries\n\n- [ ] Milk\n\nSee [[Recipes]].\n");
  assertEquals((await files(dir))["Work/Acme.md"], "# Acme\n\nKickoff Monday.\n");
  assert(r.pending.some((p) => p.startsWith("Groceries.md")) && r.pending.some((p) => p.startsWith("New.md")));
});

Deno.test("sync both ways: edits, new files and notes, moves and deletes", async () => {
  const { dir, remote, g, a } = await setup();
  await pass(dir, remote);

  // Here → Amber.
  await Deno.writeTextFile(`${dir}/Groceries.md`, "Groceries\n\n- [x] Milk\n\nSee [[Recipes]].\n");
  await Deno.mkdir(`${dir}/Ideas`);
  await Deno.writeTextFile(`${dir}/Ideas/Garden.md`, "- tomatoes\n");
  let r = await pass(dir, remote);
  assertEquals(r.up, ["Groceries.md"]);
  assertEquals(remote.notes.get(g)!.text, "Groceries\n\n- [x] Milk\n\nSee [[Recipes]].\n");
  assertEquals(r.created, ["Ideas/Garden.md"]);
  assertEquals(remote.byPath("Ideas/Garden.md")!.text, "Garden\n\n- tomatoes\n");
  assertEquals((await files(dir))["Ideas/Garden.md"], "Garden\n\n- tomatoes\n");

  // Amber → here, a rename included.
  remote.change(a, "# Acme Corp\n\nKickoff Tuesday.\n");
  const t = remote.add("Travel", "Trip\n\nLisbon.\n");
  r = await pass(dir, remote);
  assertEquals(r.down.sort(), ["Travel/Trip.md", "Work/Acme Corp.md"]);
  const now = await files(dir);
  assertEquals(now["Work/Acme Corp.md"], "# Acme Corp\n\nKickoff Tuesday.\n");
  assertEquals(now["Work/Acme.md"], undefined);

  // A move here goes up; one in Amber comes down.
  await Deno.mkdir(`${dir}/Archive`);
  await Deno.rename(`${dir}/Ideas/Garden.md`, `${dir}/Archive/Garden.md`);
  remote.notes.get(t)!.folder = "Work"; remote.notes.get(t)!.version++;
  r = await pass(dir, remote);
  assertEquals(r.moved, ["Ideas/Garden.md → Archive/Garden.md"]);
  assertEquals(remote.byPath("Archive/Garden.md")?.text, "Garden\n\n- tomatoes\n");
  assertEquals(Object.keys(await files(dir)).sort(), ["Archive/Garden.md", "Groceries.md", "Work/Acme Corp.md", "Work/Trip.md"]);

  // Deletes both ways; Amber's delete keeps a copy in .amber/trash.
  await Deno.remove(`${dir}/Groceries.md`);
  remote.notes.delete(t);
  r = await pass(dir, remote);
  assertEquals(remote.notes.has(g), false);
  assertEquals(Object.keys(await files(dir)).sort(), ["Archive/Garden.md", "Work/Acme Corp.md"]);
  assertEquals(await Deno.readTextFile(`${dir}/.amber/trash/2026-10-06/Work/Trip.md`), "Trip\n\nLisbon.\n");
  assertEquals((await pass(dir, remote)).up.length + (await pass(dir, remote)).down.length, 0);
});

Deno.test("a note changed on both sides: both versions are kept, as two notes", async () => {
  const { dir, remote, a } = await setup();
  await pass(dir, remote);
  await Deno.writeTextFile(`${dir}/Work/Acme.md`, "# Acme\n\nKickoff Monday. Bring slides.\n");
  remote.change(a, "# Acme\n\nKickoff moved to Wednesday.\n");
  const r = await pass(dir, remote);
  assertEquals(r.conflicts, ["Work/Acme.md: this folder's text kept as Work/Acme (conflict 2026-10-06).md"]);
  const f = await files(dir);
  assertEquals(f["Work/Acme.md"], "# Acme\n\nKickoff moved to Wednesday.\n");
  assertEquals(f["Work/Acme (conflict 2026-10-06).md"], "# Acme (conflict 2026-10-06)\n\nKickoff Monday. Bring slides.\n");
  // The copy is a note in Amber too, so every device sees both.
  assertEquals(remote.byPath("Work/Acme (conflict 2026-10-06).md")?.text, "# Acme (conflict 2026-10-06)\n\nKickoff Monday. Bring slides.\n");
  assertEquals(remote.notes.get(a)!.text, "# Acme\n\nKickoff moved to Wednesday.\n");
});

Deno.test("the same change on both sides is no conflict", async () => {
  const { dir, remote, a } = await setup();
  await pass(dir, remote);
  await Deno.writeTextFile(`${dir}/Work/Acme.md`, "# Acme\n\nSame.\n");
  remote.change(a, "# Acme\n\nSame.\n");
  assertEquals((await pass(dir, remote)).conflicts, []);
});

Deno.test("deleted on one side, changed on the other: the change wins and nothing is lost", async () => {
  const { dir, remote, g, a } = await setup();
  await pass(dir, remote);
  await Deno.remove(`${dir}/Groceries.md`);
  remote.change(g, "Groceries\n\n- [ ] Oat milk\n");
  await Deno.writeTextFile(`${dir}/Work/Acme.md`, "# Acme\n\nMine.\n");
  remote.notes.delete(a);
  const r = await pass(dir, remote);
  assertEquals((await files(dir))["Groceries.md"], "Groceries\n\n- [ ] Oat milk\n");
  assert(remote.notes.has(g));
  assertEquals(r.conflicts, ["Work/Acme.md: deleted in Amber, changed here; kept and sent as a new note"]);
  assertEquals(remote.byPath("Work/Acme.md")?.text, "# Acme\n\nMine.\n");
});

Deno.test("files already in the folder: identical ones are adopted, different ones kept as conflict copies", async () => {
  const { dir, remote } = await setup();
  await Deno.mkdir(`${dir}/Work`);
  await Deno.writeTextFile(`${dir}/Groceries.md`, "Groceries\n\n- [ ] Milk\n\nSee [[Recipes]].\n");
  await Deno.writeTextFile(`${dir}/Work/Acme.md`, "# Acme\n\nMy older copy.\n");
  const r = await pass(dir, remote);
  assertEquals(r.conflicts, ["Work/Acme.md: this folder's file kept as Work/Acme (conflict 2026-10-06).md"]);
  assertEquals(r.created, ["Work/Acme (conflict 2026-10-06).md"]);
  assertEquals(remote.notes.size, 3);
});

Deno.test("two notes with one title get two files", async () => {
  const { dir, remote } = await setup();
  const b = remote.add("Work", "# Acme\n\nAnother.\n");
  await pass(dir, remote);
  assertEquals(Object.keys(await files(dir)).sort(), ["Groceries.md", "Work/Acme (" + b.slice(0, 8) + ").md", "Work/Acme.md"]);
});

Deno.test("a sub-note lives in its parent's folder, and a file made there becomes one", async () => {
  const { dir, remote, a } = await setup();
  const s = remote.add("", "Agenda\n- intro\n");
  remote.notes.get(s)!.parent = a;
  await pass(dir, remote);
  assertEquals((await files(dir))["Work/Acme/Agenda.md"], "Agenda\n- intro\n");
  await Deno.writeTextFile(`${dir}/Work/Acme/Notes.md`, "Notes\n");
  await pass(dir, remote);
  assertEquals(remote.byPath("Work/Acme/Notes.md")?.parent, a);
});

Deno.test("most notes gone at once stops the sync until --force", async () => {
  const { dir, remote } = await setup();
  for (let i = 0; i < 10; i++) remote.add("Bulk", `Note ${i}\n`);
  await pass(dir, remote);
  await Deno.remove(`${dir}/Bulk`, { recursive: true });
  await assertRejects(() => pass(dir, remote), Error, "Is the folder mounted?");
  assertEquals(remote.notes.size, 12);
  await pass(dir, remote, "sync", true);
  assertEquals(remote.notes.size, 2);
});
