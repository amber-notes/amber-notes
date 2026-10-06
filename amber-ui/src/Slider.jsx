// <Slider label="Rest" value={90} min={30} max={300} step={15} format={(v) => v + " s"} onInput={setRest} />
export function Slider({ label, value, min = 0, max = 100, step = 1, format = String, onInput, class: cls = "" }) {
  return (
    <label class={`aui-slider ${cls}`}>
      <span class="aui-slider__top"><span>{label}</span><output>{format(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} aria-valuetext={format(value)}
        onInput={(e) => onInput && onInput(Number(e.currentTarget.value))} />
    </label>
  );
}
