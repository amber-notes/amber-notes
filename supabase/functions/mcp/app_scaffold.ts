// The project every new app starts from (create_app): a normal Vite + React + TypeScript + Tailwind +
// shadcn/ui project, the stack AIs know best, so an AI works on it the way it would anywhere. Amber
// Notes compiles it on save (nothing is installed: package.json is there for orientation) and runs
// React on preact/compat. shadcn's components, the app shell, index.css and lib/ come from the
// stack's own starter (app_stack.gen.ts).

import { STACK_FILES } from "./app_stack.gen.ts";

export function scaffold(title: string, lang = "en"): Record<string, string> {
  const safe = title.replace(/[<>&"`$\\{}]/g, "").trim() || "App";
  return {
    ...STACK_FILES,
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
The app's data, as the person's AI reaches it through the data tools. Keep this current.
- settings: { name } (useSettings)

## Files
- src/components/app-shell.tsx: the frame (tab bar on iPhone, sidebar from 900 px) and PageHeader.
- src/components/ui/: shadcn/ui components, plain source to change.
- src/lib/amber.ts: the app's data and the device, from Amber Notes. src/lib/utils.ts: cn().
`,
  };
}
