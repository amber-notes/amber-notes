const tab = (p, id) => p.locator(`[data-tab="${id}"]:visible`).click();
export default async (p, { shot }) => {
  await p.click('#study'); await p.waitForTimeout(700);
  await shot("front");
  await p.click('#turn'); await p.waitForTimeout(700);
  await shot("back");
  for (let i = 0; i < 2; i++) { await p.click('[data-grade="4"]'); await p.waitForTimeout(500); await p.click('#turn'); await p.waitForTimeout(600); }
  await p.click('[data-grade="1"]'); await p.waitForTimeout(500);
  await p.click('[data-end]'); await p.waitForTimeout(600);
  await tab(p, "cards"); await p.waitForTimeout(300);
  await p.click('#suggest'); await p.waitForTimeout(600);
  await p.click('[data-sug="0"]'); await p.waitForTimeout(500);
  await shot("cards");
};
