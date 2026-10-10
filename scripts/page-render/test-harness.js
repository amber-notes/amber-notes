// run_app_tests: a small Vitest- and Testing Library-compatible harness, served to the test page as
// the modules "vitest", "@testing-library/react" (and "/preact"), "@testing-library/user-event" and
// "@testing-library/jest-dom". Enough of each for the tests an app's author writes: describe/it,
// expect with the common and jest-dom matchers, vi.fn, render/screen/queries/waitFor, userEvent.
// It runs in the renderer's sandbox, against a throwaway copy of the app's data.
import { createRoot } from "react-dom/client";
import { createElement } from "react";

// MARK: vitest

const suites = [];
let current = { name: "", tests: [], before: [], after: [], parent: null };
suites.push(current);
export function describe(name, fn) {
  const s = { name, tests: [], before: [], after: [], parent: current };
  current.tests.push({ suite: s });
  const was = current; current = s;
  try { fn(); } finally { current = was; }
}
export function it(name, fn) { current.tests.push({ name, fn }); }
export const test = it;
it.skip = test.skip = () => {};
it.todo = test.todo = () => {};
describe.skip = () => {};
export function beforeEach(fn) { current.before.push(fn); }
export function afterEach(fn) { current.after.push(fn); }

const fmt = (v) => { try { return typeof v === "string" ? JSON.stringify(v) : v instanceof Element ? `<${v.tagName.toLowerCase()}>` : JSON.stringify(v) ?? String(v); } catch { return String(v); } };
const equal = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => equal(a[k], b[k]));
};
const textOf = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const visible = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.hidden) return false; } return true; };

function matchers(actual, not) {
  const check = (pass, msg) => { if (pass === not) throw new Error(`expect(${fmt(actual)})${not ? ".not" : ""}.${msg}`); };
  const m = {
    toBe: (v) => check(Object.is(actual, v), `toBe(${fmt(v)})`),
    toEqual: (v) => check(equal(actual, v), `toEqual(${fmt(v)})`),
    toStrictEqual: (v) => check(equal(actual, v), `toStrictEqual(${fmt(v)})`),
    toBeTruthy: () => check(!!actual, "toBeTruthy()"),
    toBeFalsy: () => check(!actual, "toBeFalsy()"),
    toBeNull: () => check(actual === null, "toBeNull()"),
    toBeUndefined: () => check(actual === undefined, "toBeUndefined()"),
    toBeDefined: () => check(actual !== undefined, "toBeDefined()"),
    toContain: (v) => check(actual?.includes?.(v) ?? false, `toContain(${fmt(v)})`),
    toHaveLength: (n) => check(actual?.length === n, `toHaveLength(${n}), got ${actual?.length}`),
    toMatch: (re) => check(typeof re === "string" ? String(actual).includes(re) : re.test(String(actual)), `toMatch(${re})`),
    toBeGreaterThan: (n) => check(actual > n, `toBeGreaterThan(${n})`),
    toBeGreaterThanOrEqual: (n) => check(actual >= n, `toBeGreaterThanOrEqual(${n})`),
    toBeLessThan: (n) => check(actual < n, `toBeLessThan(${n})`),
    toBeLessThanOrEqual: (n) => check(actual <= n, `toBeLessThanOrEqual(${n})`),
    toBeCloseTo: (n, d = 2) => check(Math.abs(actual - n) < 10 ** -d / 2, `toBeCloseTo(${n})`),
    toThrow: (want) => { let threw = false, err; try { actual(); } catch (e) { threw = true; err = e; } check(threw && (!want || String(err?.message ?? err).includes(want)), `toThrow(${want ?? ""})`); },
    toHaveBeenCalled: () => check(actual?.mock?.calls.length > 0, "toHaveBeenCalled()"),
    toHaveBeenCalledTimes: (n) => check(actual?.mock?.calls.length === n, `toHaveBeenCalledTimes(${n}), got ${actual?.mock?.calls.length}`),
    toHaveBeenCalledWith: (...args) => check(actual?.mock?.calls.some((c) => equal(c, args)), `toHaveBeenCalledWith(${args.map(fmt).join(", ")})`),
    // jest-dom
    toBeInTheDocument: () => check(!!actual && document.body.contains(actual), "toBeInTheDocument()"),
    toBeVisible: () => check(!!actual && document.body.contains(actual) && visible(actual), "toBeVisible()"),
    toHaveTextContent: (t) => check(!!actual && (typeof t === "string" ? textOf(actual).includes(t) : t.test(textOf(actual))), `toHaveTextContent(${fmt(t)}), text is ${fmt(actual ? textOf(actual).slice(0, 120) : null)}`),
    toHaveValue: (v) => check(equal(actual?.type === "number" ? (actual.value === "" ? null : Number(actual.value)) : actual?.value, v), `toHaveValue(${fmt(v)}), value is ${fmt(actual?.value)}`),
    toBeChecked: () => check(!!actual && (actual.checked === true || actual.getAttribute("aria-checked") === "true" || actual.getAttribute("data-state") === "checked"), "toBeChecked()"),
    toBeDisabled: () => check(!!actual && (actual.disabled === true || actual.getAttribute("aria-disabled") === "true"), "toBeDisabled()"),
    toBeEnabled: () => check(!!actual && !(actual.disabled === true || actual.getAttribute("aria-disabled") === "true"), "toBeEnabled()"),
    toHaveAttribute: (k, v) => check(!!actual && actual.hasAttribute(k) && (v === undefined || actual.getAttribute(k) === String(v)), `toHaveAttribute(${fmt(k)}${v === undefined ? "" : ", " + fmt(v)})`),
    toHaveClass: (...cs) => check(!!actual && cs.every((c) => actual.classList.contains(c)), `toHaveClass(${cs.join(", ")})`),
    toHaveFocus: () => check(document.activeElement === actual, "toHaveFocus()"),
  };
  return m;
}
export function expect(actual) {
  const m = matchers(actual, false);
  m.not = matchers(actual, true);
  m.resolves = new Proxy({}, { get: (_, k) => async (...a) => matchers(await actual, false)[k](...a) });
  m.rejects = new Proxy({}, { get: (_, k) => async (...a) => { let e; try { await actual; } catch (x) { e = x; } if (e === undefined) throw new Error("expected a rejection"); return matchers(e, false)[k](...a); } });
  return m;
}
export const vi = {
  fn(impl = () => {}) {
    const f = (...args) => { f.mock.calls.push(args); return impl(...args); };
    f.mock = { calls: [] };
    f.mockImplementation = (g) => { impl = g; return f; };
    f.mockReturnValue = (v) => { impl = () => v; return f; };
    return f;
  },
};

/** Runs every registered test and returns [{ name, ok, error, ms }]. */
export async function run(reset) {
  const results = [];
  const walk = async (suite, path, before, after) => {
    for (const t of suite.tests) {
      if (t.suite) { await walk(t.suite, [...path, t.suite.name], [...before, ...t.suite.before], [...t.suite.after, ...after]); continue; }
      const name = [...path, t.name].filter(Boolean).join(" › ");
      const t0 = performance.now();
      try {
        await reset?.();
        for (const b of before) await b();
        await Promise.race([t.fn(), new Promise((_, no) => setTimeout(() => no(new Error("timed out after 5 s")), 5000))]);
        results.push({ name, ok: true, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        results.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 500), ms: Math.round(performance.now() - t0) });
      } finally {
        for (const a of after) { try { await a(); } catch {} }
        cleanup();
      }
    }
  };
  await walk(suites[0], [], suites[0].before, suites[0].after);
  return results;
}

// MARK: @testing-library/react

const mounted = [];
export function cleanup() { for (const m of mounted.splice(0)) { try { m.root.unmount(); } catch {} m.container.remove(); } }
const flush = () => new Promise((ok) => setTimeout(ok, 0));
export async function act(fn) { const r = await fn?.(); await flush(); await flush(); return r; }
export function render(ui) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  root.render(ui);
  mounted.push({ root, container });
  return { container, unmount: () => root.unmount(), rerender: (next) => root.render(next), ...queriesFor(container), debug: () => console.log(container.innerHTML) };
}

const ROLES = {
  button: (e) => e.tagName === "BUTTON" || (e.tagName === "INPUT" && /^(button|submit|reset)$/.test(e.type)),
  link: (e) => e.tagName === "A" && e.hasAttribute("href"),
  heading: (e) => /^H[1-6]$/.test(e.tagName),
  textbox: (e) => (e.tagName === "INPUT" && /^(text|email|tel|url|search|password|)$/.test(e.type)) || e.tagName === "TEXTAREA",
  spinbutton: (e) => e.tagName === "INPUT" && e.type === "number",
  checkbox: (e) => e.tagName === "INPUT" && e.type === "checkbox",
  radio: (e) => e.tagName === "INPUT" && e.type === "radio",
  slider: (e) => e.tagName === "INPUT" && e.type === "range",
  combobox: (e) => e.tagName === "SELECT",
  list: (e) => e.tagName === "UL" || e.tagName === "OL",
  listitem: (e) => e.tagName === "LI",
  img: (e) => e.tagName === "IMG" && e.alt !== "",
  table: (e) => e.tagName === "TABLE", row: (e) => e.tagName === "TR", cell: (e) => e.tagName === "TD",
  navigation: (e) => e.tagName === "NAV", main: (e) => e.tagName === "MAIN", dialog: (e) => e.tagName === "DIALOG",
};
const roleOf = (e) => e.getAttribute("role") ?? Object.keys(ROLES).find((r) => ROLES[r](e)) ?? null;
function nameOf(e) {
  if (e.getAttribute("aria-label")) return e.getAttribute("aria-label");
  const by = e.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement("i"))).join(" ");
  if (e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l) return textOf(l); }
  const wrap = e.closest("label"); if (wrap && wrap !== e) return textOf(wrap);
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) return e.getAttribute("placeholder") ?? e.title ?? "";
  if (e.tagName === "IMG") return e.alt ?? "";
  return textOf(e) || e.title || "";
}
const matches = (text, want, exact = true) => typeof want === "function" ? want(text) : want instanceof RegExp ? want.test(text) : exact ? text.trim() === String(want) : text.toLowerCase().includes(String(want).toLowerCase());
const all = (root) => [...root.querySelectorAll("*")];
const finders = {
  Role: (root, role, o = {}) => all(root).filter((e) => roleOf(e) === role && (o.hidden || visible(e)) && (o.name === undefined || matches(nameOf(e), o.name, o.exact !== false)) && (o.level === undefined || e.tagName === `H${o.level}` || e.getAttribute("aria-level") === String(o.level))),
  Text: (root, t, o = {}) => all(root).filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && matches(textOf(e), t, o.exact !== false) && !/^(SCRIPT|STYLE)$/.test(e.tagName)),
  LabelText: (root, t, o = {}) => all(root).filter((e) => /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.tagName) || e.getAttribute("role")).filter((e) => matches(nameOf(e), t, o.exact !== false)),
  PlaceholderText: (root, t, o = {}) => all(root).filter((e) => e.hasAttribute("placeholder") && matches(e.getAttribute("placeholder"), t, o.exact !== false)),
  TestId: (root, t) => all(root).filter((e) => e.getAttribute("data-testid") === t),
  DisplayValue: (root, t, o = {}) => all(root).filter((e) => "value" in e && /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && matches(String(e.value), t, o.exact !== false)),
  Title: (root, t, o = {}) => all(root).filter((e) => e.title && matches(e.title, t, o.exact !== false)),
};
const describeQuery = (kind, args) => `${kind}(${args.map(fmt).join(", ")})`;
function screenText() { return textOf(document.body).slice(0, 300); }
export async function waitFor(fn, { timeout = 2000, interval = 50 } = {}) {
  const end = performance.now() + timeout;
  for (;;) {
    try { return await fn(); } catch (e) { if (performance.now() > end) throw e; }
    await new Promise((ok) => setTimeout(ok, interval));
  }
}
function queriesFor(root) {
  const q = {};
  for (const [kind, find] of Object.entries(finders)) {
    q[`queryAllBy${kind}`] = (...a) => find(root, ...a);
    q[`getAllBy${kind}`] = (...a) => { const r = find(root, ...a); if (!r.length) throw new Error(`Unable to find ${describeQuery("getAllBy" + kind, a)}. The screen shows: ${screenText()}`); return r; };
    q[`queryBy${kind}`] = (...a) => { const r = find(root, ...a); if (r.length > 1) throw new Error(`Found ${r.length} elements for ${describeQuery("queryBy" + kind, a)}; use the AllBy variant.`); return r[0] ?? null; };
    q[`getBy${kind}`] = (...a) => { const r = find(root, ...a); if (r.length !== 1) throw new Error(`${r.length ? "Found " + r.length + " elements" : "Unable to find an element"} for ${describeQuery("getBy" + kind, a)}. The screen shows: ${screenText()}`); return r[0]; };
    q[`findBy${kind}`] = (...a) => waitFor(() => q[`getBy${kind}`](...a));
    q[`findAllBy${kind}`] = (...a) => waitFor(() => q[`getAllBy${kind}`](...a));
  }
  return q;
}
export const screen = queriesFor(document.body);
export const within = (el) => queriesFor(el);
const fire = (el, type, init = {}) => el.dispatchEvent(new (type.startsWith("key") ? KeyboardEvent : type.startsWith("pointer") ? PointerEvent : type.startsWith("mouse") || type === "click" ? MouseEvent : type === "input" ? InputEvent : Event)(type, { bubbles: true, cancelable: true, composed: true, ...init }));
export const fireEvent = Object.assign((el, ev) => el.dispatchEvent(ev), {
  click: (el) => fire(el, "click"), change: (el, init) => { if (init?.target) Object.assign(el, init.target); fire(el, "input"); fire(el, "change"); },
  input: (el, init) => { if (init?.target) Object.assign(el, init.target); fire(el, "input"); }, submit: (el) => fire(el, "submit"),
  keyDown: (el, init) => fire(el, "keydown", init), keyUp: (el, init) => fire(el, "keyup", init), focus: (el) => { el.focus(); fire(el, "focus"); }, blur: (el) => { el.blur(); fire(el, "blur"); },
});
export { createElement };

// MARK: @testing-library/user-event

const setValue = (el, v) => {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
};
const user = {
  async click(el) {
    if (!el) throw new Error("userEvent.click: no element");
    for (const t of ["pointerover", "pointerenter", "mouseover", "pointerdown", "mousedown"]) fire(el, t, { button: 0 });
    el.focus?.();
    for (const t of ["pointerup", "mouseup"]) fire(el, t, { button: 0 });
    el.click();
    await act();
  },
  async dblClick(el) { await user.click(el); await user.click(el); fire(el, "dblclick"); await act(); },
  async type(el, text) {
    await user.click(el);
    for (const ch of String(text).replace(/\{enter\}/gi, "\n")) {
      if (ch === "\n") { await user.keyboard("{Enter}"); continue; }
      fire(el, "keydown", { key: ch });
      setValue(el, (el.value ?? "") + ch);
      fire(el, "input", { data: ch, inputType: "insertText" });
      fire(el, "keyup", { key: ch });
    }
    fire(el, "change");
    await act();
  },
  async clear(el) { el.focus(); setValue(el, ""); fire(el, "input", { inputType: "deleteContentBackward" }); fire(el, "change"); await act(); },
  async selectOptions(el, values) {
    const vs = [values].flat().map(String);
    if (el.tagName === "SELECT") { setValue(el, [...el.options].find((o) => vs.includes(o.value) || vs.includes(o.textContent))?.value ?? vs[0]); fire(el, "input"); fire(el, "change"); }
    else for (const v of vs) { const opt = screen.queryAllByRole("option").find((o) => matches(nameOf(o), v)); if (opt) await user.click(opt); }
    await act();
  },
  async keyboard(keys) {
    const el = document.activeElement ?? document.body;
    for (const m of String(keys).matchAll(/\{([^}]+)\}|(.)/gs)) {
      const key = m[1] ?? m[2];
      fire(el, "keydown", { key });
      if (key === "Enter" && el.tagName === "INPUT" && el.form) el.form.requestSubmit?.();
      if (!m[1] && "value" in el) { setValue(el, el.value + key); fire(el, "input", { data: key }); }
      fire(el, "keyup", { key });
    }
    await act();
  },
  async tab() { const els = all(document.body).filter((e) => e.tabIndex >= 0 && visible(e)); const i = els.indexOf(document.activeElement); els[(i + 1) % els.length]?.focus(); await act(); },
  async hover(el) { fire(el, "pointerover"); fire(el, "mouseover"); fire(el, "mouseenter"); await act(); },
};
export const userEvent = { ...user, setup: () => user };
export default userEvent;
