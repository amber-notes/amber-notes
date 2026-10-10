export default async (p, { shot }) => {
  await p.waitForTimeout(1500);
  const box = await p.locator('#gl').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 12 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  await shot("turned");
  await p.focus('#gl'); await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowRight"); await p.keyboard.press("Enter"); await p.waitForTimeout(1600);
  await shot("picked");
  await p.click('[data-st="Want to read"]'); await p.waitForTimeout(1800);
  await shot("moved");
  console.log("FPS " + await p.evaluate(() => window.__fps));
};
