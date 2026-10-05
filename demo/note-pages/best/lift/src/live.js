// The workout in progress: one screen, no tabs. Kept in the app's data as values.active, so it
// survives closing the note; every edit is a quiet write.
const active = () => V().active || null;
async function editActive(fn) { const a = JSON.parse(JSON.stringify(active())); fn(a); await amber.store.set("active", a); }
const TYPES = ["normal", "warmup", "drop", "failure"];
const TYPE_LETTER = { warmup: "W", drop: "D", failure: "F" };
let restNote = null;

// A new workout: from a routine (its sets, with last time's weights) or empty.
async function startWorkout(r) {
  if (active()) { route("/live"); return; }
  const exercises = r ? r.exercises.map((e) => {
    const prev = previous(e.ex);
    return { ex: e.ex, rest: e.rest || null, superset: e.superset || null, sets: e.sets.map((s, i) => {
      const p = prevFor(prev, e.sets, i);
      return { type: s.type || "normal", kg: p ? p.kg : null, reps: null, target: s.reps || null, done: false };
    }) };
  }) : [];
  await amber.store.set("active", { id: uid(), name: r ? r.name : "Workout", routine: r ? r.id : null, start: new Date().toISOString(), exercises });
  route("/live");
}
// Last time's set to compare with: the same kind of set, by position.
function prevFor(prev, sets, i) {
  const type = sets[i].type || "normal";
  const nth = sets.slice(0, i).filter((s) => (s.type || "normal") === type).length;
  return prev.filter((s) => (s.type || "normal") === type)[nth] || null;
}
const restFor = (e, s) => (s.type === "warmup" ? S().restWarmup : e.rest || S().rest);
// In a superset, rest comes after the last exercise of the group.
function restsAfter(a, ei) {
  const e = a.exercises[ei]; if (!e.superset) return true;
  const next = a.exercises[ei + 1];
  return !(next && next.superset === e.superset);
}
async function startRest(secs, label) {
  await editActive((a) => { a.rest = { until: new Date(Date.now() + secs * 1000).toISOString(), total: secs, label }; });
  if (restNote) amber.device.notify.cancel(restNote);
  restNote = null;
  if (S().notify) { const r = await amber.device.notify({ title: "Rest's over", body: label ? `Next: ${label}` : "Time for the next set.", in: secs }); if (r.ok) restNote = r.id; }
}
async function stopRest() { if (restNote) { amber.device.notify.cancel(restNote); restNote = null; } await editActive((a) => { a.rest = null; }); }
async function nudgeRest(d) {
  const r = active().rest; if (!r) return;
  const left = Math.max(5, Math.round((Date.parse(r.until) - Date.now()) / 1000) + d);
  await startRest(left, r.label);
  await editActive((a) => { a.rest.total = Math.max(a.rest.total + d, left); });
}

async function toggleSet(ei, si) {
  const a = active(), e = a.exercises[ei], s = e.sets[si];
  const prev = prevFor(previous(e.ex, a.start), e.sets, si);
  await editActive((x) => {
    const t = x.exercises[ei].sets[si];
    if (!t.done) { if (t.kg == null && prev) t.kg = prev.kg; if (t.reps == null) t.reps = t.target || (prev && prev.reps) || null; }
    t.done = !t.done;
  });
  if (!s.done && restsAfter(a, ei)) {
    const nx = nextUp(active(), ei, si);
    startRest(restFor(e, s), nx);
  }
}
function nextUp(a, ei, si) {
  for (let i = ei; i < a.exercises.length; i++) for (let k = i === ei ? si + 1 : 0; k < a.exercises[i].sets.length; k++) if (!a.exercises[i].sets[k].done) return exById(a.exercises[i].ex).name;
  for (let i = 0; i < ei; i++) if (a.exercises[i].sets.some((s) => !s.done)) return exById(a.exercises[i].ex).name;
  return "";
}

function Clock({ start }) {
  const [, tick] = useState(0);
  useLayoutEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 1000));
  return html`<span class="num">${s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}` : Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>`;
}
function RestBar({ rest }) {
  const [, tick] = useState(0);
  useLayoutEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.round((Date.parse(rest.until) - Date.now()) / 1000));
  useLayoutEffect(() => { if (left <= 0) stopRest(); }, [left <= 0]);
  return html`<div class="restbar" role="timer" aria-label=${`Rest, ${left} seconds left`}>
    <span class="prog" style=${`width:${(1 - left / rest.total) * 100}%`}></span>
    <div class="in2"><div class="grow"><div class="t num">${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</div><div class="lbl ell">${rest.label ? `Rest · next ${rest.label}` : "Rest"}</div></div>
      <button class="btn" onClick=${() => nudgeRest(-15)} aria-label="Fifteen seconds less">−15</button><button class="btn" onClick=${() => nudgeRest(15)} aria-label="Fifteen seconds more">+15</button><button class="btn primary" onClick=${stopRest}>Skip</button></div></div>`;
}

function SetRow({ a, ei, si, showRpe }) {
  const e = a.exercises[ei], s = e.sets[si], ex = exById(e.ex);
  const prev = prevFor(previous(e.ex, a.start), e.sets, si);
  const n = e.sets.slice(0, si + 1).filter((x) => x.type === "normal").length;
  const label = s.type === "normal" ? String(n) : TYPE_LETTER[s.type];
  const bw = ex.equipment === "Bodyweight";
  const put = (k) => (ev) => { const v = parseNum(ev.target.value); editActive((x) => { x.exercises[ei].sets[si][k] = v == null ? null : k === "kg" ? fromUnit(v) : v; }); };
  const cls = s.done ? "isdone" : "";
  return html`
    <button class=${"setno " + s.type + " " + cls} onClick=${() => setMenu(ei, si)} aria-label=${`Set ${label}, ${s.type === "normal" ? "working set" : s.type + " set"}. Change type`}>${label}</button>
    <span class="prev">${prev ? `${prev.kg ? fmtW(prev.kg) + " × " : ""}${prev.reps}` : "–"}</span>
    <input class=${cls} key=${"kg" + s.kg} inputmode="decimal" aria-label=${`${ex.name} set ${label}, ${unit()}`} placeholder=${prev && prev.kg ? fmtW(prev.kg) : bw ? "0" : "–"} defaultValue=${s.kg != null ? fmtW(s.kg) : ""} onChange=${put("kg")} />
    <input class=${cls} key=${"r" + s.reps} inputmode="numeric" aria-label=${`${ex.name} set ${label}, reps`} placeholder=${s.target || (prev && prev.reps) || "–"} defaultValue=${s.reps ?? ""} onChange=${put("reps")} />
    ${showRpe ? html`<input class=${cls + " rpec"} key=${"p" + s.rpe} inputmode="decimal" aria-label=${`${ex.name} set ${label}, RPE`} placeholder="RPE" defaultValue=${s.rpe ?? ""} onChange=${put("rpe")} />` : html`<span></span>`}
    <button class=${"tick" + (s.done ? " on" : "")} onClick=${() => toggleSet(ei, si)} aria-pressed=${s.done} aria-label=${`${ex.name} set ${label} ${s.done ? "done" : "not done"}`}>${I("check")}</button>`;
}
function setMenu(ei, si) {
  const s = active().exercises[ei].sets[si];
  const pick = (t) => { editActive((a) => { a.exercises[ei].sets[si].type = t; }); closeSheet(); };
  openSheet({ title: "Set type", body: () => html`<div class="card list menu">
    ${[["normal", "Working set", ""], ["warmup", "Warm-up", "W"], ["drop", "Drop set", "D"], ["failure", "To failure", "F"]].map(([t, name, l]) => html`<button class="row" onClick=${() => pick(t)}><span class=${"setno " + t} style="width:2.2rem;display:grid;place-items:center">${l || "1"}</span><span class="grow">${name}</span>${s.type === t ? I("check") : null}</button>`)}
    <button class="row red" onClick=${() => { editActive((a) => { a.exercises[ei].sets.splice(si, 1); }); closeSheet(); }}>${I("trash")}<span class="grow">Remove this set</span></button></div>` });
}
function exMenu(ei) {
  const a = active(), e = a.exercises[ei], ex = exById(e.ex), n = a.exercises.length;
  const act = (fn) => () => { editActive(fn); closeSheet(); };
  const inSS = !!e.superset;
  openSheet({ title: ex.name, body: () => html`<div class="card list menu">
    <button class="row" onClick=${() => { closeSheet(); setTimeout(() => pickExercises((ids) => editActive((x) => { x.exercises[ei].ex = ids[0]; x.exercises[ei].sets.forEach((s) => { s.kg = null; s.done = false; }); }), { single: true }), 50); }}>${I("swap")}<span class="grow">Replace exercise</span></button>
    ${ei > 0 ? html`<button class="row" onClick=${act((x) => { const [m] = x.exercises.splice(ei, 1); x.exercises.splice(ei - 1, 0, m); })}>${I("up")}<span class="grow">Move up</span></button>` : null}
    ${ei < n - 1 ? html`<button class="row" onClick=${act((x) => { const [m] = x.exercises.splice(ei, 1); x.exercises.splice(ei + 1, 0, m); })}>${I("down")}<span class="grow">Move down</span></button>` : null}
    ${inSS ? html`<button class="row" onClick=${act((x) => { x.exercises[ei].superset = null; })}>${I("link")}<span class="grow">Remove from superset</span></button>`
      : ei < n - 1 ? html`<button class="row" onClick=${act((x) => { const g = x.exercises[ei + 1].superset || Math.max(0, ...x.exercises.map((y) => y.superset || 0)) + 1; x.exercises[ei].superset = g; x.exercises[ei + 1].superset = g; })}>${I("link")}<span class="grow">Superset with ${exById(a.exercises[ei + 1].ex).name}</span></button>` : null}
    <div class="row">${I("timer")}<span class="grow">Rest after each set</span><select class="in" style="width:auto" aria-label="Rest time" onChange=${(ev) => editActive((x) => { x.exercises[ei].rest = +ev.target.value; })}>${[0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map((v) => html`<option value=${v} selected=${(e.rest || S().rest) === v}>${v ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}` : "Off"}</option>`)}</select></div>
    <button class="row" onClick=${() => { closeSheet(); route(`/exercise/${e.ex}`); }}>${I("chart")}<span class="grow">History and records</span></button>
    <button class="row red" onClick=${act((x) => { x.exercises.splice(ei, 1); })}>${I("trash")}<span class="grow">Remove exercise</span></button></div>` });
}

const SSCOLORS = ["--c-violet", "--c-teal", "--c-pink", "--c-sky"];
function Live({ note }) {
  const a = active();
  if (!a) return html`<div class="live"><div class="empty" style="padding-top:4rem"><h3>No workout running</h3><p>Start one from Workout.</p><button class="btn primary" onClick=${() => route("/")}>Back to Workout</button></div></div>`;
  const s = S();
  const done = a.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);
  const vol = volume(a);
  const groups = {};
  a.exercises.forEach((e) => { if (e.superset && !(e.superset in groups)) groups[e.superset] = Object.keys(groups).length; });
  return html`<div class="live">
    <header class="livehead">
      <button class="round" onClick=${() => route("/")} aria-label="Minimize the workout">${I("down")}</button>
      <div class="grow"><input class="name ell" aria-label="Workout name" key=${a.name} defaultValue=${a.name} onChange=${(ev) => editActive((x) => { x.name = ev.target.value.trim() || x.name; })} />
        <div class="stats3"><b class="clock"><${Clock} start=${a.start} /></b><span>·</span><span class="num">${fmtVol(vol)}</span><span>·</span><span class="num">${done} ${done === 1 ? "set" : "sets"}</span></div></div>
      <button class="btn ok" onClick=${finishSheet}>Finish</button>
    </header>
    ${a.exercises.length ? a.exercises.map((e, ei) => {
      const ex = exById(e.ex);
      const ssc = e.superset ? SSCOLORS[groups[e.superset] % SSCOLORS.length] : null;
      return html`<section class=${"card exc" + (ssc ? " ss" : "")} style=${ssc ? `--ssc:var(${ssc})` : ""} aria-label=${ex.name}>
        <div class="exh"><${Glyph} ex=${ex} sm /><div class="grow"><h3 class="ell">${ex.name}</h3>${ssc ? html`<span class="tag">Superset ${String.fromCharCode(65 + groups[e.superset])}</span>` : null}</div>
          <button class="round" onClick=${() => exMenu(ei)} aria-label=${`More for ${ex.name}`}>${I("more")}</button></div>
        <div class="exnote">${I("timer")}Rest ${Math.floor((e.rest || s.rest) / 60)}:${String((e.rest || s.rest) % 60).padStart(2, "0")}${e.superset && !restsAfter(a, ei) ? " · after the superset" : ""}</div>
        <div class=${"sets" + (s.showRpe ? " rpe" : "")}>
          <span class="h">Set</span><span class="h l">Prev</span><span class="h">${unit()}</span><span class="h">Reps</span>${s.showRpe ? html`<span class="h rpec">RPE</span>` : html`<span></span>`}<span class="h">${I("check")}</span>
          ${e.sets.map((_, si) => html`<${SetRow} a=${a} ei=${ei} si=${si} showRpe=${s.showRpe} />`)}
        </div>
        <button class="btn addset" onClick=${() => editActive((x) => { const l = x.exercises[ei].sets.at(-1); x.exercises[ei].sets.push({ type: "normal", kg: l ? l.kg : null, reps: null, target: l ? l.target : null, done: false }); })}>${I("plus")} Add set</button>
      </section>`;
    }) : html`<div class="card empty"><h3>An empty workout</h3><p>Add the exercises you're doing. Each one keeps its sets, the weights from last time and a rest timer.</p></div>`}
    <div style="display:grid;gap:.6rem;margin-top:1rem">
      <button class="btn tint big" onClick=${() => pickExercises((ids) => editActive((x) => { ids.forEach((id) => { const prev = previous(id); x.exercises.push({ ex: id, rest: null, superset: null, sets: [0, 1, 2].map((i) => ({ type: "normal", kg: prev[i] ? prev[i].kg : null, reps: null, target: prev[i] ? prev[i].reps : null, done: false })) }); }); }))}>${I("plus")} Add exercises</button>
      <button class="btn danger" onClick=${discardSheet}>Discard workout</button>
    </div>
    ${a.rest ? html`<${RestBar} rest=${a.rest} />` : null}
  </div>`;
}
function discardSheet() {
  openSheet({ title: "Discard this workout?", body: () => html`<p class="muted">Nothing from it is saved, in the app or in the note.</p>`,
    foot: () => html`<button class="btn" onClick=${closeSheet}>Keep going</button><button class="btn" style="background:var(--amber-danger);color:#fff" onClick=${async () => { closeSheet(); if (restNote) amber.device.notify.cancel(restNote); await amber.store.set("active", null); route("/"); }}>Discard</button>` });
}
function finishSheet() {
  const a = active(), left = a.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  const done = a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  if (!left) return finish();
  openSheet({ title: done ? "Finish the workout?" : "Nothing done yet", body: () => html`<p class="muted">${done ? `${left} ${left === 1 ? "set isn't" : "sets aren't"} checked. Only checked sets are saved.` : "Check off at least one set, or discard the workout."}</p>`,
    foot: () => html`<button class="btn" onClick=${closeSheet}>Keep going</button>${done ? html`<button class="btn ok" onClick=${() => { closeSheet(); finish(); }}>Finish</button>` : null}` });
}
async function finish() {
  const a = active();
  const w = { id: a.id, routine: a.routine, name: a.name, start: a.start, minutes: Math.max(1, Math.round((Date.now() - Date.parse(a.start)) / 60000)),
    exercises: a.exercises.map((e) => ({ ex: e.ex, rest: e.rest, superset: e.superset, sets: e.sets.filter((s) => s.done).map(({ type, kg, reps, rpe }) => ({ type, kg: kg || 0, reps: reps || 0, done: true, ...(rpe ? { rpe } : {}) })) })).filter((e) => e.sets.length) };
  if (restNote) { amber.device.notify.cancel(restNote); restNote = null; }
  const ops = logOps(amber.note, w);
  if (ops && ops.length) { const r = await amber.update(ops); if (!r.ok) { openSheet({ title: "Couldn't write the log", body: () => html`<p class="err">${r.error}</p>` }); return; } }
  await amber.store.collection("workouts").add(w);
  await amber.store.set("active", null);
  route(`/done/${w.id}`);
}

// Picking exercises: search, filters, several at once (or one, to replace).
function pickExercises(onPick, { single } = {}) {
  let q = "", muscle = "All", chosen = [];
  const Body = () => {
    const [, re] = useState(0); const redraw = () => re((n) => n + 1);
    const list = allExercises().filter((x) => (muscle === "All" || x.muscle === muscle) && (!q || x.name.toLowerCase().includes(q.toLowerCase())));
    const used = new Set(workouts().slice(0, 30).flatMap((w) => w.exercises.map((e) => e.ex)));
    list.sort((x, y) => (used.has(y.id) - used.has(x.id)) || x.name.localeCompare(y.name));
    return html`<div class="search">${I("search")}<input class="in" type="search" placeholder="Search exercises" aria-label="Search exercises" onInput=${(e) => { q = e.target.value; redraw(); }} /></div>
      <div class="chips" style="margin-top:.6rem" role="group" aria-label="Muscle">${["All", ...MUSCLES].map((m) => html`<button class="chip" aria-pressed=${m === muscle} onClick=${() => { muscle = m; redraw(); }}>${m}</button>`)}</div>
      <div class="card list pick">${list.map((x) => html`<label class="row"><${Glyph} ex=${x} sm /><span class="grow"><span class="ell" style="display:block;font-weight:600">${x.name}</span><span class="small muted">${x.muscle} · ${x.equipment}${used.has(x.id) ? " · recent" : ""}</span></span>
        <input type=${single ? "radio" : "checkbox"} name="pick" checked=${chosen.includes(x.id)} aria-label=${`Choose ${x.name}`} onChange=${(e) => { chosen = single ? [x.id] : e.target.checked ? [...chosen, x.id] : chosen.filter((y) => y !== x.id); redraw(); setFoot(); }} /></label>`)}
        ${list.length ? null : html`<div class="empty"><p>No exercise called “${q}”.</p><button class="btn tint" onClick=${() => { closeSheet(); setTimeout(() => customExercise(q, (id) => onPick([id])), 50); }}>${I("plus")} Create “${q}”</button></div>`}</div>`;
  };
  let setFoot = () => {};
  const Foot = () => { const [, re] = useState(0); setFoot = () => re((n) => n + 1);
    return html`<button class="btn" onClick=${() => { closeSheet(); setTimeout(() => customExercise("", (id) => onPick([id])), 50); }}>${I("plus")} New</button>
      <button class="btn primary" disabled=${!chosen.length} onClick=${() => { onPick(chosen); closeSheet(); }}>${single ? "Replace" : chosen.length ? `Add ${chosen.length}` : "Add"}</button>`; };
  openSheet({ title: single ? "Replace with" : "Add exercises", wide: true, body: () => html`<${Body} />`, foot: () => html`<${Foot} />` });
}
function customExercise(name, done) {
  let v = { name, muscle: "Chest", equipment: "Barbell" };
  openSheet({ title: "New exercise", body: () => html`<div style="display:grid;gap:.8rem">
      <label class="field">Name<input class="in" defaultValue=${name} autofocus onInput=${(e) => (v.name = e.target.value)} /></label>
      <label class="field">Main muscle<select class="in" onChange=${(e) => (v.muscle = e.target.value)}>${MUSCLES.map((m) => html`<option>${m}</option>`)}</select></label>
      <label class="field">Equipment<select class="in" onChange=${(e) => (v.equipment = e.target.value)}>${EQUIPMENT.map((m) => html`<option>${m}</option>`)}</select></label></div>`,
    foot: () => html`<button class="btn primary" onClick=${async () => { if (!v.name.trim()) return; const id = "custom-" + uid(); await amber.setData({ values: { custom: [...(V().custom || []), { id, name: v.name.trim(), muscle: v.muscle, other: [], equipment: v.equipment }] } }); closeSheet(); done && done(id); }}>Save exercise</button>` });
}

function Done({ id }) {
  const w = C("workouts").find((x) => x.id === id);
  if (!w) return html`<div class="screen"><p class="muted">Saved.</p></div>`;
  const prs = prsOf(w), sets = w.exercises.reduce((n, e) => n + working(e.sets).length, 0);
  const nth = workouts().length;
  return html`<div class="screen">
    <section class="card summary">${I(prs.length ? "trophy" : "check", "trophy")}<h2>${prs.length ? "New records" : "Nice work"}</h2><p class="muted">Workout number ${nth} · ${w.name}</p>
      <div class="kpis"><div><b class="num">${fmtDur(w.minutes)}</b><span>Duration</span></div><div><b class="num">${fmtVol(volume(w))}</b><span>Volume</span></div><div><b class="num">${sets}</b><span>Sets</span></div><div><b class="num">${prs.length}</b><span>Records</span></div></div></section>
    ${prs.length ? html`<div class="label">Records</div><section class="card list">${prs.map((p) => html`<div class="row"><${Glyph} ex=${p.ex} sm /><span class="grow"><b>${exById(p.ex).name}</b><div class="small muted">${p.kind}</div></span><b class="num">${p.value}</b></div>`)}</section>` : null}
    <div class="label">What you did</div>
    <section class="card list">${w.exercises.map((e) => html`<div class="row"><span class="grow"><b>${working(e.sets).length} × ${exById(e.ex).name}</b><div class="small muted">${e.sets.map((s) => setText(s, exById(e.ex))).join(" · ")}</div></span></div>`)}</section>
    <p class="muted small" style="margin:.7rem .2rem">Written into the note's log, one row per exercise.</p>
    <div style="display:grid;gap:.6rem;margin-top:1rem">${!w.routine ? html`<button class="btn tint big" onClick=${() => saveAsRoutine(w)}>${I("copy")} Save as a routine</button>` : null}<button class="btn primary big" onClick=${() => route("/")}>Done</button></div>
  </div>`;
}
async function saveAsRoutine(w) {
  const r = { id: uid(), name: w.name, folder: null, exercises: w.exercises.map((e) => ({ ex: e.ex, rest: e.rest, superset: e.superset, sets: e.sets.map((s) => ({ type: s.type, reps: s.reps })) })) };
  await amber.store.set("routines", [...(V().routines || []), r]);
  route(`/routine/${r.id}`);
}
