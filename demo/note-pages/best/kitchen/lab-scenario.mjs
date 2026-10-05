const tab = (p, id) => p.locator(`[data-tab="${id}"]:visible`).click();
export default async (p, { shot }) => {
  await tab(p, "week"); await p.waitForTimeout(300);
  await p.click('[data-plan]:visible >> nth=2'); await p.waitForTimeout(500);
  await shot("pick");
  await p.click('[data-pick="shakshuka"]'); await p.waitForTimeout(500);
  await p.click('#make'); await p.waitForTimeout(600);
  await shot("list");
  await p.click('#write'); await p.waitForTimeout(700);
  await p.click('[data-line] >> nth=1'); await p.waitForTimeout(300);
  await shot("groceries");
  await tab(p, "recipes"); await p.waitForTimeout(300); await shot("recipes");
  await tab(p, "tonight"); await p.waitForTimeout(300);
  await p.click('.tonight [data-cook]'); await p.waitForTimeout(500);
  await p.click('.cook [data-timer]'); await p.waitForTimeout(1200);
  await shot("cook");
};
