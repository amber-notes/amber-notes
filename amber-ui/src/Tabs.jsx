// A segmented control: <Tabs items={["Week", "Month"]} value={v} onChange={setV} />.
export function Tabs({ items, value, onChange, label, class: cls = "" }) {
  return (
    <div class={`aui-tabs ${cls}`} role="tablist" aria-label={label}>
      {items.map((it) => {
        const id = typeof it === "object" ? it.value : it, text = typeof it === "object" ? it.label : it;
        return <button type="button" role="tab" aria-selected={id === value} class="aui-tabs__tab" onClick={() => onChange && onChange(id)}>{text}</button>;
      })}
    </div>
  );
}
