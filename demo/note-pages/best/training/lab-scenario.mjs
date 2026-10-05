export default async (p, { shot }) => {
  await p.click('#start'); await p.waitForTimeout(500);
  await p.click('[data-set="0.0"]'); await p.waitForTimeout(1200);
  await shot("rest");
  await p.click('[data-rest="0"]');
  for (const s of ["0.1","0.2","0.3","0.4","1.0","1.1"]) { await p.click(`[data-set="${s}"]`); await p.waitForTimeout(150); }
  await p.click('#finish'); await p.waitForTimeout(800);
  await shot("finished");
};
