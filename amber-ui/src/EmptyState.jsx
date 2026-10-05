export function EmptyState({ title, body, action, icon, class: cls = "" }) {
  return (
    <div class={`aui-empty ${cls}`}>
      {icon && <div class="aui-empty__icon">{icon}</div>}
      <h2 class="aui-empty__title">{title}</h2>
      {body && <p class="aui-empty__body">{body}</p>}
      {action}
    </div>
  );
}
