// The bundled libraries the AI is taught match what the app ships.
//   cd supabase/functions/mcp && deno test -A libraries.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { BUNDLED } from "./libraries.ts";
import { BUNDLED_LIBS } from "./page.ts";

Deno.test("names, globals, versions and source files match page.ts and the app's manifest", async () => {
  assertEquals(Object.fromEntries(BUNDLED.map((b) => [b.name, b.global])), BUNDLED_LIBS);
  const manifest = JSON.parse(await Deno.readTextFile(new URL("../../../Pane/Resources/AppLibraries/libraries.json", import.meta.url))).libraries as { name: string; version: string; source: string }[];
  assertEquals(BUNDLED.map((b) => [b.name, b.version, b.npm]).sort(), manifest.map((m) => [m.name, m.version, m.source.split("/npm/")[1]]).sort());
});
