export default async (p, { shot }) => {
  await p.click('#play'); await p.waitForTimeout(900);
  await p.click('.pad[data-r="1"][data-c="3"]'); await p.waitForTimeout(300);
  await p.click('.pad[data-r="5"][data-c="2"]'); await p.waitForTimeout(300);
  await p.click('.pad[data-r="5"][data-c="2"]'); await p.waitForTimeout(500);
  await shot("playing");
  await p.click('[data-pat="1"]'); await p.waitForTimeout(700);
  await p.keyboard.press("ArrowRight"); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  await shot("fill");
  await p.click('#play');
};
