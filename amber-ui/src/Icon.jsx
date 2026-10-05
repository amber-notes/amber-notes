import { icons } from "./icons.js";

// A Lucide icon by name, sized by the text around it and coloured by currentColor:
// <Icon name="dumbbell" />. Names: see icons.js (settings, trophy, flame, timer, heart, map-pin, ...).
export function Icon({ name, label, size, class: cls = "" }) {
  const shape = icons[name] || [];
  return (
    <svg class={`aui-icon ${cls}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      {shape.map(([tag, attrs]) => {
        const El = tag;
        return <El {...attrs} />;
      })}
    </svg>
  );
}

export const iconNames = Object.keys(icons);
