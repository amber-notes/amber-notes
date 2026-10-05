export default async (p, { shot, wide }) => {
  await shot("today");
  await p.click('#start'); await p.waitForTimeout(500);
  await shot("set");
  await p.click('[data-adj="kg"][data-d="1"]'); await p.waitForTimeout(200);
  await p.click('#done'); await p.waitForTimeout(600);
  await shot("rest");
  await p.click('#skip'); await p.waitForTimeout(300);
  for (let i = 0; i < 4; i++) { await p.click('#done'); await p.waitForTimeout(200); await p.click('#skip'); await p.waitForTimeout(200); }
  await p.click('#finish'); await p.waitForTimeout(700);
  await shot("record");
  await p.locator('[data-tab="plan"]:visible').click(); await p.waitForTimeout(400);
  await shot("plan");
  await p.click('[data-plan="0"]'); await p.waitForTimeout(400);
  await p.click('[data-ed="sets"][data-i="0"][data-d="1"]'); await p.waitForTimeout(300);
  await shot("editor");
  await p.click('[data-pop]'); await p.waitForTimeout(300);
  await p.locator('[data-tab="progress"]:visible').click(); await p.waitForTimeout(500);
  await shot("progress");
};
