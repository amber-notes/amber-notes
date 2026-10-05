// The tabs: Workout (start), History, Exercises, Progress, Settings. Plus the screens they push.
const Top = ({ title, sub, children, backTo }) => html`
  ${backTo ? html`<button class="back" onClick=${() => back()}>${I("back")}<span>${backTo}</span></button>` : null}
  <header class="top"><div class="grow"><h1>${title}</h1>${sub ? html`<div class="sub">${sub}</div>` : null}</div>${children}</header>`;
const summaryOf = (r) => r.exercises.map((e) => exById(e.ex).name).join(", ");
const lastDone = (rid) => workouts().find((w) => w.routine === rid);

// ---------- Workout: start one ----------
function Home({ note }) {
  const rs = V().routines || [], folders = [...new Set([...(V().folders || []), ...rs.map((r) => r.folder).filter(Boolean)])];
  const [closed, setClosed] = useState({});
  const ws = workouts(), today = note.today, week = ws.filter((w) => D.diff(today, day(w.start)) < 7 && D.wd(today) >= D.wd(day(w.start)) && D.diff(today, day(w.start)) <= D.wd(today)).length;
  const next = (() => { const last = ws[0]; if (!last || !last.routine) return rs[0]; const i = rs.findIndex((r) => r.id === last.routine); return rs[(i + 1) % rs.length]; })();
  const card = (r) => { const l = lastDone(r.id); return html`<div class="card routine">
    <h3><span class="grow ell">${r.name}</span><button class="round" style="width:2.2rem;height:2.2rem" onClick=${() => routineMenu(r)} aria-label=${`More for ${r.name}`}>${I("more")}</button></h3>
    <p class="ell">${summaryOf(r)}</p>
    <div class="acts"><button class="btn primary" onClick=${() => startWorkout(r)}>${I("play")} Start</button><button class="btn" onClick=${() => route(`/routine/${r.id}`)}>Edit</button><span class="grow"></span><span class="small muted" style="align-self:center">${l ? rel(day(l.start), today) : "Not done yet"}</span></div></div>`; };
  const loose = rs.filter((r) => !r.folder);
  return html`<div class="screen">
    <${Top} title="Workout" sub=${week ? `${week} ${week === 1 ? "workout" : "workouts"} this week` : "Nothing yet this week"} />
    ${active() ? null : html`<section class="startcard">
      ${next ? html`<button class="card row" style="padding:1rem;min-height:4.6rem" onClick=${() => startWorkout(next)}><span class="glyph" style="--mc:var(--c-amber)">${I("play")}</span><span class="grow"><span class="small muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">Up next</span><b style="display:block;font-size:1.15rem">${next.name}</b><span class="small muted ell" style="display:block">${summaryOf(next)}</span></span>${I("chev", "i chev")}</button>` : null}
      <button class="btn big" onClick=${() => startWorkout(null)}>${I("plus")} Start an empty workout</button></section>`}
    <div class="label"><span class="grow">Routines</span><button onClick=${newFolder}>New folder</button><button onClick=${newRoutine}>New routine</button></div>
    ${folders.map((f) => { const list = rs.filter((r) => r.folder === f); return html`<div>
      <button class="folder" aria-expanded=${!closed[f]} onClick=${() => setClosed({ ...closed, [f]: !closed[f] })}>${I("down")}<span class="grow" style="text-align:left">${f}</span><span class="num">${list.length}</span></button>
      ${closed[f] ? null : list.length ? html`<div class="rgrid">${list.map(card)}</div>` : html`<p class="small muted" style="margin:0 .2rem">Empty. Move a routine here from its menu.</p>`}</div>`; })}
    ${loose.length ? html`<button class="folder" aria-expanded="true">${I("down")}<span class="grow" style="text-align:left">Other routines</span><span class="num">${loose.length}</span></button><div class="rgrid">${loose.map(card)}</div>` : null}
    ${rs.length ? null : html`<div class="card empty">${I("dumbbell")}<h3>No routines yet</h3><p>A routine is a workout you repeat: its exercises, sets and rest times.</p><button class="btn primary" onClick=${newRoutine}>${I("plus")} New routine</button></div>`}
  </div>`;
}
async function saveRoutines(rs) { await amber.store.set("routines", rs); }
async function newRoutine() { const r = { id: uid(), name: "New routine", folder: null, exercises: [] }; await saveRoutines([...(V().routines || []), r]); route(`/routine/${r.id}`); }
function newFolder() {
  let name = "";
  openSheet({ title: "New folder", body: () => html`<label class="field">Name<input class="in" autofocus placeholder="Upper / lower" onInput=${(e) => (name = e.target.value)} /></label>`,
    foot: () => html`<button class="btn primary" onClick=${() => { if (name.trim()) amber.setData({ values: { folders: [...(V().folders || []), name.trim()] } }); closeSheet(); }}>Add folder</button>` });
}
function routineMenu(r) {
  const rs = V().routines || [], i = rs.findIndex((x) => x.id === r.id), folders = V().folders || [];
  const sameFolder = rs.map((x, k) => [x, k]).filter(([x]) => x.folder === r.folder).map(([, k]) => k), pos = sameFolder.indexOf(i);
  const move = (to) => { const c = rs.slice(); const [m] = c.splice(i, 1); c.splice(to, 0, m); saveRoutines(c); closeSheet(); };
  openSheet({ title: r.name, body: () => html`<div class="card list menu">
    ${pos > 0 ? html`<button class="row" onClick=${() => move(sameFolder[pos - 1])}>${I("up")}<span class="grow">Move up</span></button>` : null}
    ${pos < sameFolder.length - 1 ? html`<button class="row" onClick=${() => move(sameFolder[pos + 1])}>${I("down")}<span class="grow">Move down</span></button>` : null}
    <div class="row">${I("folder")}<span class="grow">Folder</span><select class="in" style="width:auto;max-width:11rem" aria-label="Folder" onChange=${(e) => { saveRoutines(rs.map((x) => (x.id === r.id ? { ...x, folder: e.target.value || null } : x))); closeSheet(); }}>
      <option value="" selected=${!r.folder}>None</option>${folders.map((f) => html`<option selected=${f === r.folder}>${f}</option>`)}</select></div>
    <button class="row" onClick=${() => { saveRoutines([...rs, { ...JSON.parse(JSON.stringify(r)), id: uid(), name: r.name + " (copy)" }]); closeSheet(); }}>${I("copy")}<span class="grow">Duplicate</span></button>
    <button class="row red" onClick=${() => { saveRoutines(rs.filter((x) => x.id !== r.id)); closeSheet(); }}>${I("trash")}<span class="grow">Delete routine</span></button></div>` });
}

// ---------- A routine, edited ----------
function RoutineEdit({ id }) {
  const rs = V().routines || [], r = rs.find((x) => x.id === id);
  if (!r) return html`<div class="screen"><${Top} title="Routine" backTo="Workout" /><p class="muted">This routine is gone.</p></div>`;
  const save = (fn) => { const c = JSON.parse(JSON.stringify(rs)); fn(c.find((x) => x.id === id)); saveRoutines(c); };
  return html`<div class="screen redit">
    <${Top} title=${r.name} sub=${`${r.exercises.length} exercises · ${r.exercises.reduce((n, e) => n + e.sets.length, 0)} sets`} backTo="Workout"><button class="btn primary" onClick=${() => startWorkout(r)}>${I("play")} Start</button></${Top}>
    <label class="field" style="margin-bottom:.8rem">Name<input class="in" key=${r.name} defaultValue=${r.name} onChange=${(e) => save((x) => { x.name = e.target.value.trim() || x.name; })} /></label>
    ${r.exercises.map((e, ei) => { const ex = exById(e.ex); return html`<section class="card exc">
      <div class="exh"><${Glyph} ex=${ex} sm /><h3 class="grow ell">${ex.name}</h3>
        <button class="iconb" disabled=${!ei} onClick=${() => save((x) => { const [m] = x.exercises.splice(ei, 1); x.exercises.splice(ei - 1, 0, m); })} aria-label=${`Move ${ex.name} up`}>${I("up")}</button>
        <button class="iconb" onClick=${() => save((x) => { x.exercises.splice(ei, 1); })} aria-label=${`Remove ${ex.name}`}>${I("trash")}</button></div>
      <div class="tsets"><span class="small muted" style="font-weight:700;text-align:center">SET</span><span class="small muted" style="font-weight:700">TYPE</span><span class="small muted" style="font-weight:700;text-align:center">REPS</span><span></span>
        ${e.sets.map((s, si) => html`<span class=${"setno " + (s.type || "normal")} style="display:grid;place-items:center;height:2.3rem">${s.type && s.type !== "normal" ? TYPE_LETTER[s.type] : e.sets.slice(0, si + 1).filter((x) => (x.type || "normal") === "normal").length}</span>
          <select class="in" style="min-height:2.3rem;padding:.3rem .5rem" aria-label="Set type" onChange=${(ev) => save((x) => { x.exercises[ei].sets[si].type = ev.target.value; })}>${TYPES.map((t) => html`<option value=${t} selected=${(s.type || "normal") === t}>${{ normal: "Working", warmup: "Warm-up", drop: "Drop", failure: "Failure" }[t]}</option>`)}</select>
          <input inputmode="numeric" aria-label="Target reps" key=${"t" + s.reps} defaultValue=${s.reps || ""} onChange=${(ev) => save((x) => { x.exercises[ei].sets[si].reps = parseNum(ev.target.value); })} />
          <button class="iconb" onClick=${() => save((x) => { x.exercises[ei].sets.splice(si, 1); })} aria-label="Remove set">${I("close")}</button>`)}</div>
      <div style="display:flex;gap:.5rem;padding:.2rem .9rem .5rem;align-items:center;flex-wrap:wrap"><button class="btn" style="min-height:2.3rem" onClick=${() => save((x) => { const l = x.exercises[ei].sets.at(-1); x.exercises[ei].sets.push({ type: "normal", reps: l ? l.reps : 8 }); })}>${I("plus")} Set</button>
        <span class="grow"></span><span class="small muted">Rest</span><select class="in" style="width:auto;min-height:2.3rem" aria-label="Rest" onChange=${(ev) => save((x) => { x.exercises[ei].rest = +ev.target.value; })}>${[60, 90, 120, 150, 180, 240].map((v) => html`<option value=${v} selected=${(e.rest || S().rest) === v}>${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}</option>`)}</select></div>
    </section>`; })}
    <button class="btn tint big block" onClick=${() => pickExercises((ids) => save((x) => { ids.forEach((id2) => x.exercises.push({ ex: id2, rest: null, sets: [{ type: "normal", reps: 8 }, { type: "normal", reps: 8 }, { type: "normal", reps: 8 }] })); }))}>${I("plus")} Add exercises</button>
  </div>`;
}

// ---------- History ----------
function History({ note }) {
  const [month, setMonth] = useState(note.today.slice(0, 7));
  const ws = workouts(), days = new Set(ws.map((w) => day(w.start)));
  const first = month + "-01", lead = D.wd(first), dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  const shift = (n) => { const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const inMonth = ws.filter((w) => w.start.slice(0, 7) === month);
  // Weeks in a row with at least one workout, up to this one.
  let streak = 0; for (let k = 0; ; k++) { const ws0 = D.add(note.today, -D.wd(note.today) - 7 * k); if (ws.some((w) => day(w.start) >= ws0 && day(w.start) < D.add(ws0, 7))) streak++; else if (k > 0) break; else continue; if (k > 60) break; }
  return html`<div class="screen wide">
    <${Top} title="History" sub=${`${ws.length} workouts · ${streak}-week streak`} />
    <div class="histgrid"><div>
      <section class="card cal"><div class="mh"><b>${D.fmt(first, { month: "long", year: "numeric" })}</b>
        <button class="round" onClick=${() => shift(-1)} aria-label="Previous month">${I("back")}</button><button class="round" onClick=${() => shift(1)} aria-label="Next month">${I("chev")}</button></div>
        <div class="g">${["M", "T", "W", "T", "F", "S", "S"].map((x) => html`<span class="wd">${x}</span>`)}${Array.from({ length: lead }, () => html`<span></span>`)}
          ${Array.from({ length: dim }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, "0")}`, w = ws.find((x) => day(x.start) === d);
            return html`<button class=${"d num" + (days.has(d) ? " on" : "") + (d === note.today ? " today" : "") + (d > note.today ? " out" : "")} onClick=${() => w && route(`/workout/${w.id}`)} aria-label=${D.fmt(d) + (w ? `, ${w.name}` : "")}>${i + 1}</button>`; })}</div></section>
      <div class="kpis" style="margin-top:.6rem">${[["Workouts", inMonth.length], ["Volume", fmtVol(inMonth.reduce((a, w) => a + volume(w), 0))], ["Time", fmtDur(inMonth.reduce((a, w) => a + (w.minutes || 0), 0))], ["Sets", inMonth.reduce((a, w) => a + w.exercises.reduce((n, e) => n + working(e.sets).length, 0), 0)]].map(([k, v]) => html`<div style="background:var(--amber-surface)"><b class="num">${v}</b><span>${k}</span></div>`)}</div>
    </div><div>
      <div class="label"><span class="grow">${D.fmt(first, { month: "long" })}</span></div>
      <div class="hgrid">${inMonth.length ? inMonth.map((w) => html`<${WCard} w=${w} today=${note.today} />`) : html`<div class="card empty"><p>No workouts this month.</p></div>`}</div>
    </div></div></div>`;
}
function WCard({ w, today }) {
  const prs = prsOf(w).length;
  return html`<button class="wcard" onClick=${() => route(`/workout/${w.id}`)}>
    <h3><span class="grow ell">${w.name}</span><span class="small muted" style="font-weight:600">${rel(day(w.start), today)}</span></h3>
    <div class="meta"><span><b class="num">${fmtDur(w.minutes || 0)}</b></span><span><b class="num">${fmtVol(volume(w))}</b></span>${prs ? html`<span style="color:var(--warm);font-weight:700">${I("trophy")} ${prs} ${prs === 1 ? "record" : "records"}</span>` : null}</div>
    <div class="ex">${w.exercises.map((e) => html`<div class="ell">${working(e.sets).length} × ${exById(e.ex).name} <span class="muted">${(() => { const t = working(e.sets).reduce((b, s) => (s.kg > (b ? b.kg : -1) ? s : b), null); return t ? `· ${t.kg ? fmtW(t.kg) + " × " : ""}${t.reps}` : ""; })()}</span></div>`)}</div></button>`;
}
function WorkoutView({ id, note }) {
  const w = C("workouts").find((x) => x.id === id);
  if (!w) return html`<div class="screen"><${Top} title="Workout" backTo="History" /><p class="muted">This workout was deleted.</p></div>`;
  const prs = prsOf(w);
  return html`<div class="screen">
    <${Top} title=${w.name} sub=${D.fmt(day(w.start), { weekday: "long", day: "numeric", month: "long" })} backTo="History" />
    <div class="kpis" style="margin:0 0 .4rem">${[["Duration", fmtDur(w.minutes || 0)], ["Volume", fmtVol(volume(w))], ["Sets", w.exercises.reduce((n, e) => n + working(e.sets).length, 0)], ["Records", prs.length]].map(([k, v]) => html`<div style="background:var(--amber-surface)"><b class="num">${v}</b><span>${k}</span></div>`)}</div>
    ${w.exercises.map((e) => { const ex = exById(e.ex), pr = prs.find((p) => p.ex === e.ex); return html`<section class="card exc" style="margin-top:.7rem">
      <div class="exh"><${Glyph} ex=${ex} sm /><a class="grow ell" href=${`#/exercise/${e.ex}`} style="color:var(--amber-accent-text);font-weight:700;text-decoration:none">${ex.name}</a>${pr ? html`<span class="pr">PR</span>` : null}</div>
      <div class="card list" style="background:none">${e.sets.map((s, i) => html`<div class="row" style="min-height:2.4rem;padding:.35rem .9rem"><span class=${"setno " + s.type} style="width:2rem;display:grid;place-items:center;height:1.9rem">${s.type === "normal" ? e.sets.slice(0, i + 1).filter((x) => x.type === "normal").length : TYPE_LETTER[s.type]}</span><span class="grow num">${s.kg ? `${fmtW(s.kg)} ${unit()} × ` : ""}${s.reps}${s.rpe ? html` <span class="muted">@ ${s.rpe}</span>` : ""}</span><span class="small muted num">${s.kg && s.type !== "warmup" ? `${Math.round(toUnit(e1rm(s.kg, s.reps)))} 1RM` : ""}</span></div>`)}</div></section>`; })}
    <div style="display:grid;gap:.6rem;margin-top:1rem"><button class="btn tint" onClick=${() => saveAsRoutine(w)}>${I("copy")} Save as a routine</button><button class="btn danger" onClick=${() => deleteWorkout(w)}>${I("trash")} Delete workout</button></div>
  </div>`;
}
function deleteWorkout(w) {
  openSheet({ title: "Delete this workout?", body: () => html`<p class="muted">It's removed from the app and its rows from the note's log. Undo in the note brings the rows back.</p>`,
    foot: () => html`<button class="btn" onClick=${closeSheet}>Keep</button><button class="btn" style="background:var(--amber-danger);color:#fff" onClick=${async () => {
      const t = logTable(amber.note);
      if (t) { const di = t.columns.findIndex((c) => /^date$/i.test(c.name)), wi = t.columns.findIndex((c) => /^workout$/i.test(c.name));
        const rows = t.rows.map((r, i) => [r, i]).filter(([r]) => r[di] === day(w.start) && r[wi] === w.name).map(([, i]) => i).reverse();
        if (rows.length) await amber.update(rows.map((row) => ({ op: "delete_row", table: t.index, row }))); }
      await amber.store.collection("workouts").remove(w.id); closeSheet(); back(); }}>Delete</button>` });
}

// ---------- Exercises ----------
function Library() {
  const [q, setQ] = useState(""), [m, setM] = useState("All"), [eq, setEq] = useState("All");
  const counts = {}; for (const w of workouts()) for (const e of w.exercises) counts[e.ex] = (counts[e.ex] || 0) + 1;
  const list = allExercises().filter((x) => (m === "All" || x.muscle === m || x.other.includes(m)) && (eq === "All" || x.equipment === eq) && (!q || x.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name));
  return html`<div class="screen wide lib">
    <${Top} title="Exercises" sub=${`${allExercises().length} exercises · ${(V().custom || []).length} of your own`}><button class="round accent" onClick=${() => customExercise("", (id) => route(`/exercise/${id}`))} aria-label="New exercise">${I("plus")}</button></${Top}>
    <div class="search">${I("search")}<input class="in" type="search" placeholder="Search" aria-label="Search exercises" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    <div class="chips" style="margin-top:.6rem" role="group" aria-label="Muscle">${["All", ...MUSCLES].map((x) => html`<button class="chip" aria-pressed=${x === m} onClick=${() => setM(x)}>${x}</button>`)}</div>
    <div class="chips" role="group" aria-label="Equipment">${["All", ...EQUIPMENT].map((x) => html`<button class="chip" aria-pressed=${x === eq} onClick=${() => setEq(x)}>${x === "All" ? "Any equipment" : x}</button>`)}</div>
    <section class="card list libgrid">${list.map((x) => html`<a class="row" href=${`#/exercise/${x.id}`}><${Glyph} ex=${x} /><span class="grow"><b class="ell" style="display:block">${x.name}</b><span class="meta">${x.muscle}${x.other.length ? ` · ${x.other.slice(0, 2).join(", ")}` : ""} · ${x.equipment}</span></span>${counts[x.id] ? html`<span class="small muted num">${counts[x.id]}×</span>` : null}${I("chev", "i chev")}</a>`)}
      ${list.length ? null : html`<div class="empty"><p>Nothing matches.</p></div>`}</section></div>`;
}
function ExerciseView({ id, note }) {
  const ex = exById(id), r = records(id), [metric, setMetric] = useState("e1rm");
  const pts = r.sessions.slice(-16).map((s) => ({ v: metric === "e1rm" ? toUnit(s.e1rm) : metric === "weight" ? toUnit(s.weight) : toUnit(s.vol), label: D.fmt(s.date, { day: "numeric", month: "short" }) }));
  const hist = workouts().filter((w) => w.exercises.some((e) => e.ex === id)).slice(0, 8);
  return html`<div class="screen wide">
    <${Top} title=${ex.name} sub=${`${ex.muscle}${ex.other.length ? ` · ${ex.other.join(", ")}` : ""} · ${ex.equipment}`} backTo="Back" />
    ${r.sessions.length ? html`<div class="twocol"><div>
      <section class="card chartc"><div class="seg" role="group" aria-label="Chart" style="margin-bottom:.8rem">${[["e1rm", "Est. 1RM"], ["weight", "Heaviest"], ["vol", "Volume"]].map(([k, l]) => html`<button aria-pressed=${metric === k} onClick=${() => setMetric(k)}>${l}</button>`)}</div>
        <div class="headline"><b class="num">${pts.length ? Kit0(pts.at(-1).v) : "–"} ${unit()}</b><span class="muted small">last time · ${r.sessions.length} sessions</span></div>
        <${Chart} points=${pts} fmt=${(v) => Math.round(v)} /></section>
      <div class="label">Records</div>
      <div class="recs"><div><span>Heaviest weight</span><b class="num">${fmtW(r.weight)} ${unit()}</b></div><div><span>Best est. 1RM</span><b class="num">${Math.round(toUnit(r.e1rm))} ${unit()}</b></div><div><span>Best set volume</span><b class="num">${fmtVol(r.setVol)}</b></div><div><span>Most reps</span><b class="num">${r.reps}</b></div></div>
    </div><div>
      <div class="label" style="margin-top:.2rem">History</div>
      <section class="card list">${hist.map((w) => { const e = w.exercises.find((x) => x.ex === id); return html`<a class="row" href=${`#/workout/${w.id}`}><span class="grow"><b>${D.fmt(day(w.start), { weekday: "short", day: "numeric", month: "short" })}</b><div class="small muted">${e.sets.map((s) => setText(s, ex)).join(" · ")}</div></span>${I("chev", "i chev")}</a>`; })}</section>
    </div></div>` : html`<div class="card empty">${I("chart")}<h3>Not done yet</h3><p>Do it in a workout and its history, records and charts show here.</p></div>`}
  </div>`;
}
const Kit0 = (v) => (Number.isInteger(v) ? v : String(Math.round(v * 10) / 10).replace(".", ","));

// ---------- Progress ----------
function Progress({ note }) {
  const ws = workouts(), today = note.today, wk0 = D.add(today, -D.wd(today));
  const thisWeek = ws.filter((w) => day(w.start) >= wk0);
  const sets = {}; for (const w of thisWeek) for (const e of w.exercises) { const x = exById(e.ex), n = working(e.sets).length; sets[x.muscle] = (sets[x.muscle] || 0) + n; for (const o of x.other) sets[o] = (sets[o] || 0) + n / 2; }
  const muscles = Object.entries(sets).sort((a, b) => b[1] - a[1]), mx = Math.max(1, ...muscles.map((m) => m[1]));
  const weeks = Array.from({ length: 10 }, (_, k) => { const s = D.add(wk0, -7 * (9 - k)); const v = ws.filter((w) => day(w.start) >= s && day(w.start) < D.add(s, 7)).reduce((a, w) => a + volume(w), 0); return { v: toUnit(v) / 1000, label: D.fmt(s, { day: "numeric", month: "short" }), dim: k === 9 }; });
  const recent = []; for (const w of ws.slice(0, 12)) for (const p of prsOf(w)) recent.push({ ...p, date: day(w.start) });
  const bw = C("bodyweight").slice().sort((a, b) => a.date.localeCompare(b.date));
  return html`<div class="screen wide">
    <${Top} title="Progress" sub=${`This week: ${thisWeek.length} ${thisWeek.length === 1 ? "workout" : "workouts"}`} />
    <div class="twocol"><div>
      <div class="label" style="margin-top:.2rem">Sets per muscle this week</div>
      <section class="card" style="padding:.5rem 0">${muscles.length ? muscles.map(([m, n]) => html`<div class="mbar" style=${`--mc:var(${MCOLOR[m]})`}><span>${m}</span><i><b style=${`width:${(n / mx) * 100}%`}></b></i><span class="num muted" style="text-align:right">${Math.round(n)}</span></div>`) : html`<div class="empty"><p>No sets yet this week.</p></div>`}</section>
      <p class="small muted" style="margin:.4rem .2rem">Counts the main muscle fully and the others at half.</p>
      <div class="label">Volume per week</div>
      <section class="card chartc"><${Chart} bars points=${weeks} fmt=${(v) => `${Math.round(v)} t`} height=${160} /></section>
    </div><div>
      <div class="label" style="margin-top:.2rem">Recent records</div>
      <section class="card list">${recent.length ? recent.slice(0, 8).map((p) => html`<a class="row" href=${`#/exercise/${p.ex}`}><${Glyph} ex=${p.ex} sm /><span class="grow"><b class="ell" style="display:block">${exById(p.ex).name}</b><span class="small muted">${p.kind} · ${rel(p.date, today)}</span></span><b class="num">${p.value}</b></a>`) : html`<div class="empty"><p>Records show up as you beat them.</p></div>`}</section>
      <div class="label"><span class="grow">Bodyweight</span><button onClick=${addWeight}>Add</button></div>
      <section class="card chartc bw">${bw.length ? html`<div class="headline"><b class="num">${fmtW(bw.at(-1).kg)} ${unit()}</b><span class="muted small">${bw.length > 1 ? `${bw.at(-1).kg - bw[0].kg > 0 ? "+" : "−"}${fmtW(Math.abs(bw.at(-1).kg - bw[0].kg))} since ${D.fmt(bw[0].date, { day: "numeric", month: "short" })}` : ""}</span></div><${Chart} points=${bw.map((b) => ({ v: toUnit(b.kg), label: D.fmt(b.date, { day: "numeric", month: "short" }) }))} fmt=${(v) => Math.round(v)} height=${140} />` : html`<div class="empty"><p>Log your weight now and then to see the trend.</p></div>`}</section>
    </div></div></div>`;
}
function addWeight() {
  let v = "";
  openSheet({ title: "Bodyweight", body: () => html`<label class="field">Today, in ${unit()}<input class="in num" inputmode="decimal" autofocus style="font-size:1.6rem;text-align:center;min-height:3.4rem" onInput=${(e) => (v = e.target.value)} /></label>`,
    foot: () => html`<button class="btn primary" onClick=${async () => { const n = parseNum(v); if (!n) return; await amber.store.collection("bodyweight").add({ date: amber.note.today, kg: Math.round(fromUnit(n) * 10) / 10 }); closeSheet(); }}>Save</button>` });
}

// ---------- Settings ----------
function Settings() {
  const s = S(), [target, setTarget] = useState(100);
  const plates = (() => { let side = (fromUnit(target) - s.bar) / 2; const out = []; if (side < 0) return null;
    for (const p of [...s.plates].sort((a, b) => b - a)) while (side >= p - 1e-6) { out.push(p); side -= p; }
    return { out, left: Math.round(side * 2 * 100) / 100 }; })();
  const PCOL = { 25: "#C62828", 20: "#1E5BB8", 15: "#D9A400", 10: "#2E7D32", 5: "#555", 2.5: "#888", 1.25: "#aaa" };
  const row = (label, help, control) => html`<div class="row" style="flex-wrap:wrap"><span class="grow">${label}${help ? html`<div class="small muted">${help}</div>` : null}</span>${control}</div>`;
  const sel = (key, opts) => html`<select class="in" style="width:auto;min-width:8rem" aria-label=${key} onChange=${(e) => saveSettings({ [key]: isNaN(+e.target.value) ? e.target.value : +e.target.value })}>${opts.map(([v, l]) => html`<option value=${v} selected=${String(s[key]) === String(v)}>${l}</option>`)}</select>`;
  const tog = (key) => html`<input class="switch" type="checkbox" role="switch" aria-label=${key} checked=${s[key]} onChange=${(e) => saveSettings({ [key]: e.target.checked })} />`;
  return html`<div class="screen">
    <${Top} title="Settings" />
    <section class="card list">
      ${row("Units", "", sel("unit", [["kg", "Kilograms"], ["lb", "Pounds"]]))}
      ${row("Rest between sets", "Each exercise can have its own.", sel("rest", [60, 90, 120, 150, 180, 240].map((v) => [v, `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`])))}
      ${row("Rest after warm-up sets", "", sel("restWarmup", [30, 45, 60, 90].map((v) => [v, `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`])))}
      ${row("Notify when rest is over", "Even with the phone locked.", tog("notify"))}
      ${row("Show RPE", "Rate of perceived exertion, per set.", tog("showRpe"))}
    </section>
    <div class="label">Plate calculator</div>
    <section class="card pad">
      <label class="field">Weight on the bar (${unit()})<input class="in num" inputmode="decimal" style="font-size:1.4rem;text-align:center" value=${target} onInput=${(e) => setTarget(parseNum(e.target.value) || 0)} /></label>
      ${plates ? html`<div class="plates" aria-label=${`Each side: ${plates.out.map(fmtW).join(", ") || "nothing"}`}>
          ${plates.out.slice().reverse().map((p) => html`<i style=${`height:${2.2 + p * .18}rem;background:${PCOL[p] || "#777"}`}>${fmtW(p)}</i>`)}<span class="sleeve"></span><span class="barbell"></span><span class="sleeve"></span>${plates.out.map((p) => html`<i style=${`height:${2.2 + p * .18}rem;background:${PCOL[p] || "#777"}`}>${fmtW(p)}</i>`)}</div>
        <p class="muted small" style="text-align:center">Each side: ${plates.out.length ? plates.out.map(fmtW).join(" + ") : "just the bar"}${plates.left ? ` · ${fmtW(plates.left)} ${unit()} can't be made` : ""}</p>` : html`<p class="muted small" style="margin-top:.6rem">Less than the bar.</p>`}
      <div style="display:flex;gap:.6rem;margin-top:.8rem;align-items:center;flex-wrap:wrap"><span class="small muted">Bar</span>${sel("bar", [[20, "20 kg"], [15, "15 kg"], [10, "10 kg"]])}</div>
      <div class="chips" style="margin-top:.6rem;flex-wrap:wrap" role="group" aria-label="Plates you have">${[25, 20, 15, 10, 5, 2.5, 1.25, .5].map((p) => html`<button class="chip" aria-pressed=${s.plates.includes(p)} onClick=${() => saveSettings({ plates: s.plates.includes(p) ? s.plates.filter((x) => x !== p) : [...s.plates, p] })}>${fmtW(p)}</button>`)}</div>
    </section>
    <p class="small muted" style="margin:.8rem .2rem">Routines, the library and every set are kept with this note's app. Finished workouts are also written into the note's Log, so you and your AI can read them.</p>
  </div>`;
}
