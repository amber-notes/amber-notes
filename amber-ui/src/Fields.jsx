let n = 0;
const useId = (id) => id || `aui-f${++n}`;

// A labelled field. hint is shown under it and read with it.
function Field({ id, label, hint, children }) {
  return (
    <div class="aui-field">
      {label && <label class="aui-field__label" for={id}>{label}</label>}
      {children}
      {hint && <p class="aui-field__hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

export function Input({ label, hint, id, class: cls = "", ...props }) {
  const fid = useId(id);
  return (
    <Field id={fid} label={label} hint={hint}>
      <input id={fid} class={`aui-input ${cls}`} aria-describedby={hint ? `${fid}-hint` : undefined} {...props} />
    </Field>
  );
}

export function TextArea({ label, hint, id, rows = 4, class: cls = "", ...props }) {
  const fid = useId(id);
  return (
    <Field id={fid} label={label} hint={hint}>
      <textarea id={fid} rows={rows} class={`aui-input aui-textarea ${cls}`} aria-describedby={hint ? `${fid}-hint` : undefined} {...props} />
    </Field>
  );
}

// options: ["Oak", "Walnut"] or [{ value: 120, label: "2 minutes" }].
export function Select({ label, hint, id, options = [], class: cls = "", ...props }) {
  const fid = useId(id);
  return (
    <Field id={fid} label={label} hint={hint}>
      <select id={fid} class={`aui-input aui-select ${cls}`} {...props}>
        {options.map((o) => typeof o === "object" ? <option value={o.value}>{o.label}</option> : <option>{o}</option>)}
      </select>
    </Field>
  );
}
