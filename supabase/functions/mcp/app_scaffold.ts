// The project every new app starts from (create_app): a normal small Preact project on amber-ui,
// with a home screen, a settings screen, a phone tab bar that becomes a sidebar from 900 px, and a
// README the AI keeps current. Written in the style the guide teaches: hooks from "amber", tables by
// heading, settings inside the app.

export function scaffold(title: string, lang = "en"): Record<string, string> {
  const safe = title.replace(/[<>&"]/g, "").trim() || "App";
  return {
    "/index.html": `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${safe}</title>
  <link rel="stylesheet" href="/src/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`,
    "/src/main.jsx": `import { render } from "preact";
import App from "./App.jsx";

render(<App />, document.getElementById("app"));
`,
    "/src/App.jsx": `import { Router, Route } from "amber-router";
import { Shell, Icon } from "amber-ui";
import Home from "./screens/Home.jsx";
import Settings from "./screens/Settings.jsx";

// The app's places: a tab bar at the bottom on iPhone, a sidebar from 900 px. Two to four,
// named by what the person does there. Add a screen in src/screens/ and a line here.
const screens = [
  { path: "/", label: "Home", icon: <Icon name="home" /> },
  { path: "/settings", label: "Settings", icon: <Icon name="gear" /> },
];

export default function App() {
  return (
    <Shell items={screens} title="${safe}">
      <Router>
        <Route path="/" component={Home} default />
        <Route path="/settings" component={Settings} />
      </Router>
    </Shell>
  );
}
`,
    "/src/screens/Home.jsx": `import { useNote } from "amber";
import { EmptyState } from "amber-ui";

// The first screen does the app's one main job. Replace this with it.
export default function Home() {
  const note = useNote();
  return (
    <div class="screen">
      <h1>{note.title}</h1>
      <EmptyState title="Nothing here yet" body="This screen does the app's main job." />
    </div>
  );
}
`,
    "/src/screens/Settings.jsx": `import { useSettings } from "amber";
import { List, Input } from "amber-ui";
import { DEFAULTS } from "../data.js";

// What the person can change without asking an AI. Applies as they type; kept in the app's data
// (an AI can set it with update_page_data { values: { settings: { ... } } }).
export default function Settings() {
  const [settings, update] = useSettings(DEFAULTS);
  return (
    <div class="screen">
      <h1>Settings</h1>
      <List>
        <Input label="Name" value={settings.name} onInput={(e) => update({ name: e.currentTarget.value })} />
      </List>
    </div>
  );
}
`,
    "/src/data.js": `// Defaults and small helpers. The note's tables come from useTable("Heading") and checklists from
// useChecklist("Heading") (both from "amber"); the app's own state from useAppData.
export const DEFAULTS = { name: "" };
`,
    "/src/styles.css": `/* The app's own look. Plain CSS wins over amber-base.css and amber-ui (they sit in cascade layers),
   so restyle anything here; the --amber-* variables switch for light and dark. */
.screen { max-width: var(--amber-content-max); margin: 0 auto; padding: 16px var(--amber-gutter) 32px; }
.screen h1 { font-size: 1.8rem; letter-spacing: -0.02em; margin: 4px 0 16px; }
`,
    "/README.md": `# ${safe}

What this app is for, in one sentence.

## Screens
- Home (src/screens/Home.jsx): the main job.
- Settings (src/screens/Settings.jsx): what the person can change, kept with useSettings.

## Data
- The note: (which tables and checklists, by heading).
- The app's own data: settings (useSettings).

## Files
- src/App.jsx: the screens in an amber-ui Shell (tab bar on iPhone, sidebar from 900 px).
- src/components/: pieces used by several screens.
`,
  };
}
