// The project every new app starts from (create_app): a normal Vite + React + TypeScript + Tailwind +
// shadcn/ui project, the stack AIs know best, so an AI works on it the way it would anywhere. Amber
// Notes compiles it on save (nothing is installed: package.json is there for orientation) and runs
// React through preact/compat. src/components/ui/ holds the shadcn components the app ships.

import { SHADCN } from "./shadcn.ts";

export function scaffold(title: string, lang = "en"): Record<string, string> {
  const safe = title.replace(/[<>&"`$\\]/g, "").trim() || "App";
  return {
    "/package.json": JSON.stringify({
      name: safe.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app",
      private: true, type: "module",
      "//": "Amber Notes compiles this project when a file is saved and runs it inside the note. Nothing is installed: these are the packages the app provides.",
      dependencies: {
        react: "19", "react-dom": "19", "lucide-react": "*", clsx: "*", "tailwind-merge": "*", "class-variance-authority": "*", "@radix-ui/react-slot": "*", amber: "*",
      },
      devDependencies: { typescript: "5", vite: "7", tailwindcss: "4", "tw-animate-css": "*" },
    }, null, 2) + "\n",
    "/tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      include: ["src"],
    }, null, 2) + "\n",
    "/index.html": `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${safe}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`,
    "/src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@/App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
`,
    "/src/App.tsx": `import { useNote } from "@/lib/amber";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export default function App() {
  const note = useNote();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{note.title}</h1>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-5" /> Nothing here yet</CardTitle>
          <CardDescription>This is where the app does its job.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>Get started</Button>
        </CardContent>
      </Card>
    </main>
  );
}
`,
    "/src/index.css": `@import "tailwindcss";
@import "tw-animate-css";

/* Light and dark follow the device (prefers-color-scheme). */
@custom-variant dark (@media (prefers-color-scheme: dark));

/* shadcn/ui's variables, set from Amber's own (amber-tokens.css switches them for light and dark,
   iPhone and Mac). Change any of them to give the app its own look. */
:root {
  --radius: var(--amber-radius-small);
  --background: var(--amber-bg);
  --foreground: var(--amber-text);
  --card: var(--amber-surface);
  --card-foreground: var(--amber-text);
  --popover: var(--amber-surface);
  --popover-foreground: var(--amber-text);
  --primary: var(--amber-accent);
  --primary-foreground: var(--amber-on-accent);
  --secondary: var(--amber-fill);
  --secondary-foreground: var(--amber-text);
  --muted: var(--amber-fill);
  --muted-foreground: var(--amber-text-secondary);
  --accent: var(--amber-accent-soft);
  --accent-foreground: var(--amber-text);
  --destructive: var(--amber-danger);
  --border: var(--amber-separator);
  --input: var(--amber-field-border);
  --ring: var(--amber-accent);
  --chart-1: var(--amber-accent);
  --chart-2: #3c63b0;
  --chart-3: #2f7d5b;
  --chart-4: #a3478a;
  --chart-5: var(--amber-text-secondary);
}

@theme inline {
  --font-sans: var(--amber-font);
  --font-mono: var(--amber-font-mono);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground antialiased; }
}
`,
    "/src/lib/utils.ts": `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
    "/src/lib/amber.ts": `// The app's data and the device, from Amber Notes. Data is JSON, kept for this app only:
// encrypted, synced across the person's devices, with Undo. localStorage works too (it is kept the
// same way).
export {
  useStore, useAppData, useCollection, useSettings, batch, setSummary, useImported, useNote,
  fetch, device, ai, files,
} from "amber";
`,
    "/README.md": `# ${safe}

What this app is for, in one sentence.

## Screens
- App (src/App.tsx)

## Data
- (Which keys and collections the app keeps, e.g. useCollection("workouts"), useSettings({ unit: "kg" }).)

## Files
- src/components/ui/: shadcn/ui components (the app's own copies; change them freely).
- src/lib/amber.ts: data hooks from Amber Notes. src/lib/utils.ts: cn().
`,
    ...Object.fromEntries(Object.entries(SHADCN).map(([name, src]) => [`/src/components/ui/${name}`, src])),
  };
}
