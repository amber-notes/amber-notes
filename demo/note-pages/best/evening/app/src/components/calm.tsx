// Evening's own pieces in the Calm look: white cards on warm paper, big round buttons.
import type { ComponentProps, ReactNode } from "react"
import { route, useRoute } from "amber-router"
import { CalendarDays, House, Minus, Moon, Plus, SlidersHorizontal, TrendingUp, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"

type Screen = { path: string; label: string; icon: LucideIcon }
const SCREENS: Screen[] = [
  { path: "/", label: "Overview", icon: House },
  { path: "/week", label: "Week", icon: CalendarDays },
  { path: "/trends", label: "Trends", icon: TrendingUp },
  { path: "/plan", label: "Plan", icon: SlidersHorizontal },
]

/** Tabs at the bottom on the iPhone, a sidebar from 900 px; neither while checking in. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = useRoute()
  if (path.startsWith("/log")) return <>{children}</>
  const current = (p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/"))
  const link = (s: Screen, wide: boolean) => (
    <a key={s.path} href={"#" + s.path} onClick={(e) => { e.preventDefault(); route(s.path) }} aria-current={current(s.path) ? "page" : undefined}
      className={wide
        ? "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-muted-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card [&[aria-current=page]_svg]:text-primary"
        : "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-semibold text-faint aria-[current=page]:text-primary"}>
      <s.icon className={wide ? "size-[18px]" : "size-6"} strokeWidth={wide ? 2 : 1.75} />
      {s.label}
    </a>
  )
  return (
    <div className="min-h-screen min-[900px]:grid min-[900px]:grid-cols-[224px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-0.5 border-r bg-secondary px-3 py-5 min-[900px]:flex">
        <div className="flex items-center gap-2 px-3 pb-4 font-serif text-lg font-semibold text-primary-ink"><Moon className="size-[18px]" /> Evening</div>
        {SCREENS.map((s) => link(s, true))}
      </aside>
      <main className="min-w-0 pb-24 min-[900px]:pb-6">{children}</main>
      <nav aria-label="Screens" className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background/90 px-2 pt-1 backdrop-blur-xl min-[900px]:hidden"
        style={{ paddingBottom: "max(6px, var(--amber-safe-bottom, 0px), var(--amber-inset-bottom, 0px))" }}>
        {SCREENS.map((s) => link(s, false))}
      </nav>
    </div>
  )
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid max-w-[1040px] gap-4 px-[18px] pt-5 pb-6 min-[900px]:px-8 min-[900px]:pt-8">{children}</div>
}

export function PageHeader({ kicker, title, sub, right }: { kicker?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {kicker && <div className="kicker">{kicker}</div>}
        <h1 className="mt-1.5 font-serif text-[1.85rem] leading-[1.12] font-semibold tracking-[-.01em] text-balance">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </header>
  )
}

export const Grid = ({ children }: { children: ReactNode }) => <div className="grid items-start gap-3.5 md:grid-cols-2">{children}</div>

export function Panel({ title, right, className, children, ...rest }: { title?: ReactNode; right?: ReactNode; className?: string; children: ReactNode } & ComponentProps<"section">) {
  return (
    <section className={cn("card-calm grid min-w-0 gap-3 p-[18px]", className)} {...rest}>
      {(title || right) && <div className="flex items-center justify-between gap-2.5"><h3 className="text-base font-semibold">{title}</h3>{right}</div>}
      {children}
    </section>
  )
}

export const RoundButton = ({ className, ...p }: ComponentProps<"button">) => (
  <button className={cn("grid size-[54px] shrink-0 place-items-center rounded-full bg-secondary text-primary-ink transition active:scale-95 disabled:opacity-35", className)} {...p} />
)

export function Stepper({ label, value, onChange, step = 0.5, min = 0, max = 24, unit = "h", hint, compact }: {
  label: string; value: number | null; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string; compact?: boolean
}) {
  const v = value ?? 0
  const set = (x: number) => onChange(Math.max(min, Math.min(max, Math.round(x / step) * step)))
  return (
    <div className={cn("flex items-center gap-2.5 rounded-[22px] py-4 pr-4 pl-5", compact ? "bg-secondary py-3" : "card-calm")}>
      <div className="grid min-w-0 flex-1">
        <span className="text-[15px] text-muted-foreground">{label}</span>
        <b className={cn("num font-rounded leading-[1.05] font-semibold tracking-[-.02em]", compact ? "text-[2rem]" : "text-[2.7rem]")}>
          {value == null ? "–" : v}<small className="ml-0.5 text-[1.15rem] font-medium text-muted-foreground">{unit}</small>
        </b>
        {hint && <em className="text-[13px] text-muted-foreground not-italic">{hint}</em>}
      </div>
      <RoundButton aria-label={`${label}: less`} disabled={v <= min} onClick={() => set(v - step)} className={compact ? "size-[46px] bg-card" : ""}><Minus className="size-5" /></RoundButton>
      <RoundButton aria-label={`${label}: more`} disabled={v >= max} onClick={() => set(v + step)} className={compact ? "size-[46px] bg-card" : ""}><Plus className="size-5" /></RoundButton>
    </div>
  )
}

export function Scale({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={label}>
      <div className="flex justify-between text-base"><b className="font-semibold">{label}</b><span className="num font-semibold text-primary-ink">{value ?? ""}</span></div>
      <div className="grid grid-cols-10 gap-1 max-[360px]:gap-[3px]">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} role="radio" aria-checked={n === value} aria-label={`${label} ${n}`} onClick={() => onChange(n === value ? null : n)}
            className={cn("num h-10 rounded-[10px] text-[15px] font-semibold transition active:scale-95 max-[360px]:text-[13px]",
              n === value ? "bg-primary text-primary-foreground" : value && n < value ? "bg-primary-soft text-primary-ink" : "bg-card text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]")}>{n}</button>
        ))}
      </div>
    </div>
  )
}

export function YesNo({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  const opt = (v: "Yes" | "No") => (
    <button role="radio" aria-checked={value === v} aria-label={`${label}: ${v}`} onClick={() => onChange(value === v ? "" : v)}
      className={cn("h-10 rounded-[11px] px-[15px] text-[15px] font-semibold text-muted-foreground transition max-[360px]:px-[11px]",
        value === v && (v === "Yes" ? "bg-good text-white" : "bg-card text-bad shadow-sm"))}>{v}</button>
  )
  return <div className="flex shrink-0 rounded-[14px] bg-secondary p-[3px]" role="radiogroup" aria-label={label}>{opt("Yes")}{opt("No")}</div>
}

/** A labelled field on a white card; text areas grow with what's written. */
export function Field({ label, value, onChange, placeholder, multiline, rows = 1 }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number }) {
  const cls = "w-full resize-none bg-transparent py-0.5 text-[17px] leading-snug outline-none placeholder:text-faint"
  return (
    <label className="card-calm grid gap-1 px-[18px] pt-3 pb-2.5">
      <b className="text-xs font-bold tracking-[.06em] text-muted-foreground uppercase">{label}</b>
      {multiline
        ? <textarea aria-label={label} rows={rows} value={value ?? ""} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} className={cls + " field-sizing-content min-h-[1.6em]"} />
        : <input aria-label={label} value={value ?? ""} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLInputElement).value)} enterKeyHint="next" className={cls} />}
    </label>
  )
}

/** A small line for one rating over the last days, with gaps where nothing was logged. */
export function Spark({ values, h = 34 }: { values: (number | null)[]; h?: number }) {
  const w = 100, n = values.length, x = (i: number) => (n < 2 ? w / 2 : (i / (n - 1)) * w), y = (v: number) => h - 3 - ((v - 1) / 9) * (h - 6)
  let d = "", pen = false
  values.forEach((v, i) => { if (v == null) { pen = false; return } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true })
  const last = values.map((v, i) => [v, i] as const).filter(([v]) => v != null).at(-1)
  return (
    <svg className="block h-[34px] w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0,${y(5.5)}H${w}`} stroke="var(--border)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={x(last[1])} cy={y(last[0]!)} r={2.6} fill="var(--primary)" />}
    </svg>
  )
}

/** Hours against a budget: the good part, the rest, and where an even pace would be today. */
export function Meter({ good, total, budget, pace }: { good: number; total: number; budget: number; pace?: number | null }) {
  const p = (v: number) => Math.min(100, (v / Math.max(budget, 0.1)) * 100)
  return (
    <div className="relative flex h-2.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${total} of ${budget} hours, ${good} good`}>
      <i className="bg-primary" style={{ width: `${p(good)}%` }} />
      <i className="bg-mid" style={{ width: `${Math.max(0, p(total) - p(good))}%` }} />
      {pace != null && <s className="absolute -inset-y-0.5 w-0.5 rounded-sm bg-foreground/50" style={{ left: `${p(pace)}%` }} />}
    </div>
  )
}

/** A habit's week: green done, red missed, a ring for still to do, a dash for an off day. */
export function Marks({ marks, dates, today }: { marks: string[]; dates: string[]; today: string }) {
  return (
    <span className="flex gap-1 max-[360px]:gap-[3px]" aria-hidden="true">
      {marks.map((m, i) => (
        <i key={i} className={cn("relative size-3 rounded-full max-[360px]:size-[9px]",
          m === "off" ? "after:absolute after:inset-x-1 after:top-[5.5px] after:h-px after:bg-border max-[360px]:after:top-1 max-[360px]:after:inset-x-[3px]"
            : m === "Yes" ? "bg-good" : m === "No" ? "bg-bad/75"
            : dates[i] > today ? "shadow-[inset_0_0_0_1.5px_var(--border)]" : "shadow-[inset_0_0_0_1.5px_var(--faint)]")} />
      ))}
    </span>
  )
}

/** The iOS-sized switch, on shadcn's Switch. */
export const BigSwitch = (p: ComponentProps<typeof Switch>) => (
  <Switch {...p} className="h-[31px] w-[51px] data-[state=checked]:bg-[#34C759] [&_[data-slot=switch-thumb]]:size-[27px] [&_[data-slot=switch-thumb]]:bg-white [&_[data-slot=switch-thumb]]:shadow [&_[data-slot=switch-thumb][data-state=checked]]:translate-x-[21px] [&_[data-slot=switch-thumb][data-state=unchecked]]:translate-x-[1px]" />
)
