import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { route, useRoute } from "amber-router"
import { cn } from "@/lib/utils"

export type Screen = { path: string; label: string; icon: LucideIcon }

// The app's frame: a tab bar at the bottom on iPhone; from 900 px a sidebar with the content
// beside it, so the Mac never shows a stretched phone list.
export function AppShell({ title, screens, children }: { title: string; screens: Screen[]; children: ReactNode }) {
  const path = useRoute()
  const current = (p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/"))
  const link = (s: Screen, wide: boolean) => (
    <a
      key={s.path}
      href={"#" + s.path}
      onClick={(e) => { e.preventDefault(); route(s.path) }}
      aria-current={current(s.path) ? "page" : undefined}
      className={cn(
        wide
          ? "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent aria-[current=page]:bg-primary/10 aria-[current=page]:text-foreground aria-[current=page]:[&_svg]:text-primary"
          : "flex flex-1 flex-col items-center gap-1 py-1.5 text-xs font-medium text-muted-foreground aria-[current=page]:text-primary",
      )}
    >
      <s.icon className={wide ? "size-4" : "size-6"} strokeWidth={wide ? 2 : 1.75} />
      {s.label}
    </a>
  )
  return (
    <div className="min-h-screen min-[900px]:grid min-[900px]:grid-cols-[232px_1fr]">
      <aside className="hidden min-[900px]:flex sticky top-0 h-screen flex-col gap-1 border-r bg-card px-3 py-5">
        <div className="px-3 pb-4 text-lg font-semibold tracking-tight">{title}</div>
        {screens.map((s) => link(s, true))}
      </aside>
      <main className="min-w-0 pb-24 min-[900px]:pb-0">{children}</main>
      <nav
        aria-label="Screens"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background px-2 pt-1 min-[900px]:hidden"
        style={{ paddingBottom: "max(6px, var(--amber-safe-bottom), var(--amber-inset-bottom))" }}
      >
        {screens.map((s) => link(s, false))}
      </nav>
    </div>
  )
}

// A screen's title, a line under it and an action on the right.
export function PageHeader({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 pb-5">
      {back}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight min-[900px]:text-3xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
