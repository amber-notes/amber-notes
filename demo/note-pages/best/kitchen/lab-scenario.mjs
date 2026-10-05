export default async (p, { shot }) => {
  await p.click('[data-plan]:not(.today) >> nth=2'); await p.waitForTimeout(500);
  await p.click('[data-pick="shakshuka"]'); await p.waitForTimeout(500);
  await p.click('#make'); await p.waitForTimeout(600);
  await shot("list");
  await p.click('#write'); await p.waitForTimeout(600);
  await p.click('[data-line] >> nth=1'); await p.waitForTimeout(300);
  await shot("written");
  await p.click('.tonight [data-cook]'); await p.waitForTimeout(500);
  await p.click('.cook [data-timer]'); await p.waitForTimeout(1200);
  await shot("cook");
};
