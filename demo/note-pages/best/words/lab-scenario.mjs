export default async (p, { shot }) => {
  await p.click('#play'); await p.waitForTimeout(300);
  const match = async () => p.evaluate(() => { const L = game.left[0]; const R = game.right.findIndex((w) => w.q === L.q); return [0, R]; });
  for (let i = 0; i < 5; i++) { const [l, r] = await match(); await p.click(`[data-side="l"][data-k="${l}"]`); await p.click(`[data-side="r"][data-k="${r}"]`); await p.waitForTimeout(420); }
  await shot("play");
  // one miss
  const [l, r] = await match(); await p.click(`[data-side="l"][data-k="${l}"]`); await p.click(`[data-side="r"][data-k="${(r + 1) % 5}"]`); await p.waitForTimeout(400);
  await p.keyboard.press("1"); const rr = await p.evaluate(() => game.right.findIndex((w) => w.q === game.left[0].q)); await p.keyboard.press("ASDFG"[rr]); await p.waitForTimeout(400);
  await p.evaluate(() => { game.ends = Date.now() + 200; }); await p.waitForTimeout(900);
  await shot("result");
};
