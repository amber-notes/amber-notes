// Lift's building blocks: the frame (tabs on the iPhone, a sidebar on the Mac), screen headers,
// cards and rows, the one sheet at a time, equipment glyphs and charts.
import { useEffect, useState, type ComponentProps, type ReactNode } from "react"
import { back, route, useRoute } from "amber-router"
import { BookOpen, ChartColumn, ChevronLeft, Dumbbell, History, Settings, Zap, type LucideIcon } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { Sheet as UISheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { exById, MCOLOR, type Active } from "@/lib/lift"
import type { Exercise } from "@/lib/exercises"

const TABS: [string, string, LucideIcon][] = [["/", "Workout", Dumbbell], ["/history", "History", History], ["/exercises", "Exercises", BookOpen], ["/progress", "Progress", ChartColumn], ["/settings", "Settings", Settings]]
const tabOf = (p: string) => (p.startsWith("/history") || p.startsWith("/workout") ? "/history" : p.startsWith("/exercise") ? "/exercises" : TABS.some((t) => t[0] === p) ? p : "/")

export function Shell({ title, active, children, resume }: { title: string; active: Active | null; children: ReactNode; resume: ReactNode }) {
  const path = useRoute(), focus = path === "/live" || path.startsWith("/done"), cur = tabOf(path)
  const link = ([p, l, Icon]: [string, string, LucideIcon], wide: boolean) => (
    <a key={p} href={"#" + p} aria-current={cur === p ? "page" : undefined} onClick={(e) => { e.preventDefault(); route(p); window.scrollTo(0, 0) }}
      className={wide
        ? "flex min-h-10 items-center gap-3 rounded-lg px-3 text-[15px] text-foreground aria-[current=page]:bg-primary/12 [&_svg]:text-primary"
        : "flex min-h-12 max-w-26 flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-semibold text-muted-foreground aria-[current=page]:text-primary"}>
      <Icon className={wide ? "size-[18px]" : "size-6"} strokeWidth={wide ? 2 : 1.8} />{l}
    </a>
  )
  if (focus) return <div className="min-h-screen">{children}</div>
  return (
    <div className="min-h-screen min-[900px]:grid min-[900px]:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Sections" className="sticky top-0 hidden h-screen flex-col gap-0.5 border-r bg-card px-3 py-5 min-[900px]:flex">
        <div className="flex items-center gap-2 px-2.5 pb-4 text-xl font-extrabold tracking-tight"><Zap className="size-6 text-primary" />{title}</div>
        {TABS.map((t) => link(t, true))}
        {active && <div className="mt-auto">{resume}</div>}
      </nav>
      <main className="min-w-0">{children}</main>
      {active && <div className="fixed inset-x-2.5 z-20 min-[900px]:hidden" style={{ bottom: "calc(4.4rem + max(var(--amber-safe-bottom, 0px), var(--amber-inset-bottom, 0px)))" }}>{resume}</div>}
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-background/90 px-1 pt-1 backdrop-blur-xl min-[900px]:hidden"
        style={{ paddingBottom: "max(4px, var(--amber-safe-bottom, 0px), var(--amber-inset-bottom, 0px))" }}>
        {TABS.map((t) => link(t, false))}
      </nav>
    </div>
  )
}

export function Screen({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={cn("mx-auto min-w-0 px-4 pt-3 pb-36 min-[900px]:px-10 min-[900px]:pt-7 min-[900px]:pb-12", wide ? "max-w-5xl" : "max-w-3xl")}>{children}</div>
}

export function Top({ title, sub, backTo, children }: { title: ReactNode; sub?: ReactNode; backTo?: string; children?: ReactNode }) {
  return <>
    {backTo && <button onClick={() => back()} className="-mx-1 mb-1 inline-flex min-h-10 items-center font-semibold text-primary"><ChevronLeft className="size-5" />{backTo}</button>}
    <header className="flex min-h-13 items-center gap-2.5 pb-4">
      <div className="min-w-0 flex-1"><h1 className="text-[2rem] leading-tight font-extrabold tracking-tight break-words">{title}</h1>{sub && <div className="mt-0.5 text-[15px] text-muted-foreground">{sub}</div>}</div>
      {children}
    </header>
  </>
}

export const Label = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cn("mx-0.5 mt-6 mb-2 flex items-baseline gap-2 text-xs font-bold tracking-wider text-muted-foreground uppercase [&_button]:text-sm [&_button]:font-semibold [&_button]:tracking-normal [&_button]:text-primary [&_button]:normal-case", className)}>{children}</div>

export const Card = ({ className, ...p }: ComponentProps<"section">) => <section className={cn("overflow-hidden rounded-xl bg-card", className)} {...p} />
export const List = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("divide-y overflow-hidden rounded-xl bg-card", className)} {...p} />
export const rowCls = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-muted"

export function Btn({ tone = "plain", big, className, ...p }: ComponentProps<"button"> & { tone?: "plain" | "primary" | "tint" | "ok" | "danger" | "ghost"; big?: boolean }) {
  return <button className={cn("inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 font-bold whitespace-nowrap transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px]",
    { plain: "bg-muted text-foreground", primary: "bg-primary text-primary-foreground", tint: "bg-primary/12 text-primary", ok: "bg-ok text-white", danger: "text-destructive", ghost: "text-primary" }[tone],
    big && "min-h-14 rounded-2xl text-lg", className)} {...p} />
}
export const Round = ({ className, ...p }: ComponentProps<"button">) =>
  <button className={cn("inline-grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground [&_svg]:size-[18px]", className)} {...p} />

export function Chips<T extends string>({ value, options, onChange, label, render }: { value: T; options: T[]; onChange: (v: T) => void; label: string; render?: (v: T) => string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto pt-0.5 pb-2.5 [scrollbar-width:none]">
      {options.map((o) => <button key={o} aria-pressed={o === value} onClick={() => onChange(o)}
        className="min-h-9 shrink-0 rounded-full bg-muted px-3.5 text-[15px] font-semibold whitespace-nowrap text-muted-foreground aria-pressed:bg-foreground aria-pressed:text-background">{render ? render(o) : o}</button>)}
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted p-[3px] [scrollbar-width:none]">
      {options.map(([v, l]) => <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}
        className="min-h-9 rounded-full px-3.5 text-sm font-bold whitespace-nowrap text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">{l}</button>)}
    </div>
  )
}

export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title?: string; children?: ReactNode }) {
  return <div className="grid justify-items-center gap-1.5 px-5 py-8 text-center text-muted-foreground">{Icon && <Icon className="mb-1 size-9 text-primary" />}{title && <h3 className="text-lg font-semibold text-foreground">{title}</h3>}{children}</div>
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) =>
  <label className="grid gap-1.5 text-sm font-semibold text-muted-foreground">{label}{children}</label>
export const inputCls = "min-h-11 w-full min-w-0 rounded-lg bg-muted px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"

// ---------- One sheet at a time ----------
type SheetSpec = { title: string; description?: string; body: () => ReactNode; foot?: () => ReactNode; wide?: boolean }
let setSpec: (s: SheetSpec | null) => void = () => {}
export const openSheet = (s: SheetSpec) => setSpec(s)
export const closeSheet = () => setSpec(null)
/** A bottom sheet on the iPhone, a centred panel on the Mac: header, its own scrolling body, a footer that stays put. */
export function SheetHost() {
  const [s, set] = useState<SheetSpec | null>(null)
  setSpec = set
  const [wide, setWide] = useState(innerWidth >= 700)
  useEffect(() => { const f = () => setWide(innerWidth >= 700); addEventListener("resize", f); return () => removeEventListener("resize", f) }, [])
  return (
    <UISheet open={!!s} onOpenChange={(o) => !o && set(null)}>
      {s && (
        <SheetContent side="bottom" className={cn("max-h-[calc(100%-3rem)] gap-0 rounded-t-2xl border-0 bg-background",
          wide && "inset-x-auto top-1/2 bottom-auto left-1/2 max-h-[min(44rem,calc(100%-4rem))] w-[min(34rem,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl data-[state=closed]:slide-out-to-bottom-0 data-[state=open]:slide-in-from-bottom-0 data-[state=open]:zoom-in-95",
          wide && s.wide && "w-[min(46rem,calc(100%-3rem))]")}>
          <SheetHeader className="flex-none px-5 pt-5 pb-3"><SheetTitle className="pr-8 text-lg font-extrabold">{s.title}</SheetTitle>{s.description && <SheetDescription>{s.description}</SheetDescription>}</SheetHeader>
          <div className="min-w-0 flex-1 overflow-auto overscroll-contain px-5 pb-4">{s.body()}</div>
          {s.foot && <SheetFooter className="mt-0 flex-none flex-row border-t px-5 pt-3 [&>*]:flex-1" style={{ paddingBottom: "max(1rem, calc(var(--amber-safe-bottom, 0px) + .4rem), var(--amber-inset-bottom, 0px))" }}>{s.foot()}</SheetFooter>}
        </SheetContent>
      )}
    </UISheet>
  )
}

// ---------- Equipment glyphs, drawn for this app: the tool, not the body ----------
const G: Record<string, ReactNode> = {
  Barbell: <><path d="M2 12h20" /><rect x="5" y="7" width="2.5" height="10" rx=".6" /><rect x="16.5" y="7" width="2.5" height="10" rx=".6" /><rect x="3" y="9" width="2" height="6" rx=".5" /><rect x="19" y="9" width="2" height="6" rx=".5" /></>,
  Dumbbell: <><path d="M8 12h8" /><rect x="4" y="8" width="4" height="8" rx="1.2" /><rect x="16" y="8" width="4" height="8" rx="1.2" /></>,
  Machine: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 10h6M9 13h6M12 16v3" /></>,
  Cable: <><path d="M6 3v18M6 4l11 7" /><circle cx="17" cy="12" r="1.6" /><path d="M17 13.5V18M15 18h4" /></>,
  Bodyweight: <><circle cx="12" cy="5" r="2" /><path d="M12 7v7M7 10l5-1 5 1M9 21l3-7 3 7" /></>,
  Kettlebell: <><path d="M9 7a3 3 0 0 1 6 0" /><path d="M7.5 9.5A6 6 0 1 0 16.5 9.5z" /></>,
  Band: <><path d="M4 16c3-8 13-8 16 0" /><path d="M4 16h3M17 16h3" /></>,
  Other: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></>,
}
export function Glyph({ ex, sm }: { ex: string | Exercise; sm?: boolean }) {
  const e = typeof ex === "string" ? exById(ex) : ex
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center text-(--mc)", sm ? "size-[2.1rem] rounded-[.65rem]" : "size-[2.6rem] rounded-[.8rem]")}
      style={{ "--mc": `var(${MCOLOR[e.muscle] || "--c-brown"})`, background: "color-mix(in srgb, var(--mc) 16%, var(--background))" } as React.CSSProperties}>
      <svg viewBox="0 0 24 24" className={sm ? "size-[1.3rem]" : "size-[1.6rem]"} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{G[e.equipment] || G.Other}</svg>
    </span>
  )
}

// ---------- Charts ----------
const tick = { fill: "var(--muted-foreground)", fontSize: 11 }
export function LineTrend({ points, fmt = (v: number) => String(Math.round(v)), height = 180 }: { points: { v: number; label: string }[]; fmt?: (v: number) => string; height?: number }) {
  if (!points.length) return <p className="text-sm text-muted-foreground">Not enough to chart yet.</p>
  const vs = points.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo || hi || 1) * 0.15
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis domain={[Math.max(0, lo - pad), hi + pad]} tickFormatter={fmt} tick={tick} tickLine={false} axisLine={false} width={36} tickCount={3} />
          <Area dataKey="v" type="monotone" stroke="var(--primary)" strokeWidth={2.5} fill="var(--primary)" fillOpacity={0.1} dot={{ r: 3, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
export function Bars({ points, fmt = (v: number) => String(Math.round(v)), height = 160 }: { points: { v: number; label: string; dim?: boolean }[]; fmt?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
          <YAxis tickFormatter={fmt} tick={tick} tickLine={false} axisLine={false} width={36} tickCount={3} />
          <Bar dataKey="v" radius={[3, 3, 0, 0]} isAnimationActive={false} shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={Math.max(1, p.height)} rx={3} fill="var(--primary)" fillOpacity={p.payload.dim ? 0.35 : 1} />} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
