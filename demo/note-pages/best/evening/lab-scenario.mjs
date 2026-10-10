// Tonight's check-in, start to finish, then the other screens.
export default async function (p, { shot, wide }) {
  await shot("overview", true);
  await p.getByRole("button", { name: "Log today" }).click();
  await shot("1-work");
  await p.getByRole("button", { name: "Work hours: more", exact: true }).click();
  await p.getByRole("button", { name: "Next" }).click();
  for (const [g, n] of [["Energy", 7], ["Mood", 8], ["Focus / output", 6], ["Sleep quality", 7]]) await p.getByRole("radio", { name: `${g} ${n}`, exact: true }).click();
  await shot("2-rate");
  await p.getByRole("button", { name: "Next" }).click();
  const yes = p.getByRole("radio", { name: /: Yes$/ });
  for (let i = 0, n = await yes.count(); i < n; i++) await (i === 1 ? p.getByRole("radio", { name: /: No$/ }).nth(1) : yes.nth(i)).click();
  await shot("3-habits");
  await p.getByRole("button", { name: "Next" }).click();
  await p.getByLabel("What helped today?").fill("Early gym, phone in the other room");
  await p.getByLabel("What hurt today?").fill("Late meeting ran over");
  await shot("4-reflect");
  await p.getByRole("button", { name: "Next" }).click();
  await p.getByLabel("Win condition").fill("Pricing page live");
  await p.getByLabel("Outcome 1").fill("Copy final");
  await p.getByLabel("Outcome 2").fill("Stripe test passes");
  await p.getByLabel("First task").fill("Write the plan-card copy");
  await p.getByRole("switch", { name: "Alarms and timers set" }).click();
  await shot("5-tomorrow");
  await p.getByRole("button", { name: "Finish" }).click();
  await shot("after", true);
  await p.getByRole("link", { name: "Week" }).last().click();
  await shot("week", true);
  await p.getByRole("link", { name: "Trends" }).last().click();
  await shot("trends", true);
  await p.getByRole("link", { name: "Plan" }).last().click();
  await shot("plan", true);
}
