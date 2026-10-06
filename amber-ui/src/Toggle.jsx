// A switch with its label: <Toggle label="Remind me" checked={on} onChange={setOn} />.
export function Toggle({ label, checked, onChange, disabled, class: cls = "" }) {
  return (
    <label class={`aui-toggle ${cls}`}>
      <span class="aui-toggle__label">{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange && onChange(e.currentTarget.checked)} />
      <span class="aui-toggle__track" aria-hidden="true"><span class="aui-toggle__thumb" /></span>
    </label>
  );
}
