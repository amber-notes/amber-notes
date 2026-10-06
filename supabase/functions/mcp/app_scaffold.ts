// The project every new app starts from (create_app): a normal Vite + React + TypeScript + Tailwind +
// shadcn/ui project, the stack AIs know best, so an AI works on it the way it would anywhere. Amber
// Notes compiles it on save (nothing is installed: package.json is there for orientation) and runs
// React on preact/compat. shadcn's components, the app shell, index.css and lib/ come from the
// stack's own starter (app_stack.gen.ts).

import { STACK_FILES } from "./app_stack.gen.ts";
import { SHADCN_UI } from "./shadcn-ui.ts";

// The experiment's control arm (AMBER_NO_TRY=1) has no trying or tests, so its README doesn't mention them.
const TRY_LINE = () => Deno.env.get("AMBER_NO_TRY") === "1" ? "" : "\n- You can try your app with see_app steps and write tests in tests/ (Vitest and Testing Library style; they run on every save); do it for anything non-trivial.";

/** How an app runs in Amber Notes: part of every app's README, so any AI working on it reads it. */
export const appGuide = () => `## How this app runs in Amber Notes

- It is the note: opening the note opens the app, on iPhone (320-440 pt wide, safe areas, the keyboard shrinks the view) and on the Mac (a window from about 500 to 1,800 px, resized live). Light and dark follow the device.
- A normal Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui project. Amber Notes compiles it when a file is saved (TSX, the @/ alias, imports without extensions, Tailwind from the classes used) and says what broke; nothing is installed. React runs on preact/compat.
- Available by name: react, react-dom, radix-ui, lucide-react, recharts, date-fns, zod, motion, sonner, react-day-picker, clsx, tailwind-merge, class-variance-authority, amber-router (Router, Route, route(), back()), chart.js, d3, three, tone, dayjs, marked, dompurify, animejs, canvas-confetti.
- Data is JSON that Amber Notes keeps for the app (encrypted, synced, with Undo): useStore(key, initial), useCollection(name), useSettings(defaults), batch(fn), setSummary(text) from "@/lib/amber". localStorage works too and is kept the same way. The person's AI reads and edits it as data.json, so keep its shape simple and describe it under Data above.
- No network except hosts the person allows: declare them in index.html with <meta name="amber-needs" content='{"hosts": ["api.open-meteo.com"]}'> and call fetch(url) from "@/lib/amber"; API keys live in Amber Notes › Settings › API Keys (declare { "keys": [{ "name", "hosts", "query" or "header" }] } and pass { key: name }).
- The device, through its own prompts: device.reminders, calendar, notify, photos, camera, contacts, location, maps, weather; on-device AI with ai.respond.${TRY_LINE()}`;

export function scaffold(title: string, lang = "en"): Record<string, string> {
  const safe = title.replace(/[<>&"`$\\{}]/g, "").trim() || "App";
  return {
    ...STACK_FILES,
    ...SHADCN_UI,
    "/package.json": JSON.stringify({
      name: safe.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app",
      private: true, type: "module",
      "//": "Amber Notes compiles this project when a file is saved and runs it inside the note. Nothing is installed: these are the packages the app provides.",
      dependencies: {
        react: "19", "react-dom": "19", "radix-ui": "1.4", "lucide-react": "0.544", recharts: "2.15", "date-fns": "4", zod: "3.25", motion: "11", sonner: "2", "react-day-picker": "9",
        clsx: "2", "tailwind-merge": "3", "class-variance-authority": "0.7", amber: "*", "amber-router": "*",
      },
      devDependencies: { typescript: "5", vite: "7", tailwindcss: "4" },
    }, null, 2) + "\n",
    "/tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      include: ["src"],
    }, null, 2) + "\n",
    "/index.html": `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <title>${safe}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    "/src/main.tsx": `import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App"

createRoot(document.getElementById("root")!).render(<App />)
`,
    "/src/App.tsx": `import { Router, Route } from "amber-router"
import { House, Settings as SettingsIcon } from "lucide-react"
import { Toaster } from "@/components/ui/sonner"
import { AppShell } from "@/components/app-shell"
import Home from "@/screens/home"
import Settings from "@/screens/settings"

// The app's places: a tab bar on iPhone, a sidebar from 900 px (components/app-shell.tsx).
const screens = [
  { path: "/", label: "Home", icon: House },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
]

export default function App() {
  return (
    <AppShell title="${safe}" screens={screens}>
      <div className="mx-auto max-w-5xl px-4 pt-4 min-[900px]:px-10 min-[900px]:pt-8">
        <Router>
          <Route path="/" component={Home} default />
          <Route path="/settings" component={Settings} />
        </Router>
      </div>
      <Toaster position="top-center" />
    </AppShell>
  )
}
`,
    "/src/screens/home.tsx": `import { Sparkles } from "lucide-react"
import { PageHeader } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function Home() {
  return (
    <>
      <PageHeader title="${safe}" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-5" /> Nothing here yet</CardTitle>
          <CardDescription>This is where the app does its job.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>Get started</Button>
        </CardContent>
      </Card>
    </>
  )
}
`,
    "/src/screens/settings.tsx": `import { useSettings } from "@/lib/amber"
import { PageHeader } from "@/components/app-shell"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const DEFAULTS = { name: "" }

// What the person can change without asking an AI, kept in the app's data.
export default function Settings() {
  const [settings, update] = useSettings(DEFAULTS)
  return (
    <>
      <PageHeader title="Settings" />
      <Card className="gap-0 py-0">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Label htmlFor="name" className="flex-1">Name</Label>
          <Input id="name" className="w-48" value={settings.name} onChange={(e) => update({ name: e.currentTarget.value })} />
        </div>
      </Card>
    </>
  )
}
`,
    "/README.md": `# ${safe}

What this app is for, in one sentence.

## Screens
- Home (src/screens/home.tsx)
- Settings (src/screens/settings.tsx)

## Data
The app's data, as the person's AI reaches it in data.json. Keep this current.
- settings: { name } (useSettings)

${appGuide()}
`,
  };
}
