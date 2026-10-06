import { route, useRoute } from "amber-router";

// The app's screens: a tab bar at the bottom on iPhone, a sidebar from 900 px (the Mac).
// items: [{ path: "/", label: "Today", icon: <Icon name="clock" /> }]
export function TabBar({ items, title }) {
  const path = useRoute();
  const current = (p) => p === "/" ? path === "/" : path === p || path.startsWith(p + "/");
  return (
    <nav class="aui-tabbar" aria-label="Screens">
      {title && <div class="aui-tabbar__title">{title}</div>}
      {items.map((it) => (
        <a href={"#" + it.path} class="aui-tabbar__item" aria-current={current(it.path) ? "page" : undefined}
          onClick={(e) => { e.preventDefault(); route(it.path); }}>
          {it.icon}<span>{it.label}</span>
        </a>
      ))}
    </nav>
  );
}

// The frame for an app with screens: the tab bar or sidebar, and the screen.
export function Shell({ items, title, children }) {
  return (
    <div class="aui-shell">
      <main class="aui-shell__main">{children}</main>
      <TabBar items={items} title={title} />
    </div>
  );
}
