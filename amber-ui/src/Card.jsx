export function Card({ title, class: cls = "", children, ...props }) {
  return (
    <section class={`aui-card ${cls}`} {...props}>
      {title && <h2 class="aui-card__title">{title}</h2>}
      {children}
    </section>
  );
}
