// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import Library, { APPS } from "./Library";

const items = [{ slug: "habits", category: "Habits and health", app: true }, { slug: "groceries", category: "Home and life" }];
const cards = items.map((i) => <span key={i.slug}>{i.slug}</span>);
const categories = (withApps: boolean) => [
  ...(withApps ? [{ name: "Apps", anchor: APPS, count: 1 }] : []),
  { name: "Home and life", anchor: "home-and-life", count: 1 },
];

async function shown(search: string, withApps: boolean) {
  history.replaceState(null, "", `/templates${search}`);
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => { createRoot(el).render(<Library items={items} cards={cards} categories={categories(withApps)} />); });
  return [...el.querySelectorAll("li")].filter((li) => !li.hidden).map((li) => li.textContent);
}

describe("the templates gallery's Apps filter", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("shows only templates that hold an app, from ?category=apps", async () => {
    expect(await shown("?category=apps", true)).toEqual(["habits"]);
  });

  it("shows every template when no template holds an app yet", async () => {
    expect(await shown("?category=apps", false)).toEqual(["habits", "groceries"]);
  });
});
