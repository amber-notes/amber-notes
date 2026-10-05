export default async (p, { shot }) => {
  await p.click('#suggest'); await p.waitForTimeout(600);
  await shot("suggest");
  await p.click('[data-sug="0"]'); await p.waitForTimeout(500);
  await p.click('#study'); await p.waitForTimeout(700);
  await shot("front");
  await p.click('#turn'); await p.waitForTimeout(700);
  await shot("back");
  for (let i = 0; i < 3; i++) { await p.click('[data-grade="4"]'); await p.waitForTimeout(500); await p.click('#turn'); await p.waitForTimeout(600); }
  await p.click('[data-grade="1"]'); await p.waitForTimeout(500);
};
