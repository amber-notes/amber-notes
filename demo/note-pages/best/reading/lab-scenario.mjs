export default async (p, { shot }) => {
  await p.click('[data-page]'); await p.waitForTimeout(500);
  await p.fill('#pg', '348'); await p.click('#save'); await p.waitForTimeout(700);
  await shot("paged");
  await p.click('#add'); await p.waitForTimeout(500);
  await p.fill('#q', 'Pippi Longstocking'); await p.click('#sf button'); await p.waitForTimeout(6000);
  await shot("search");
  await p.click('[data-pick="0"]'); await p.waitForTimeout(800);
  await shot("added");
  await p.click('[data-book]'); await p.waitForTimeout(600);
  await shot("book");
};
