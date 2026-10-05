export default async (p, { shot, log }) => {
  await p.click('.full [data-tick="Read"]'); await p.waitForTimeout(500);
  await p.click('.full [data-tick="Walk"]'); await p.waitForTimeout(500);
  await p.click('.full [data-tick="Stretch"]'); await p.waitForTimeout(300);
  await p.click('.full [data-tick="No phone in bed"]'); await p.waitForTimeout(300);
  await shot("all-done");
  await p.click('.full [data-tick="Stretch"]'); await p.waitForTimeout(500);
  await p.click('[data-bell="Stretch"]'); await p.waitForTimeout(400);
  await shot("ticked");
  await p.click('[data-open="Read"]'); await p.waitForTimeout(600);
  await shot("sheet");
  await p.click('[data-goal="-1"]'); await p.waitForTimeout(300);
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  await p.click('#add'); await p.waitForTimeout(500);
  await p.fill('#hn', 'Drink water'); await p.click('#nh button'); await p.waitForTimeout(600);
  await shot("added");
};
