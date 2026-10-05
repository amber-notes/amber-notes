import { useState, useLayoutEffect } from "preact/hooks";

// The note, live: re-renders when the note changes. (A layout effect: a hidden app may never
// draw the frame a plain effect waits for.)
export function useNote() {
  const [note, set] = useState(window.amber.note);
  useLayoutEffect(() => { window.amber.onChange((n) => set({ ...n })); }, []);
  return note;
}

// The app's own data (amber.data), live, and a setter that merges and saves.
export function useData() {
  const [data, set] = useState(window.amber.data);
  useLayoutEffect(() => { window.amber.onChange((_, d) => set({ ...(d || window.amber.data) })); }, []);
  const save = async (patch) => { const r = await window.amber.setData(patch); set({ ...window.amber.data }); return r; };
  return [data, save];
}
