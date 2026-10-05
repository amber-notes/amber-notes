// The note and data hooks live in "amber"; re-exported here for convenience.
export { useNote, useAppData, useSettings, useTable, useChecklist } from "amber";

// Kept for apps written against amber-ui 1.0's useData: the whole data object and a merging setter.
import { useState, useLayoutEffect } from "preact/hooks";
export function useData() {
  const [data, set] = useState(window.amber.data);
  useLayoutEffect(() => window.amber.onChange((_, d) => set({ ...(d || window.amber.data) })), []);
  const save = async (patch) => { const r = await window.amber.setData(patch); set({ ...window.amber.data }); return r; };
  return [data, save];
}
