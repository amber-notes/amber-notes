export default async (p, { shot }) => {
  await p.click('[data-talked]'); await p.waitForTimeout(1200);
  await p.click('[data-k="Coffee"]'); await p.fill('#nt', 'She got the job in Göteborg. Visit in March.'); await p.click('#nf button.primary'); await p.waitForTimeout(600);
  await shot("talked");
  await p.click('[data-remind]'); await p.waitForTimeout(400);
  await p.click('.list.inset [data-person]'); await p.waitForTimeout(600);
  await shot("person");
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  await p.click('#add'); await p.waitForTimeout(600);
  await p.click('#af button.primary'); await p.waitForTimeout(600);
  await shot("added");
};
