// Weight over time for one exercise, drawn to scale in SVG.
export default function WeightChart({ points, label }) {
  if (points.length < 2) return <p class="muted">Log it twice to see a line.</p>;
  const W = 600, H = 170, lo = Math.min(...points.map((p) => p.kg)) - 5, hi = Math.max(...points.map((p) => p.kg)) + 5;
  const x = (i) => 30 + i * (W - 60) / (points.length - 1);
  const y = (kg) => H - 26 - (kg - lo) / (hi - lo) * (H - 46);
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <polyline fill="none" stroke="var(--amber-accent)" stroke-width="3" points={points.map((p, i) => `${x(i)},${y(p.kg)}`).join(" ")} />
      {points.map((p, i) => (
        <g>
          <circle cx={x(i)} cy={y(p.kg)} r="4.5" fill="var(--amber-accent)" />
          <text x={x(i)} y={H - 6} text-anchor="middle">{p.date.slice(5).replace("-", "/")}</text>
        </g>
      ))}
    </svg>
  );
}
