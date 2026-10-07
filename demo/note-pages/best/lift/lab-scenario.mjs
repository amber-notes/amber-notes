// A workout, start to finish, then every tab, with the new pieces: reorder, rep maxes, update the routine.
const tab = (p, name) => p.getByRole("link", { name, exact: true }).last().click();
export default async (p, { shot }) => {
  await shot("home");
  await p.getByRole("button", { name: "Start", exact: true }).first().click(); await p.waitForTimeout(500);
  await shot("live");
  const tick = (i) => p.getByRole("button", { name: / not done$/ }).nth(i);
  await tick(0).click(); await p.waitForTimeout(300); await tick(0).click(); await p.waitForTimeout(300);
  await tick(0).click(); await p.waitForTimeout(600);
  await shot("rest");
  await p.getByRole("button", { name: "Skip", exact: true }).click(); await p.waitForTimeout(300);
  await p.getByRole("button", { name: /^Set 2, working set/ }).first().click(); await p.waitForTimeout(400);
  await shot("settype");
  await p.getByRole("button", { name: "Drop set" }).click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Add exercises" }).click(); await p.waitForTimeout(500);
  await p.getByRole("searchbox", { name: "Search exercises" }).fill("hammer"); await p.waitForTimeout(300);
  await p.getByRole("checkbox", { name: "Choose Hammer Curl" }).check(); await p.waitForTimeout(200);
  await shot("picker");
  await p.getByRole("button", { name: "Add 1" }).click(); await p.waitForTimeout(500);
  await p.getByRole("button", { name: "Reorder", exact: true }).click(); await p.waitForTimeout(500);
  // Drag the last exercise to the top by its handle.
  const handles = p.getByRole("button", { name: "Drag to reorder" });
  const n = await handles.count(), from = await handles.nth(n - 1).boundingBox(), to = await handles.nth(0).boundingBox();
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down();
  for (let k = 1; k <= 12; k++) { await p.mouse.move(from.x + from.width / 2, from.y + (to.y - from.y) * (k / 12) - 6); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(400);
  await shot("reorder");
  await p.getByRole("button", { name: "Done", exact: true }).click(); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Finish", exact: true }).first().click(); await p.waitForTimeout(400);
  await shot("finishask");
  await p.getByRole("dialog").getByRole("button", { name: "Finish" }).click(); await p.waitForTimeout(900);
  await shot("done");
  const upd = p.getByRole("button", { name: /^Update / });
  if (await upd.count()) { await upd.click(); await p.waitForTimeout(500); await shot("updated"); }
  await p.getByRole("button", { name: "Done", exact: true }).click(); await p.waitForTimeout(300);
  await tab(p, "History"); await p.waitForTimeout(400); await shot("history");
  await tab(p, "Exercises"); await p.waitForTimeout(300); await shot("library");
  await p.locator('a[href="#/exercise/bench-press"]').click(); await p.waitForTimeout(500); await shot("exercise");
  await p.getByRole("button", { name: "Rep maxes" }).click(); await p.waitForTimeout(300); await shot("repmax");
  await tab(p, "Progress"); await p.waitForTimeout(500); await shot("progress");
  await tab(p, "Settings"); await p.waitForTimeout(300); await shot("settings");
  await p.getByRole("button", { name: "Export CSV" }).click(); await p.waitForTimeout(400);
  await tab(p, "Workout"); await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Edit" }).first().click(); await p.waitForTimeout(400); await shot("routine");
};
