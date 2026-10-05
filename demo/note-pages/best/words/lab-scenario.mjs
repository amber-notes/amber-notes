export default async (p, { shot }) => {
  await p.click('#play'); await p.waitForTimeout(300);
  const match = async () => p.evaluate(() => { const L = game.left[0]; const R = game.right.findIndex((w) => w.q === L.q); return [0, R]; });
  for (let i = 0; i < 4; i++) { const [l, r] = await match(); await p.click(`[data-side="l"][data-k="${l}"]`); await p.click(`[data-side="r"][data-k="${r}"]`); await p.waitForTimeout(420); }
  const [l, r] = await match(); await p.click(`[data-side="l"][data-k="${l}"]`); await p.click(`[data-side="r"][data-k="${(r + 1) % 5}"]`); await p.waitForTimeout(500);
  await shot("play");
  await p.evaluate(() => { game.ends = Date.now() + 200; }); await p.waitForTimeout(900);
  await shot("result");
};
