// The frame: tabs on the phone, a sidebar on the Mac; the workout in progress takes the whole screen.
const TABS = [["/", "Workout", "dumbbell"], ["/history", "History", "history"], ["/exercises", "Exercises", "library"], ["/progress", "Progress", "chart"], ["/settings", "Settings", "gear"]];
const tabOf = (path) => (path.startsWith("/history") || path.startsWith("/workout") ? "/history" : path.startsWith("/exercise") ? "/exercises" : TABS.find((t) => t[0] === path) ? path : "/");
function App() {
  const [st, set] = useState({ note: amber.note, n: 0 });
  useLayoutEffect(() => { amber.onChange((note) => set((s) => ({ note, n: s.n + 1 }))); }, []);
  const path = useRoute(), note = st.note, focus = path === "/live" || path.startsWith("/done");
  const a = active(), cur = tabOf(path);
  const go = (p) => (e) => { e.preventDefault(); route(p); window.scrollTo(0, 0); };
  const nav = (cls) => TABS.map(([p, l, i]) => html`<a class="tab" href=${"#" + p} onClick=${go(p)} aria-current=${cur === p ? "page" : "false"}>${I(i)}<span>${l}</span></a>`);
  return html`<div class=${"shell" + (focus ? " focus" : "")}>
    <nav class="side" aria-label="Sections"><div class="brand">${I("bolt")}<span>${note.title}</span></div>${nav()}
      ${a && !focus ? html`<button class="resumebar resume" onClick=${() => route("/live")}><span class="grow"><b>${a.name}</b><span class="small"><${Clock} start=${a.start} /></span></span><span class="btn">Resume</span></button>` : null}</nav>
    <main key=${path} class=${focus ? "" : "screen-host"}>
      <${Router}>
        <${Home} path="/" default note=${note} />
        <${Live} path="/live" note=${note} />
        <${Done} path="/done/:id" />
        <${RoutineEdit} path="/routine/:id" />
        <${History} path="/history" note=${note} />
        <${WorkoutView} path="/workout/:id" note=${note} />
        <${Library} path="/exercises" />
        <${ExerciseView} path="/exercise/:id" note=${note} />
        <${Progress} path="/progress" note=${note} />
        <${Settings} path="/settings" />
      </${Router}>
    </main>
    ${a && !focus ? html`<button class="resumebar" style="display:var(--rb, flex)" onClick=${() => route("/live")}><span class="grow"><b>${a.name}</b><span class="small"><${Clock} start=${a.start} /> · ${a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)} sets done</span></span><span class="btn">Resume</span></button>` : null}
    ${focus ? null : html`<nav class="tabbar" aria-label="Sections">${nav()}</nav>`}
    <${SheetHost} />
  </div>`;
}
// Library starts in the store, so it can be extended: the person's own exercises are added next to it.
preact.render(html`<${App} />`, document.getElementById("app"));
// Open on the workout if one is running.
if (active()) route("/live");
