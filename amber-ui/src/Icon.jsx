const paths = {
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  calendar: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M9 3v4M15 3v4",
  chart: "M4 19l5-6 4 3 7-9",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  chevron: "M9 6l6 6-6 6",
  check: "M5 12l5 5 9-10",
  home: "M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z",
};

// A line icon from a small set (clock, calendar, chart, list, gear, plus, back, chevron, check, home).
export function Icon({ name, label, class: cls = "" }) {
  return (
    <svg class={`aui-icon ${cls}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      <path d={paths[name] || ""} />
    </svg>
  );
}
