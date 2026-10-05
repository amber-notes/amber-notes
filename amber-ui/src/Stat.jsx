// A number that matters, with what it is: <Stat value="3.3" label="a week" />.
export function Stat({ value, label, hint, class: cls = "" }) {
  return (
    <div class={`aui-stat ${cls}`}>
      <span class="aui-stat__value">{value}</span>
      <span class="aui-stat__label">{label}</span>
      {hint && <span class="aui-stat__hint">{hint}</span>}
    </div>
  );
}
