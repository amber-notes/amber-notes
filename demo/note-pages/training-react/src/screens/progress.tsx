import { useState } from "react"
import { CalendarCheck, Flame, Weight } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useSettings } from "@/lib/amber"
import { DEFAULTS, today, weight, useTraining } from "@/lib/training"
import { PageHeader } from "@/components/app-shell"
import { StatCard } from "@/components/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function Progress() {
  const { sets } = useTraining()
  const [{ unit, goal }] = useSettings(DEFAULTS)
  const names = [...new Set(sets.map((s) => s.exercise))].slice(0, 3)
  const [pick, setPick] = useState(names[0])
  const points = sets.filter((s) => s.exercise === pick).map((s) => ({ date: s.date.slice(5).replace("-", "/"), kg: s.weight }))
  const sessions = new Set(sets.map((s) => s.date)).size
  const weeks = Math.max(1, Math.round((Date.parse(today()) - Date.parse(sets[0]?.date ?? today())) / 6048e5))
  const now = points[points.length - 1]

  return (
    <>
      <PageHeader title="Progress" subtitle={`${sessions} sessions`} />
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={CalendarCheck} value={sessions} label="sessions" />
        <StatCard icon={Flame} value={(sessions / weeks).toFixed(1)} label={`a week, goal ${goal}`} />
        <StatCard icon={Weight} value={now ? weight(now.kg, unit) : "–"} label={`${pick ?? ""} now`} />
      </div>
      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Weight over time</CardTitle>
          <Tabs value={pick} onValueChange={setPick}>
            <TabsList>{names.map((n) => <TabsTrigger key={n} value={n}>{n}</TabsTrigger>)}</TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="h-56 px-2 min-[900px]:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ left: 0, right: 12, top: 8 }}>
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <YAxis width={36} tickLine={false} axisLine={false} domain={["dataMin - 5", "dataMax + 5"]} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Area type="monotone" dataKey="kg" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#fill)" dot={{ r: 3, fill: "var(--chart-1)" }} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  )
}
