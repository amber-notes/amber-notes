const tab = (p, id) => p.locator(`[data-tab="${id}"]:visible`).click();
export default async (p, { shot }) => {
  await p.waitForTimeout(1500);
  await p.click('[data-day]:nth-child(2)'); await p.waitForTimeout(1200);
  await shot("day2");
  await tab(p, "packing"); await p.waitForTimeout(300);
  await p.click('[data-line]'); await p.waitForTimeout(400);
  await p.fill('#pi', 'Swimsuit'); await p.press('#pi', 'Enter'); await p.waitForTimeout(500);
  await shot("packing");
  await tab(p, "costs"); await p.waitForTimeout(300);
  await p.click('#addcost'); await p.waitForTimeout(500);
  await p.fill('#cw', 'Dinner at Da Remo'); await p.fill('#ca', '1140'); await p.click('[data-by="Linnea"]');
  await shot("addcost");
  await p.click('#cf button.primary'); await p.waitForTimeout(600);
  await shot("costs");
};
