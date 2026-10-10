// amber-router 1.0.0 (Amber Notes, MIT): screens for a Preact app, in memory. A note's app runs on
// a page that can't navigate (not even its #hash), so the route is kept here.
//   import { Router, Route, Link, route, back, useRoute } from "amber-router";
//   <Router><List path="/" default /><Item path="/item/:id" /></Router>; links as <a href="#/item/3">.
import { h } from "preact";
import { useState, useLayoutEffect } from "preact/hooks";

let current = "/";
const stack = [], subs = new Set();
function go(path) { current = path; subs.forEach((f) => f(path)); }
export function route(path) { if (path !== current) { stack.push(current); go(path); } }
export function back() { if (stack.length) go(stack.pop()); }
export function useRoute() {
  const [p, set] = useState(current);
  // A layout effect: it runs as the screen is built, not on a frame a hidden page may never draw.
  useLayoutEffect(() => { subs.add(set); return () => subs.delete(set); }, []);
  return p;
}
function match(pattern, path) {
  const a = pattern.split("/").filter(Boolean), b = path.split("/").filter(Boolean), params = {};
  if (a.length !== b.length) return null;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] === ":") params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
export function Router({ children }) {
  const path = useRoute(), kids = [].concat(children).filter(Boolean);
  for (const c of kids) {
    const m = c.props.path ? match(c.props.path, path) : null;
    if (m) return h(c.type, { ...c.props, ...m, path });
  }
  const d = kids.find((c) => c.props.default);
  return d ? h(d.type, { ...d.props, path }) : null;
}
// <Route path="/plan/:day" component={PlanDay} />: a screen in a Router (or put the component itself).
export function Route({ component: C, ...props }) { return h(C, props); }

export function Link(props) {
  return h("a", { ...props, onClick: (e) => { e.preventDefault(); route(String(props.href || "/").replace(/^#/, "")); } });
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (a && !e.defaultPrevented) { e.preventDefault(); route(a.getAttribute("href").slice(1)); }
});
export const path = () => current;
